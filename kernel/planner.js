import {allocateFlows} from './flows.js';
import {resolveGoals} from './goals.js';
import {startupRequirements} from './startup.js';
import {prepareDataset} from './catalog.js';
import {validateDataset} from './validation.js';

const ENERGY = 'energy:eu';

function nonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${name} must be finite, nonnegative, and within the supported numeric range.`);
  }
  return value;
}

function expression(terms) {
  const values = [...terms].filter(([, coefficient]) => coefficient !== 0);
  return values.length ? values.map(([name, coefficient]) => `${coefficient < 0 ? '-' : '+'} ${Math.abs(coefficient)} ${name}`).join(' ') : '0 zero';
}

function add(terms, name, value) {
  terms.set(name, (terms.get(name) ?? 0) + value);
}

function own(record, key) {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

function combineFlows(flows) {
  const totals = new Map();
  for (const flow of flows) totals.set(flow.resource, (totals.get(flow.resource) ?? 0) + flow.rate);
  return [...totals].filter(([, rate]) => rate > 1e-12).map(([resource, rate]) => ({resource, rate}));
}

export function compileFactory(dataset, request, routeChoices = {}) {
  if (dataset.format !== 1) throw new Error('Unsupported planning dataset version.');
  const resources = new Set(dataset.resources.map(resource => resource.id));
  if (resources.size !== dataset.resources.length) throw new Error('Duplicate resource IDs.');
  const rows = new Map([...resources].map(id => [id, new Map()]));
  const demands = new Map([...resources].map(id => [id, 0]));
  for (const goal of request.goals ?? []) {
    if (!resources.has(goal.resource)) throw new Error(`Unknown goal resource: ${goal.resource}.`);
    demands.set(goal.resource, demands.get(goal.resource) + nonnegative(goal.rate, 'Goal rate'));
  }
  if (request.overhead_eu_per_tick) {
    if (!resources.has(ENERGY)) throw new Error('Infrastructure power needs an energy resource.');
    demands.set(ENERGY, demands.get(ENERGY) + nonnegative(request.overhead_eu_per_tick, 'Infrastructure power') * 20);
  }
  const weights = {external: 1000, machines: 1, energy: 0.000001, ...request.weights};
  for (const [key, value] of Object.entries(weights)) nonnegative(value, `${key} priority`);
  if (!(weights.machines > 0)) throw new Error('The machine priority must be positive to exclude unused allocations.');
  const objective = new Map();
  const constraints = [];
  const bounds = ['zero = 0'];
  const integers = [];
  const lines = [];
  const exclusions = [];
  const recipeIds = new Set();
  const routeCandidates = new Map();
  for (const recipe of dataset.recipes) {
    if (recipeIds.has(recipe.id)) throw new Error(`Duplicate recipe ID: ${recipe.id}.`);
    recipeIds.add(recipe.id);
    if (!resources.has(recipe.primary)) throw new Error(`Unknown primary output for ${recipe.id}.`);
    for (const flow of [...recipe.inputs, ...recipe.outputs]) {
      const choices = flow.choices ?? [flow.resource];
      if (!Array.isArray(choices) || !choices.length || new Set(choices).size !== choices.length) throw new Error(`Invalid ingredient alternatives in ${recipe.id}.`);
      for (const resource of choices) if (!resources.has(resource)) throw new Error(`Unknown resource ${resource} in ${recipe.id}.`);
      nonnegative(flow.amount, 'Recipe amount');
    }
    for (const output of recipe.outputs) if (!output.resource) throw new Error('Recipe outputs need a concrete resource.');
    const reason = recipe.unsupported ||
      ((recipe.requires_obtained ?? []).some(resource => !request.obtained_resources?.includes(resource)) ? 'This route requires an item the player has already obtained.' : '') ||
      (recipe.replication && !request.replication ? 'Replication is disabled.' : '') ||
      (request.disabled_recipes?.includes(recipe.id) ? 'The recipe is disabled.' : '');
    if (reason) {
      exclusions.push({recipe: recipe.id, reason});
      continue;
    }
    const pin = own(request.routes, recipe.primary) ?? own(routeChoices, recipe.primary);
    if (pin && pin !== recipe.id) continue;
    let hasConfiguration = false;
    for (const configuration of recipe.configurations) {
      if (request.disabled_machines?.includes(configuration.machine)) continue;
      const configurations = own(request.configurations, recipe.id);
      if (configurations && !(Array.isArray(configurations) ? configurations : [configurations]).includes(configuration.id)) continue;
      const capacity = nonnegative(configuration.operations_per_second, 'Machine capacity');
      if (!capacity) throw new Error(`Zero capacity in ${configuration.id}.`);
      const energy = nonnegative(configuration.eu_per_operation ?? 0, 'Operation energy');
      const idle = nonnegative(configuration.idle_eu_per_tick ?? 0, 'Idle power');
      if ((energy || idle) && !resources.has(ENERGY)) throw new Error('Machine power needs an energy resource.');
      const index = lines.length;
      const operation = `x${index}`;
      const machine = `n${index}`;
      const buildCost = nonnegative(configuration.build_cost ?? 1, 'Build cost');
      if (!buildCost) throw new Error('Build costs must be positive.');
      add(objective, operation, weights.energy * energy);
      add(objective, machine, weights.machines * buildCost);
      constraints.push(`capacity_${index}: ${operation} - ${capacity} ${machine} <= 0`);
      bounds.push(`${operation} >= 0`, `${machine} >= 0`);
      integers.push(machine);
      const inputTerms = [];
      const allInputs = [...recipe.inputs, ...(configuration.inputs ?? [])].map(flow => ({flow, variable: operation}));
      if (configuration.operating_points) {
        const allocations = new Map([[machine, -1]]);
        const production = new Map([[operation, -1]]);
        for (const [pointIndex, point] of configuration.operating_points.entries()) {
          const variable = `p${index}_${pointIndex}`;
          bounds.push(`${variable} >= 0`);
          allocations.set(variable, 1);
          production.set(variable, point.operations_per_second);
          for (const flow of point.inputs) allInputs.push({flow, variable});
        }
        constraints.push(`operating_machines_${index}: ${expression(allocations)} = 0`);
        constraints.push(`operating_output_${index}: ${expression(production)} = 0`);
      }
      for (const [slot, {flow, variable: consumption}] of allInputs.entries()) {
        nonnegative(flow.amount, 'Configured input amount');
        for (const resource of flow.choices ?? [flow.resource]) if (!resources.has(resource)) throw new Error(`Unknown configured input ${resource}.`);
        const selected = own(request.ingredients, `${recipe.id}#${slot}`);
        if (selected && !(flow.choices ?? [flow.resource]).includes(selected)) throw new Error(`The pinned ingredient is unavailable in ${recipe.id}, slot ${slot + 1}.`);
        const choices = selected ? [selected] : flow.choices ?? [flow.resource];
        if (choices.length === 1) {
          add(rows.get(choices[0]), consumption, -flow.amount);
          inputTerms.push({resource: choices[0], variable: consumption, coefficient: flow.amount, slot});
        } else {
          const alternatives = new Map([[consumption, -flow.amount]]);
          choices.forEach((resource, choice) => {
            const variable = `a${index}_${slot}_${choice}`;
            alternatives.set(variable, 1);
            bounds.push(`${variable} >= 0`);
            add(rows.get(resource), variable, -1);
            inputTerms.push({resource, variable, coefficient: 1, slot});
          });
          constraints.push(`ingredient_${index}_${slot}: ${expression(alternatives)} = 0`);
        }
      }
      const returnTerms = [];
      for (const term of inputTerms) {
        const returns = own(allInputs[term.slot].flow.returns, term.resource) ?? [];
        for (const returned of returns) {
          if (!resources.has(returned.resource) || returned.resource === ENERGY) throw new Error(`Invalid returned material in ${recipe.id}.`);
          nonnegative(returned.amount, 'Returned amount per input unit');
          const coefficient = term.coefficient * returned.amount;
          add(rows.get(returned.resource), term.variable, coefficient);
          returnTerms.push({resource: returned.resource, variable: term.variable, coefficient});
        }
      }
      for (const flow of recipe.outputs) add(rows.get(flow.resource), operation, flow.amount);
      if (energy) add(rows.get(ENERGY), operation, -energy);
      if (idle) add(rows.get(ENERGY), machine, -idle * 20);
      const installed = own(request.installed, configuration.id);
      if (installed !== undefined) {
        nonnegative(installed, 'Installed count');
        if (!Number.isInteger(installed)) throw new Error('Installed counts must be whole machines.');
        constraints.push(`installed_${index}: ${machine} = ${installed}`);
      }
      const limit = own(request.limits, configuration.id);
      if (limit !== undefined) {
        nonnegative(limit, 'Machine limit');
        if (!Number.isInteger(limit)) throw new Error('Machine limits must be whole numbers.');
        constraints.push(`limit_${index}: ${machine} <= ${limit}`);
      }
      const dispatch = own(request.dispatch, configuration.id);
      if (dispatch !== undefined) {
        if (dispatch.minimum !== undefined) constraints.push(`dispatch_min_${index}: ${operation} >= ${nonnegative(dispatch.minimum, 'Minimum operation rate')}`);
        if (dispatch.maximum !== undefined) constraints.push(`dispatch_max_${index}: ${operation} <= ${nonnegative(dispatch.maximum, 'Maximum operation rate')}`);
      }
      lines.push({recipe, configuration, operation, machine, inputTerms, returnTerms});
      hasConfiguration = true;
    }
    if (hasConfiguration) {
      if (!routeCandidates.has(recipe.primary)) routeCandidates.set(recipe.primary, []);
      routeCandidates.get(recipe.primary).push(recipe.id);
    }
  }
  for (const [resource, recipeId] of Object.entries(request.routes ?? {})) {
    if (!routeCandidates.get(resource)?.includes(recipeId)) throw new Error(`Pinned route is unavailable: ${recipeId}.`);
  }
  for (const [recipe, minimum] of Object.entries(request.recipe_minimum_rates ?? {})) {
    const terms = new Map(lines.filter(line => line.recipe.id === recipe).map(line => [line.operation, 1]));
    constraints.push(`recipe_goal_${constraints.length}: ${expression(terms)} >= ${nonnegative(minimum, 'Recipe goal operation rate')}`);
  }
  const supplies = [];
  for (const supply of request.external ?? []) {
    if (!resources.has(supply.resource)) throw new Error(`Unknown external resource: ${supply.resource}.`);
    const name = `s${supplies.length}`;
    add(rows.get(supply.resource), name, 1);
    add(objective, name, weights.external * nonnegative(supply.cost ?? 1, 'External supply cost'));
    bounds.push(`${name} >= 0`);
    if (supply.limit !== undefined) bounds.push(`${name} <= ${nonnegative(supply.limit, 'External supply limit')}`);
    supplies.push({...supply, name});
  }
  const reserve = nonnegative(request.reserve_fraction ?? 0, 'Generation reserve');
  if (reserve) {
    if (!resources.has(ENERGY)) throw new Error('Generation reserve needs an energy resource.');
    const terms = new Map();
    for (const line of lines) {
      const output = line.recipe.outputs.filter(flow => flow.resource === ENERGY).reduce((sum, flow) => sum + flow.amount, 0);
      add(terms, line.machine, output * line.configuration.operations_per_second - (1 + reserve) * (line.configuration.idle_eu_per_tick ?? 0) * 20);
      add(terms, line.operation, -(1 + reserve) * (line.configuration.eu_per_operation ?? 0));
      for (const input of line.inputTerms) if (input.resource === ENERGY) add(terms, input.variable, -(1 + reserve) * input.coefficient);
    }
    const firmExternal = supplies.filter(supply => supply.resource === ENERGY).reduce((sum, supply) => sum + nonnegative(supply.firm_capacity ?? 0, 'Firm external power capacity'), 0);
    constraints.push(`generation_reserve: ${expression(terms)} >= ${(1 + reserve) * demands.get(ENERGY) - firmExternal}`);
  }
  let index = 0;
  for (const [resource, terms] of rows) {
    constraints.push(`balance_${index++}: ${expression(terms)} >= ${demands.get(resource)}`);
  }
  const text = ['Minimize', `cost: ${expression(objective)}`, 'Subject To', ...constraints,
    'Bounds', ...bounds, ...(integers.length ? ['Generals', integers.join(' ')] : []), 'End'].join('\n');
  return {text, lines, supplies, rows, demands, routeCandidates, exclusions, reserve};
}

