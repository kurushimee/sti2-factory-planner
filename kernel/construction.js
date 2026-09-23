import {balanceTolerance, diagnosticNumber} from './numerics.js';

function number(value, name, positive = false) {
  if (!Number.isFinite(value) || value < (positive ? Number.MIN_VALUE : 0) || value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${name} must be ${positive ? 'positive' : 'nonnegative'}, finite, and within the supported numeric range.`);
  }
  return value;
}

function add(row, variable, amount) { row.set(variable, (row.get(variable) ?? 0) + amount); }
function own(record, key) { return record && Object.hasOwn(record, key) ? record[key] : undefined; }
function expression(row) {
  const terms = [...row].filter(([, amount]) => amount !== 0);
  return terms.length ? terms.map(([variable, amount]) => `${amount < 0 ? '-' : '+'} ${Math.abs(amount)} ${variable}`).join(' ') : '0 zero';
}

export class ConstructionBalanceError extends Error {
  constructor(resource, surplus, tolerance, magnitude, terms, value) {
    super(`The construction balance failed for ${resource}: deficit ${diagnosticNumber(-surplus)}, tolerance ${diagnosticNumber(tolerance)}, total flow ${diagnosticNumber(magnitude)}.`);
    this.balance = {resource, surplus, tolerance, magnitude, terms: [...terms]
      .map(([variable, coefficient]) => ({variable, coefficient, value: value(variable)})).filter(term => term.value !== 0)};
  }
}

export function constructionBill(configuration, resources) {
  if (configuration.structure?.status === 'unsupported') return {error: configuration.structure.reason};
  const bill = configuration.build_requirements;
  if (!bill?.length) return {error: 'The configuration has no verified construction bill.'};
  for (const flow of bill) {
    if (!resources.has(flow.resource) || !(flow.amount > 0) || !Number.isFinite(flow.amount) || flow.amount > Number.MAX_SAFE_INTEGER) {
      return {error: `The construction bill has an unknown resource or amount: ${flow.resource}.`};
    }
  }
  return {bill};
}

// Construction quantities use a separate balance. They never become an operating output rate.
export function addConstruction(model, resources, request, definitions = new Map()) {
  if (!request.construction) return null;
  const settings = request.construction;
  if (typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Construction settings must be an object.');
  if (settings.round_batches !== undefined && typeof settings.round_batches !== 'boolean') throw new Error('Whole construction batches must be a boolean.');
  const rounded = settings.round_batches === true;
  const wholeItem = resource => resource.startsWith('item:') || definitions.get(resource)?.kind === 'item' || definitions.get(resource)?.unit === 'item';
  const weight = number(settings.weight ?? 1, 'Construction priority', true);
  const effort = number(settings.work ?? 1, 'Construction work priority', true);
  const energyWeight = number(settings.energy ?? 0.000001, 'Construction energy priority');
  const supplyWeight = number(settings.materials ?? 1000, 'Construction material priority');
  const rows = new Map([...resources].map(id => [id, new Map()]));
  const requirements = [];
  for (const line of [...(model.construction_only ? [] : model.lines), ...(model.fixed_builds ?? [])]) {
    const {bill, error} = constructionBill(line.configuration, resources);
    if (error) throw new Error(error);
    for (const flow of bill) {
      add(rows.get(flow.resource), line.machine, -flow.amount);
      requirements.push({...flow, variable: line.machine});
    }
  }
  const routes = [], ingredientChecks = [];
  const candidates = new Map();
  const tools = new Map();
  for (const line of model.lines) {
    const {recipe, configuration} = line;
    const capacity = configuration.operations_per_second;
    const energy = (configuration.eu_per_operation ?? 0) + (configuration.idle_eu_per_tick ?? 0) * 20 / capacity;
    const inputs = [...recipe.inputs, ...(configuration.inputs ?? [])];
    const full = configuration.operating_points?.at(-1);
    if (full) inputs.push(...full.inputs.map(flow => ({...flow, amount: flow.amount / capacity})));
    const batch = configuration.setup?.batch ?? configuration.setup?.contained_count ?? 1;
    const signature = JSON.stringify([recipe.id, inputs, rounded ? batch : null]);
    const previous = candidates.get(signature) ?? [];
    const unitCost = effort / capacity + energyWeight * energy;
    // Available construction workstations need no new build allocation. For identical material
    // flows, a route with no greater work cost or energy use can replace the more expensive one.
    if (previous.some(value => value.unitCost <= unitCost && value.energy <= energy)) continue;
    candidates.set(signature, [...previous.filter(value => !(unitCost <= value.unitCost && energy <= value.energy)),
      {recipe, configuration, capacity, energy, inputs, batch, unitCost}]);
  }
  for (const {recipe, configuration, capacity, energy, inputs, batch, unitCost} of [...candidates.values()].flat()) {
    const index = routes.length;
    const variable = `cx${index}`;
    model.bounds.push(`${variable} >= 0`);
    if (rounded) {
      if (!Number.isSafeInteger(batch) || batch < 1) throw new Error('A construction batch must contain a positive whole count of operations.');
      const batches = `cb${index}`;
      model.bounds.push(`${batches} >= 0`);
      model.integers.push(batches);
      model.constraints.push(`construction_batches_${index}: ${variable} - ${batch} ${batches} = 0`);
    }
    add(model.objective, variable, weight * unitCost);
    const inputTerms = [], outputTerms = [];
    for (const [slot, flow] of inputs.entries()) {
      if (rounded && recipe.tool_usage && recipe.tool_usage.resource === flow.resource && slot < recipe.inputs.length) {
        const usage = recipe.tool_usage;
        if (!Number.isSafeInteger(usage.crafts_per_tool) || usage.crafts_per_tool < 1 || Math.abs(flow.amount - 1 / usage.crafts_per_tool) > 1e-12) {
          throw new Error(`The finite tool lifetime is inconsistent in ${recipe.id}.`);
        }
        const toolKey = JSON.stringify([usage.resource, usage.crafts_per_tool]);
        if (!tools.has(toolKey)) tools.set(toolKey, {recipes: new Set(), resource: usage.resource,
          crafts_per_tool: usage.crafts_per_tool, operations: new Map(), variable: `ct${tools.size}`});
        tools.get(toolKey).recipes.add(recipe.id);
        add(tools.get(toolKey).operations, variable, 1);
        continue;
      }
      const available = flow.choices ?? [flow.resource];
      const pinned = own(request.ingredients, `${recipe.id}#${slot}`);
      if (pinned && !available.includes(pinned)) throw new Error(`The construction ingredient is unavailable in ${recipe.id}.`);
      const choices = pinned ? [pinned] : available;
      const alternatives = new Map([[variable, -flow.amount]]);
      for (const [choice, resource] of choices.entries()) {
        const term = choices.length === 1 ? variable : `ca${index}_${slot}_${choice}`;
        const amount = choices.length === 1 ? flow.amount : 1;
        if (choices.length !== 1) {
          model.bounds.push(`${term} >= 0`);
          if (rounded && wholeItem(resource) && Number.isInteger(flow.amount) && (flow.probability ?? 1) === 1) model.integers.push(term);
          alternatives.set(term, 1);
        }
        add(rows.get(resource), term, -amount);
        inputTerms.push({resource, variable: term, amount});
        for (const returned of own(flow.returns, resource) ?? []) {
          add(rows.get(returned.resource), term, amount * returned.amount);
          outputTerms.push({resource: returned.resource, variable: term, amount: amount * returned.amount});
        }
      }
      if (choices.length !== 1) {
        model.constraints.push(`construction_choice_${index}_${slot}: ${expression(alternatives)} = 0`);
        ingredientChecks.push({recipe: recipe.id, slot, row: `construction_choice_${index}_${slot}`, terms: alternatives});
      }
    }
    for (const flow of recipe.outputs) {
      add(rows.get(flow.resource), variable, flow.amount);
      outputTerms.push({...flow, variable});
    }
    if (energy) add(rows.get('energy:eu'), variable, -energy);
    routes.push({recipe: recipe.id, name: recipe.name ?? recipe.id, configuration: configuration.id, variable, batch,
      expected_yields: recipe.expected_yields === true, capacity, energy, unitCost, inputTerms, outputTerms});
  }
  for (const tool of tools.values()) {
    model.bounds.push(`${tool.variable} >= 0`);
    model.integers.push(tool.variable);
    add(rows.get(tool.resource), tool.variable, -1);
    const usage = new Map(tool.operations);
    add(usage, tool.variable, -tool.crafts_per_tool);
    model.constraints.push(`construction_tool_upper_${tool.variable}: ${expression(usage)} <= 0`,
      `construction_tool_lower_${tool.variable}: ${expression(usage)} >= ${1 - tool.crafts_per_tool}`);
  }
  const supplies = [];
  for (const supply of settings.external ?? []) {
    if (!resources.has(supply.resource)) throw new Error(`Unknown construction supply: ${supply.resource}.`);
    const variable = `cs${supplies.length}`;
    const cost = number(supply.cost ?? 1, 'Construction supply cost');
    model.bounds.push(`${variable} >= 0`);
    if (rounded && wholeItem(supply.resource)) model.integers.push(variable);
    if (supply.quantity !== undefined) model.bounds.push(`${variable} <= ${number(supply.quantity, 'Construction supply quantity')}`);
    if (supply.limit !== undefined) throw new Error('Construction supplies use quantity, not an operating rate limit.');
    add(rows.get(supply.resource), variable, 1);
    add(model.objective, variable, weight * supplyWeight * cost);
    supplies.push({resource: supply.resource, variable, cost});
  }
  let index = 0;
  for (const row of rows.values()) if (row.size) model.constraints.push(`construction_balance_${index++}: ${expression(row)} >= 0`);
  return {rows, requirements, routes, supplies, ingredientChecks, tools: [...tools.values()], rounded, weight, effort, energyWeight, supplyWeight};
}

