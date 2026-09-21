import {addConstruction, decodeConstruction} from './construction.js';
import {runSolver} from './solver.js';

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
  return {text, construction, integers: model.integers, balanceResources};
}

export function solveConstructionOrder(highs, model, timeLimitSeconds = 60) {
  if (!(timeLimitSeconds > 0) || !Number.isFinite(timeLimitSeconds)) throw new Error('The construction time limit must be positive and finite.');
  const result = runSolver(highs, model.text, {time_limit: timeLimitSeconds}, undefined, {row_duals: !model.integers.length});
  if (!result.feasible) return {status: result.status, optimal: false, construction: null};
  const value = name => result.columns[name] ?? 0;
  for (const variable of model.integers) {
    const amount = value(variable);
    if (!Number.isSafeInteger(Math.round(amount)) || Math.abs(amount - Math.round(amount)) > 1e-6) {
      throw new Error('The construction order contains a fractional whole quantity.');
    }
  }
  return {status: result.optimal ? 'optimal' : 'feasible', optimal: result.optimal,
    construction: decodeConstruction(model.construction, value),
    ...(result.row_duals ? {marginal_costs: Object.fromEntries(model.balanceResources.map((resource, index) =>
      [resource, result.row_duals[`construction_balance_${index}`]]))} : {}),
    optimization: {objective: result.objective, lower_bound: result.lower_bound, relative_gap: result.relative_gap}};
}