function decode(model, solution) {
  const value = name => solution.Columns[name]?.Primal ?? 0;
  for (const line of model.lines) {
    const count = value(line.machine);
    if (!Number.isSafeInteger(Math.round(count)) || Math.abs(count - Math.round(count)) > 1e-6) {
      throw new Error(`The solver returned a non-integral machine count for ${line.configuration.id}.`);
    }
    const capacity = Math.round(count) * line.configuration.operations_per_second;
    const tolerance = Math.max(1e-7, Number.EPSILON * Math.abs(capacity) * 16);
    if (value(line.operation) > capacity + tolerance) {
      throw new Error(`The allocation exceeds capacity for ${line.configuration.id}.`);
    }
  }
  const lines = model.lines.filter(line => value(line.machine) > 0.5).map(line => ({
    recipe: line.recipe.id,
    primary: line.recipe.primary,
    configuration: line.configuration.id,
    machine: line.configuration.machine,
    machines: Math.round(value(line.machine)),
    operations_per_second: value(line.operation),
    capacity_per_second: Math.round(value(line.machine)) * line.configuration.operations_per_second,
    utilization: value(line.operation) / (Math.round(value(line.machine)) * line.configuration.operations_per_second),
    inputs: combineFlows(line.inputTerms.map(term => ({resource: term.resource, rate: term.coefficient * value(term.variable)}))),
    ingredient_choices: line.inputTerms.map(term => ({resource: term.resource, rate: term.coefficient * value(term.variable), slot: term.slot})).filter(flow => flow.rate > 1e-12),
    outputs: combineFlows([...line.recipe.outputs.map(flow => ({resource: flow.resource, rate: flow.amount * value(line.operation)})),
      ...line.returnTerms.map(term => ({resource: term.resource, rate: term.coefficient * value(term.variable)}))]),
    power_eu_per_tick: value(line.operation) * (line.configuration.eu_per_operation ?? 0) / 20 + Math.round(value(line.machine)) * (line.configuration.idle_eu_per_tick ?? 0),
    generation_capacity_eu_per_tick: line.recipe.outputs.filter(flow => flow.resource === ENERGY).reduce((sum, flow) => sum + flow.amount, 0) * Math.round(value(line.machine)) * line.configuration.operations_per_second / 20,
    configuration_details: line.configuration,
  }));
  const balances = [];
  for (const [resource, terms] of model.rows) {
    let net = 0;
    let magnitude = 0;
    for (const [name, coefficient] of terms) {
      net += value(name) * coefficient;
      magnitude += Math.abs(value(name) * coefficient);
    }
    const demand = model.demands.get(resource);
    const tolerance = Math.max(1e-7, magnitude * Number.EPSILON * 16);
    if (net < demand - tolerance) {
      throw new Error(`The numerical solution failed the resource balance check for ${resource}.`);
    }
    balances.push({resource, demand, net, surplus: net - demand, numerical_tolerance: tolerance});
  }
  const external = model.supplies.map(supply => ({resource: supply.resource, rate: value(supply.name)}));
  const gross = lines.reduce((sum, line) => sum + line.outputs.filter(flow => flow.resource === ENERGY).reduce((amount, flow) => amount + flow.rate / 20, 0), 0);
  const generationCapacity = lines.reduce((sum, line) => sum + line.generation_capacity_eu_per_tick, 0);
  const consumption = lines.reduce((sum, line) => sum + line.power_eu_per_tick + line.inputs.filter(flow => flow.resource === ENERGY).reduce((amount, flow) => amount + flow.rate / 20, 0), 0);
  const demand = (model.demands.get(ENERGY) ?? 0) / 20;
  const externalPower = external.filter(supply => supply.resource === ENERGY).reduce((sum, supply) => sum + supply.rate / 20, 0);
  const firmExternal = model.supplies.filter(supply => supply.resource === ENERGY).reduce((sum, supply) => sum + (supply.firm_capacity ?? 0) / 20, 0);
  const reserveRequired = (1 + model.reserve) * (consumption + demand);
  if (model.reserve && generationCapacity + firmExternal < reserveRequired - Math.max(1e-7, reserveRequired * Number.EPSILON * 16)) throw new Error('The numerical solution failed the generation reserve check.');
  const power = {gross_generation_eu_per_tick: gross, installed_generation_eu_per_tick: generationCapacity,
    consumption_eu_per_tick: consumption, infrastructure_and_goal_eu_per_tick: demand,
    external_eu_per_tick: externalPower, operating_margin_eu_per_tick: gross + externalPower - consumption - demand,
    installed_margin_eu_per_tick: generationCapacity + firmExternal - consumption - demand, reserve_fraction: model.reserve,
    reserve_basis: 'Installed generation capacity. Standby fuel and bootstrap stocks are separate requirements.'};
  return {lines, balances, power, startup: startupRequirements(lines), steady_state_only: true, external, ...allocateFlows(lines, external, model.demands)};
}

