import {productionTime} from './quantity.js';
import * as Q from './rational.js';

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) throw new Error(`${name} must be positive and within the supported numeric range.`);
  return value;
}

function goalRate(goal) {
  if (!goal.rate_ratio) return goal.rate;
  const ratio = goal.rate_ratio;
  if (typeof ratio !== 'object' || ratio === null ||
      !/^[1-9]\d{0,99}$/.test(String(ratio.numerator)) ||
      !/^[1-9]\d{0,99}$/.test(String(ratio.denominator))) {
    throw new Error('An exact goal rate needs positive numerator and denominator text of at most 100 digits.');
  }
  const rate = Q.number(Q.ratio(BigInt(ratio.numerator), BigInt(ratio.denominator)));
  positive(rate, 'Exact goal rate');
  if (goal.rate !== undefined && (!Number.isFinite(goal.rate) ||
      Math.abs(goal.rate - rate) > Math.max(1e-15, Math.abs(rate) * 1e-12))) {
    throw new Error('The numeric goal rate disagrees with its exact fraction.');
  }
  return rate;
}

export function resolveGoals(dataset, request) {
  const recipes = new Map(dataset.recipes.map(recipe => [recipe.id, recipe]));
  const routes = Object.assign(Object.create(null), request.routes);
  const configurations = Object.assign(Object.create(null), request.configurations);
  const selectedConfigurations = new Map();
  const configurationRates = new Map();
  const recipeRates = Object.create(null);
  const recipeResourceRates = new Map();
  const targets = [];
  const goals = (request.goals ?? []).map((goal, index) => {
    const kind = goal.kind ?? 'rate';
    if (!['rate', 'capacity', 'quantity'].includes(kind)) throw new Error(`Unknown goal type: ${kind}.`);
    let rate = goalRate(goal);
    let recipe;
    if (goal.recipe) {
      recipe = recipes.get(goal.recipe);
      if (!recipe) throw new Error(`Unknown goal recipe: ${goal.recipe}.`);
      if (!recipe.outputs.some(output => output.resource === goal.resource && output.amount > 0)) throw new Error(`The goal recipe does not produce ${goal.resource}.`);
      if (Object.hasOwn(routes, goal.resource) && routes[goal.resource] !== recipe.id) throw new Error(`Conflicting recipe selections for ${goal.resource}.`);
    }
    if (kind === 'capacity') {
      if (!recipe) throw new Error('A capacity goal needs a recipe.');
      const configuration = recipe.configurations.find(value => value.id === goal.configuration);
      if (!configuration) throw new Error(`The goal configuration is unavailable: ${goal.configuration}.`);
      if (!Number.isSafeInteger(goal.machines) || goal.machines < 1) throw new Error('A capacity goal needs a positive whole-machine count.');
      const pinned = configurations[recipe.id];
      if (pinned && !(Array.isArray(pinned) ? pinned : [pinned]).includes(configuration.id)) throw new Error(`Conflicting machine configurations for ${recipe.id}.`);
      if (!selectedConfigurations.has(recipe.id)) selectedConfigurations.set(recipe.id, new Set());
      selectedConfigurations.get(recipe.id).add(configuration.id);
      configurationRates.set(configuration.id, (configurationRates.get(configuration.id) ?? 0) + configuration.operations_per_second * goal.machines);
      const amount = recipe.outputs.filter(output => output.resource === goal.resource).reduce((sum, output) => sum + output.amount, 0);
      rate = configuration.operations_per_second * goal.machines * amount;
    }
    positive(rate, 'Goal rate');
    if (recipe) {
      const amount = recipe.outputs.filter(output => output.resource === goal.resource).reduce((sum, output) => sum + output.amount, 0);
      if (!recipeResourceRates.has(recipe.id)) recipeResourceRates.set(recipe.id, new Map());
      const resources = recipeResourceRates.get(recipe.id);
      resources.set(goal.resource, (resources.get(goal.resource) ?? 0) + rate / amount);
    }
    const target = {index, resource: goal.resource, kind, rate};
    if (kind === 'quantity') {
      Object.assign(target, productionTime(goal.quantity, rate, goal.rate_ratio));
    }
    targets.push(target);
    return {...goal, rate};
  });
  for (const [recipe, values] of selectedConfigurations) configurations[recipe] = values.size === 1 ? [...values][0] : [...values];
  for (const [recipe, resources] of recipeResourceRates) recipeRates[recipe] = Math.max(...resources.values());
  const dispatch = Object.assign(Object.create(null), request.dispatch);
  for (const [configuration, minimum] of configurationRates) dispatch[configuration] = {...dispatch[configuration], minimum: Math.max(minimum, dispatch[configuration]?.minimum ?? 0)};
  return {request: {...request, goals, routes, configurations, dispatch, recipe_minimum_rates: recipeRates}, targets};
}
