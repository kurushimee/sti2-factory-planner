import {addConstruction, ConstructionBalanceError, decodeConstruction} from './construction.js';
import {readSolverResult} from './solver.js';
import {productionRouteOwnership} from './route_ownership.js';

function expression(terms) {
  return [...terms].filter(([, amount]) => amount !== 0)
    .map(([variable, amount]) => `${amount < 0 ? '-' : '+'} ${Math.abs(amount)} ${variable}`).join(' ') || '0 zero';
}

// The caller supplies enabled, configured workstations. The order buys parts, not sustained output.
export function compileConstructionOrder(lines, definitions, request, requirements) {
  if (!request.construction) throw new Error('A construction order needs construction settings.');
  if (!Array.isArray(requirements)) throw new Error('A construction order needs a list of part quantities.');
  const resources = new Map(definitions.map(resource => [resource.id, resource]));
  const model = {lines, construction_only: true, objective: new Map(), constraints: [],
    bounds: ['zero = 0', 'order = 1'], integers: [], fixed_builds: requirements.length ?
      [{machine: 'order', configuration: {build_requirements: requirements}}] : []};
  const construction = addConstruction(model, new Set(resources.keys()), request, resources);
  const text = ['Minimize', `cost: ${expression(model.objective)}`, 'Subject To', ...model.constraints,
    'Bounds', ...model.bounds, ...(model.integers.length ? ['Generals', model.integers.join(' ')] : []), 'End'].join('\n');
  const balanceResources = [...construction.rows].filter(([, row]) => row.size).map(([resource]) => resource);
  return {text, construction, integers: model.integers, balanceResources, request};
}

export function solveConstructionOrder(highs, model, timeLimitSeconds = 60, production = {lines: []}, onProgress = () => {}) {
  if (!(timeLimitSeconds > 0) || !Number.isFinite(timeLimitSeconds)) throw new Error('The construction time limit must be positive and finite.');
  const deadline = Date.now() + timeLimitSeconds * 1000;
  const protectedRecipes = new Set([...production.lines.map(line => line.recipe), ...Object.values(model.request.routes ?? {})]);
  const forcedExclusions = fixedProductionExclusions(model, production);
  const pending = [forcedExclusions], visited = new Set();
  let lowerBound = null;
  let numericalRetries = 0;
  const native = highs.createModel({format: 'lp', data: model.text});
  try {
    native.options.set({output_flag: false, mip_rel_gap: 0, mip_feasibility_tolerance: 1e-9, primal_feasibility_tolerance: 1e-9});
    const byRecipe = new Map();
    for (const route of model.construction.routes) {
      if (!byRecipe.has(route.recipe)) byRecipe.set(route.recipe, []);
      byRecipe.get(route.recipe).push(native.getColByName(route.variable));
    }
    let previous = new Set();
    while (pending.length && Date.now() < deadline) {
      const excluded = pending.pop(), key = JSON.stringify([...excluded].sort());
      if (visited.has(key)) continue;
      visited.add(key);
      for (const recipe of new Set([...previous, ...excluded])) {
        if (previous.has(recipe) === excluded.has(recipe)) continue;
        for (const index of byRecipe.get(recipe) ?? []) native.changeColBounds(index, 0, excluded.has(recipe) ? 0 : highs.infinity);
      }
      previous = excluded;
      native.options.set('time_limit', native.getRunTime() + Math.max(0.001, (deadline - Date.now()) / 1000));
      native.run();
      let result = readSolverResult(highs, native, {row_duals: !model.integers.length});
      if (!result.feasible) {
        onProgress({phase: 'construction_routes', attempt: visited.size, status: result.status});
        if (visited.size === 1) return {status: result.status, optimal: false, construction: null};
        continue;
      }
      let decoded;
      try { decoded = decodeOrder(model, result); }
      catch (error) {
        if (!(error instanceof ConstructionBalanceError)) throw error;
        numericalRetries++;
        onProgress({phase: 'construction_precision', attempt: visited.size, resource: error.balance.resource});
        if (Date.now() >= deadline) return numericalFailure(error);
        native.clearSolver();
        native.options.set({presolve: 'off', simplex_scale_strategy: 0, primal_feasibility_tolerance: 1e-10,
          time_limit: native.getRunTime() + Math.max(0.001, (deadline - Date.now()) / 1000)});
        native.run();
        result = readSolverResult(highs, native, {row_duals: !model.integers.length});
        if (!result.feasible) return numericalFailure(error);
        try { decoded = decodeOrder(model, result); }
        catch (retryError) {
          if (!(retryError instanceof ConstructionBalanceError)) throw retryError;
          return numericalFailure(retryError);
        }
      }
      if (visited.size === 1) lowerBound = result.lower_bound;
      const ownership = productionRouteOwnership({...production, construction: decoded.construction}, model.request);
      onProgress({phase: 'construction_routes', attempt: visited.size, conflicts: ownership.conflict});
      if (!ownership.conflict.length) {
        const optimal = result.optimal && excluded.size === forcedExclusions.size;
        return {...decoded, status: optimal ? 'optimal' : 'feasible', optimal,
          primary_routes: ownership.assignments, search: {excluded_recipes: [...excluded], attempts: visited.size,
            ...(numericalRetries ? {numerical_retries: numericalRetries} : {})},
          optimization: {objective: result.objective, lower_bound: lowerBound,
            relative_gap: lowerBound === null ? null : Math.max(0, (result.objective - lowerBound) / Math.max(1e-12, Math.abs(result.objective)))}};
      }
      for (const recipe of ownership.conflict) if (!protectedRecipes.has(recipe) && !excluded.has(recipe)) pending.push(new Set([...excluded, recipe]));
    }
    return {status: 'limit', optimal: false, construction: null, search: {attempts: visited.size},
      reason: 'No construction order satisfying the primary route choices was established within this search.'};
  } finally {native.dispose();}
}