export function solveFactory(highs, dataset, request) {
  const duration = nonnegative(request.time_limit_ms ?? 20000, 'Calculation time limit');
  const deadline = Date.now() + duration;
  validateDataset(dataset);
  const exhausted = new Error('The configuration search reached its time limit.');
  try {
    dataset = prepareDataset(dataset, request, () => { if (Date.now() >= deadline) throw exhausted; });
  } catch (error) {
    if (error !== exhausted) throw error;
    return {status: 'limit', phase: 'configuration', optimal: false, incumbent: null, branches: 0};
  }
  const resolved = resolveGoals(dataset, request);
  request = resolved.request;
  const branches = [{}];
  let best = null;
  let visited = 0;
  let lastExclusions = [];
  while (branches.length) {
    if (Date.now() >= deadline) return {status: 'limit', optimal: false, incumbent: best, branches: visited};
    const choices = branches.pop();
    const model = compileFactory(dataset, request, choices);
    if (Date.now() >= deadline) return {status: 'limit', phase: 'model', optimal: false, incumbent: best, branches: visited};
    lastExclusions = model.exclusions;
    const solution = highs.solve(model.text, {output_flag: false, time_limit: Math.max(0.01, (deadline - Date.now()) / 1000),
      mip_rel_gap: 0, mip_feasibility_tolerance: 1e-9, primal_feasibility_tolerance: 1e-9});
    visited++;
    if (solution.Status === 'Infeasible') continue;
    if (solution.Status !== 'Optimal') return {status: 'limit', solver_status: solution.Status, optimal: false, incumbent: best, branches: visited};
    if (best && solution.ObjectiveValue >= best.objective - 1e-9) continue;
    const decoded = decode(model, solution);
    const active = new Map();
    for (const line of decoded.lines.filter(line => line.operations_per_second > 1e-9)) {
      if (!active.has(line.primary)) active.set(line.primary, new Set());
      active.get(line.primary).add(line.recipe);
    }
    const conflict = request.single_primary_route === false ? null : [...active].find(([resource, recipes]) => resource !== ENERGY && recipes.size > 1);
    if (conflict) {
      // Branch over every available route, including routes absent from this relaxation's solution.
      for (const recipe of model.routeCandidates.get(conflict[0])) branches.push({...choices, [conflict[0]]: recipe});
    } else {
      best = {...decoded, targets: resolved.targets, objective: solution.ObjectiveValue, exclusions: model.exclusions};
    }
  }
  return best ? {...best, status: 'optimal', optimal: true, branches: visited} : {status: 'infeasible', optimal: false, exclusions: lastExclusions, branches: visited};
}
