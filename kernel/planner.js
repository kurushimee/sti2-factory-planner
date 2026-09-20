import {allocateFlows} from './flows.js';

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
      if (!resources.has(flow.resource)) throw new Error(`Unknown resource ${flow.resource} in ${recipe.id}.`);
      nonnegative(flow.amount, 'Recipe amount');
    }
    const reason = recipe.unsupported ||
      (recipe.replication && !request.replication ? 'Replication is disabled.' : '') ||
      (request.disabled_recipes?.includes(recipe.id) ? 'The recipe is disabled.' : '');
    if (reason) {
      exclusions.push({recipe: recipe.id, reason});
      continue;
    }
    const pin = request.routes?.[recipe.primary] ?? routeChoices[recipe.primary];
    if (pin && pin !== recipe.id) continue;
    let hasConfiguration = false;
    for (const configuration of recipe.configurations) {
      if (request.disabled_machines?.includes(configuration.machine)) continue;
      if (request.configurations?.[recipe.id] && request.configurations[recipe.id] !== configuration.id) continue;
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
      for (const flow of recipe.inputs) add(rows.get(flow.resource), operation, -flow.amount);
      for (const flow of recipe.outputs) add(rows.get(flow.resource), operation, flow.amount);
      if (energy) add(rows.get(ENERGY), operation, -energy);
      if (idle) add(rows.get(ENERGY), machine, -idle * 20);
      const installed = request.installed?.[configuration.id];
      if (installed !== undefined) {
        nonnegative(installed, 'Installed count');
        if (!Number.isInteger(installed)) throw new Error('Installed counts must be whole machines.');
        constraints.push(`installed_${index}: ${machine} = ${installed}`);
      }
      const limit = request.limits?.[configuration.id];
      if (limit !== undefined) {
        nonnegative(limit, 'Machine limit');
        if (!Number.isInteger(limit)) throw new Error('Machine limits must be whole numbers.');
        constraints.push(`limit_${index}: ${machine} <= ${limit}`);
      }
      lines.push({recipe, configuration, operation, machine});
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
  let index = 0;
  for (const [resource, terms] of rows) {
    constraints.push(`balance_${index++}: ${expression(terms)} >= ${demands.get(resource)}`);
  }
  const text = ['Minimize', `cost: ${expression(objective)}`, 'Subject To', ...constraints,
    'Bounds', ...bounds, ...(integers.length ? ['Generals', integers.join(' ')] : []), 'End'].join('\n');
  return {text, lines, supplies, rows, demands, routeCandidates, exclusions};
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
    inputs: line.recipe.inputs.map(flow => ({resource: flow.resource, rate: flow.amount * value(line.operation)})),
    outputs: line.recipe.outputs.map(flow => ({resource: flow.resource, rate: flow.amount * value(line.operation)})),
    power_eu_per_tick: value(line.operation) * (line.configuration.eu_per_operation ?? 0) / 20 + Math.round(value(line.machine)) * (line.configuration.idle_eu_per_tick ?? 0),
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
  return {lines, balances, steady_state_only: true, external, ...allocateFlows(lines, external, model.demands)};
}

export function solveFactory(highs, dataset, request) {
  const deadline = Date.now() + (request.time_limit_ms ?? 20000);
  const branches = [{}];
  let best = null;
  let visited = 0;
  let lastExclusions = [];
  while (branches.length) {
    if (Date.now() >= deadline) return {status: 'limit', optimal: false, incumbent: best, branches: visited};
    const choices = branches.pop();
    const model = compileFactory(dataset, request, choices);
    lastExclusions = model.exclusions;
    const solution = highs.solve(model.text, {output_flag: false, time_limit: Math.max(0.01, (deadline - Date.now()) / 1000), mip_rel_gap: 0});
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
    const conflict = request.single_primary_route === false ? null : [...active].find(([, recipes]) => recipes.size > 1);
    if (conflict) {
      // Branch over every available route, including routes absent from this relaxation's solution.
      for (const recipe of model.routeCandidates.get(conflict[0])) branches.push({...choices, [conflict[0]]: recipe});
    } else {
      best = {...decoded, objective: solution.ObjectiveValue, exclusions: model.exclusions};
    }
  }
  return best ? {...best, status: 'optimal', optimal: true, branches: visited} : {status: 'infeasible', optimal: false, exclusions: lastExclusions, branches: visited};
}