function numericalFailure(error) {
  const {resource, surplus, tolerance, magnitude} = error.balance;
  return {status: 'numerical_error', optimal: false, construction: null,
    reason: error.message, balance: {resource, surplus, tolerance, magnitude}};
}

function fixedProductionExclusions(model, production) {
  if (model.request.single_primary_route === false) return new Set();
  const net = new Map();
  for (const line of production.lines) {
    if (!(line.operations_per_second > 1e-10)) continue;
    if (!net.has(line.recipe)) net.set(line.recipe, new Map());
    const flows = net.get(line.recipe);
    for (const flow of line.outputs) flows.set(flow.resource, (flows.get(flow.resource) ?? 0) + flow.rate);
    for (const flow of line.inputs) flows.set(flow.resource, (flows.get(flow.resource) ?? 0) - flow.rate);
  }
  const owners = new Map();
  for (const [recipe, flows] of net) {
    const outputs = [...flows].filter(([resource, amount]) => resource !== 'energy:eu' && amount > 1e-10);
    if (outputs.length !== 1 || (flows.get('energy:eu') ?? 0) > 1e-10) continue;
    const resource = outputs[0][0];
    if (!owners.has(resource)) owners.set(resource, new Set());
    owners.get(resource).add(recipe);
  }
  const possible = new Map();
  for (const route of model.construction.routes) {
    if (!possible.has(route.recipe)) possible.set(route.recipe, new Set());
    for (const flow of route.outputTerms) possible.get(route.recipe).add(flow.resource);
  }
  const excluded = new Set();
  for (const [recipe, outputs] of possible) {
    if (outputs.size !== 1) continue;
    const resource = [...outputs][0], owner = owners.get(resource);
    const ownerOutputs = owner?.size === 1 ? possible.get([...owner][0]) : null;
    const goals = new Set((model.request.goals ?? []).filter(goal => goal.resource === resource && goal.recipe).map(goal => goal.recipe));
    // A sustained recipe with only this net output cannot give its purpose to another recipe.
    if (owner?.size === 1 && !owner.has(recipe) && ownerOutputs?.size === 1 && ownerOutputs.has(resource) && goals.size < 2) excluded.add(recipe);
  }
  return excluded;
}

function decodeOrder(model, result) {
  const value = name => result.columns[name] ?? 0;
  for (const variable of model.integers) {
    const amount = value(variable);
    if (!Number.isSafeInteger(Math.round(amount)) || Math.abs(amount - Math.round(amount)) > 1e-6) {
      throw new Error('The construction order contains a fractional whole quantity.');
    }
  }
  return {construction: decodeConstruction(model.construction, value),
    ...(result.row_duals ? {marginal_costs: Object.fromEntries(model.balanceResources.map((resource, index) =>
      [resource, result.row_duals[`construction_balance_${index}`]]))} : {})};
}