export function decodeConstruction(model, value) {
  if (!model) return undefined;
  for (const {recipe, slot, terms} of model.ingredientChecks ?? []) {
    let residual = 0, magnitude = 0;
    for (const [variable, coefficient] of terms) {
      const amount = coefficient * value(variable);
      residual += amount;
      magnitude += Math.abs(amount);
    }
    const tolerance = balanceTolerance(magnitude);
    if (Math.abs(residual) > tolerance) throw new ConstructionBalanceError(`${recipe}, ingredient ${slot + 1}`,
      -Math.abs(residual), tolerance, magnitude, terms, value);
  }
  const quantities = terms => {
    const totals = new Map();
    for (const term of terms) totals.set(term.resource, (totals.get(term.resource) ?? 0) + term.amount * value(term.variable));
    return [...totals].filter(([, amount]) => amount > 0).map(([resource, amount]) => ({resource, amount}));
  };
  const balances = [];
  for (const [resource, terms] of model.rows) {
    let surplus = 0, magnitude = 0;
    for (const [variable, amount] of terms) { surplus += amount * value(variable); magnitude += Math.abs(amount * value(variable)); }
    const tolerance = balanceTolerance(magnitude);
    if (surplus < -tolerance) throw new ConstructionBalanceError(resource, surplus, tolerance, magnitude, terms, value);
    if (magnitude) balances.push({resource, surplus, numerical_tolerance: tolerance});
  }
  const routes = model.routes.filter(route => value(route.variable) > 0).map(route => ({
    recipe: route.recipe, name: route.name, configuration: route.configuration, operations: value(route.variable),
    work_seconds: value(route.variable) / route.capacity, energy_eu: value(route.variable) * route.energy,
    ...(model.rounded ? {batches: Math.round(value(route.variable) / route.batch), batch_size: route.batch} : {}),
    expected_yields: route.expected_yields,
    inputs: quantities(route.inputTerms), outputs: quantities(route.outputTerms),
  }));
  if (model.rounded) for (const route of routes) {
    if (!Number.isSafeInteger(route.batches) || Math.abs(route.operations - route.batches * route.batch_size) > 1e-6) {
      throw new Error(`The construction recipe has a non-integral batch count: ${route.recipe}.`);
    }
  }
  const external = model.supplies.map(supply => ({resource: supply.resource, amount: value(supply.variable), unit_cost: supply.cost})).filter(supply => supply.amount > 0);
  const work = routes.reduce((sum, route) => sum + route.work_seconds, 0);
  const energy = routes.reduce((sum, route) => sum + route.energy_eu, 0);
  const materialCost = external.reduce((sum, supply) => sum + supply.amount * supply.unit_cost, 0);
  const tools = model.tools.filter(tool => value(tool.variable) > 0.5).map(tool => {
    const operations = [...tool.operations].reduce((sum, [variable, coefficient]) => sum + value(variable) * coefficient, 0);
    const count = Math.round(value(tool.variable));
    if (!Number.isSafeInteger(count) || Math.abs(value(tool.variable) - count) > 1e-6 || count !== Math.ceil(operations / tool.crafts_per_tool - 1e-9)) {
      throw new Error(`The construction tool count failed its lifetime check: ${tool.resource}.`);
    }
    return {recipes: [...tool.recipes], resource: tool.resource, count, operations, crafts_per_tool: tool.crafts_per_tool,
      remaining_crafts: count * tool.crafts_per_tool - operations};
  });
  return {method: model.rounded ? 'whole_batches' : 'material_equivalents', requirements: quantities(model.requirements), routes, external, balances, tools,
    work_seconds: work, energy_eu: energy, material_cost: materialCost,
    objective: model.weight * (model.effort * work + model.energyWeight * energy + model.supplyWeight * materialCost),
    assumptions: ['Construction uses the enabled workstations sequentially; their acquisition and availability must already be established.',
      model.rounded ? 'Recipe batches, purchased items, and verified consumable tools are whole quantities. Probabilistic yields remain expectations, not guaranteed supplies.' : 'Craft quantities and expected yields are continuous material equivalents, not a rounded shopping list.',
      'Work is the sum of fully supplied machine seconds, not elapsed construction time or a cold-start schedule.',
      'Reusable construction catalysts, initial loop fills, and warm-up stocks are separate requirements.']};
}
