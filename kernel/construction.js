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
export function addConstruction(model, resources, request) {
  if (!request.construction) return null;
  const settings = request.construction;
  if (typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Construction settings must be an object.');
  const weight = number(settings.weight ?? 1, 'Construction priority', true);
  const effort = number(settings.work ?? 1, 'Construction work priority', true);
  const energyWeight = number(settings.energy ?? 0.000001, 'Construction energy priority');
  const supplyWeight = number(settings.materials ?? 1000, 'Construction material priority');
  const rows = new Map([...resources].map(id => [id, new Map()]));
  const requirements = [];
  for (const line of model.lines) {
    const {bill, error} = constructionBill(line.configuration, resources);
    if (error) throw new Error(error);
    for (const flow of bill) {
      add(rows.get(flow.resource), line.machine, -flow.amount);
      requirements.push({...flow, variable: line.machine});
    }
  }
  const routes = [];
  const seen = new Set();
  for (const line of model.lines) {
    const {recipe, configuration} = line;
    const capacity = configuration.operations_per_second;
    const energy = (configuration.eu_per_operation ?? 0) + (configuration.idle_eu_per_tick ?? 0) * 20 / capacity;
    const inputs = [...recipe.inputs, ...(configuration.inputs ?? [])];
    const full = configuration.operating_points?.at(-1);
    if (full) inputs.push(...full.inputs.map(flow => ({...flow, amount: flow.amount / capacity})));
    const signature = JSON.stringify([recipe.id, inputs, energy, capacity]);
    if (seen.has(signature)) continue;
    seen.add(signature);
    const index = routes.length;
    const variable = `cx${index}`;
    model.bounds.push(`${variable} >= 0`);
    const unitCost = effort / capacity + energyWeight * energy;
    add(model.objective, variable, weight * unitCost);
    const inputTerms = [], outputTerms = [];
    for (const [slot, flow] of inputs.entries()) {
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
          alternatives.set(term, 1);
        }
        add(rows.get(resource), term, -amount);
        inputTerms.push({resource, variable: term, amount});
        for (const returned of own(flow.returns, resource) ?? []) {
          add(rows.get(returned.resource), term, amount * returned.amount);
          outputTerms.push({resource: returned.resource, variable: term, amount: amount * returned.amount});
        }
      }
      if (choices.length !== 1) model.constraints.push(`construction_choice_${index}_${slot}: ${expression(alternatives)} = 0`);
    }
    for (const flow of recipe.outputs) {
      add(rows.get(flow.resource), variable, flow.amount);
      outputTerms.push({...flow, variable});
    }
    if (energy) add(rows.get('energy:eu'), variable, -energy);
    routes.push({recipe: recipe.id, name: recipe.name ?? recipe.id, configuration: configuration.id, variable, capacity, energy, unitCost, inputTerms, outputTerms});
  }
  const supplies = [];
  for (const supply of settings.external ?? []) {
    if (!resources.has(supply.resource)) throw new Error(`Unknown construction supply: ${supply.resource}.`);
    const variable = `cs${supplies.length}`;
    const cost = number(supply.cost ?? 1, 'Construction supply cost');
    model.bounds.push(`${variable} >= 0`);
    if (supply.quantity !== undefined) model.bounds.push(`${variable} <= ${number(supply.quantity, 'Construction supply quantity')}`);
    if (supply.limit !== undefined) throw new Error('Construction supplies use quantity, not an operating rate limit.');
    add(rows.get(supply.resource), variable, 1);
    add(model.objective, variable, weight * supplyWeight * cost);
    supplies.push({resource: supply.resource, variable, cost});
  }
  let index = 0;
  for (const row of rows.values()) if (row.size) model.constraints.push(`construction_balance_${index++}: ${expression(row)} >= 0`);
  return {rows, requirements, routes, supplies, weight, effort, energyWeight, supplyWeight};
}

export function decodeConstruction(model, value) {
  if (!model) return undefined;
  const quantities = terms => {
    const totals = new Map();
    for (const term of terms) totals.set(term.resource, (totals.get(term.resource) ?? 0) + term.amount * value(term.variable));
    return [...totals].filter(([, amount]) => amount > 1e-9).map(([resource, amount]) => ({resource, amount}));
  };
  const balances = [];
  for (const [resource, terms] of model.rows) {
    let surplus = 0, magnitude = 0;
    for (const [variable, amount] of terms) { surplus += amount * value(variable); magnitude += Math.abs(amount * value(variable)); }
    const tolerance = Math.max(1e-7, magnitude * Number.EPSILON * 16);
    if (surplus < -tolerance) throw new Error(`The construction balance failed for ${resource}.`);
    if (magnitude) balances.push({resource, surplus, numerical_tolerance: tolerance});
  }
  const routes = model.routes.filter(route => value(route.variable) > 1e-9).map(route => ({
    recipe: route.recipe, name: route.name, configuration: route.configuration, operations: value(route.variable),
    work_seconds: value(route.variable) / route.capacity, energy_eu: value(route.variable) * route.energy,
    inputs: quantities(route.inputTerms), outputs: quantities(route.outputTerms),
  }));
  const external = model.supplies.map(supply => ({resource: supply.resource, amount: value(supply.variable), unit_cost: supply.cost})).filter(supply => supply.amount > 1e-9);
  const work = routes.reduce((sum, route) => sum + route.work_seconds, 0);
  const energy = routes.reduce((sum, route) => sum + route.energy_eu, 0);
  const materialCost = external.reduce((sum, supply) => sum + supply.amount * supply.unit_cost, 0);
  return {method: 'material_equivalents', requirements: quantities(model.requirements), routes, external, balances,
    work_seconds: work, energy_eu: energy, material_cost: materialCost,
    objective: model.weight * (model.effort * work + model.energyWeight * energy + model.supplyWeight * materialCost),
    assumptions: ['Construction uses the enabled workstations sequentially; their acquisition and availability must already be established.',
      'Craft quantities and expected yields are continuous material equivalents, not a rounded shopping list.',
      'Work is the sum of fully supplied machine seconds, not elapsed construction time or a cold-start schedule.',
      'Reusable construction catalysts, initial loop fills, and warm-up stocks are separate requirements.']};
}
