import {constructionBill} from './construction.js';

function gcd(a, b) {while (b) [a, b] = [b, a % b]; return a;}
function fraction(value) {
  const [mantissa, exponent = '0'] = String(value).split('e');
  const [whole, decimal = ''] = mantissa.split('.');
  const shift = Number(exponent) - decimal.length;
  const numerator = BigInt(whole + decimal);
  return shift >= 0 ? [numerator * 10n ** BigInt(shift), 1n] : [numerator, 10n ** BigInt(-shift)];
}

// Compare normalized material quantities exactly as decimal data. Duration and power
// remain machine properties; conditional or ambiguous ingredients need their own rules.
export function materialSignature(recipe) {
  if (recipe.catalysts?.length || recipe.conditions?.length || recipe.tool_usage || recipe.expected_yields) return null;
  const totals = new Map();
  for (const direction of ['inputs', 'outputs']) for (const flow of recipe[direction]) {
    if (!flow.resource || flow.choices || flow.returns || (flow.probability ?? 1) !== 1) return null;
    const key = `${direction}:${flow.resource}`, [n, d] = fraction(flow.amount);
    const [previous, denominator] = totals.get(key) ?? [0n, 1n];
    const sum = previous * d + n * denominator, product = denominator * d, divisor = gcd(sum, product);
    totals.set(key, [sum / divisor, product / divisor]);
  }
  const entries = [...totals].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const reference = entries.find(([key]) => key.startsWith('outputs:'))?.[1];
  if (!reference) return null;
  return JSON.stringify(entries.map(([key, [n, d]]) => {
    const numerator = n * reference[1], denominator = d * reference[0], divisor = gcd(numerator, denominator);
    return [key, `${numerator / divisor}/${denominator / divisor}`];
  }));
}

export function preferredRecipes(dataset, request) {
  if (request.honor_route_preferences !== undefined && typeof request.honor_route_preferences !== 'boolean') throw new Error('Route preferences must be enabled or disabled with a boolean.');
  if (request.honor_route_preferences === false || !dataset.route_preferences?.length) return {dataset, applied: []};
  const recipes = new Map(dataset.recipes.map(recipe => [recipe.id, recipe]));
  const resources = new Set(dataset.resources.map(resource => resource.id));
  const protectedRecipes = new Set([...Object.values(request.routes ?? {}), ...(request.goals ?? []).map(goal => goal.recipe).filter(Boolean),
    ...Object.keys(request.configurations ?? {}), ...Object.keys(request.machine_setups ?? {})]);
  const usable = recipe => {
    if (!recipe || recipe.unsupported || request.disabled_recipes?.includes(recipe.id)) return false;
    const pinned = request.configurations?.[recipe.id];
    return recipe.configurations.some(configuration => {
      if (pinned && !(Array.isArray(pinned) ? pinned : [pinned]).includes(configuration.id)) return false;
      if (request.disabled_machines?.includes(configuration.machine) || configuration.structure?.status === 'unsupported') return false;
      if (configuration.inputs?.length || configuration.operating_points) return false;
      if (Object.hasOwn(request.installed ?? {}, configuration.id) || Object.hasOwn(request.limits ?? {}, configuration.id) ||
          request.dispatch?.[configuration.id]?.maximum !== undefined) return false;
      return !request.construction || !constructionBill(configuration, resources).error;
    });
  };
  const applied = [], removed = new Set();
  for (const preference of dataset.route_preferences) {
    if (!recipes.has(preference.alternative) || protectedRecipes.has(preference.alternative) || !usable(recipes.get(preference.preferred))) continue;
    if (recipes.get(preference.alternative).configurations.some(configuration => [request.installed, request.limits, request.dispatch]
      .some(settings => Object.hasOwn(settings ?? {}, configuration.id)))) continue;
    removed.add(preference.alternative);
    applied.push(preference);
  }
  return {dataset: withRecipes(dataset, dataset.recipes.filter(recipe => !removed.has(recipe.id))), applied};
}

export function withRecipes(dataset, recipes) {
  const ids = new Set(recipes.map(recipe => recipe.id));
  return {...dataset, recipes, ...(dataset.route_preferences ? {route_preferences: dataset.route_preferences
    .filter(preference => ids.has(preference.preferred) && ids.has(preference.alternative))} : {})};
}

export function validatePreferences(dataset) {
  if (dataset.route_preferences === undefined) return;
  if (!Array.isArray(dataset.route_preferences)) throw new Error('Route preferences must be a list.');
  const recipes = new Map(dataset.recipes.map(recipe => [recipe.id, recipe]));
  const signatures = new Map(), pairs = new Set(), children = new Map(), indegrees = new Map();
  const signature = id => {
    if (!signatures.has(id)) signatures.set(id, materialSignature(recipes.get(id)));
    return signatures.get(id);
  };
  for (const preference of dataset.route_preferences) {
    if (!preference || typeof preference !== 'object' || !recipes.has(preference.preferred) || !recipes.has(preference.alternative) ||
        typeof preference.reason !== 'string' || !preference.reason.trim()) throw new Error('Every route preference needs two known recipes and an explanation.');
    const pair = JSON.stringify([preference.preferred, preference.alternative]);
    if (pairs.has(pair)) throw new Error('Duplicate route preference.');
    pairs.add(pair);
    if (!signature(preference.preferred) || signature(preference.preferred) !== signature(preference.alternative)) throw new Error('A route preference must preserve exactly the same normalized materials and outputs.');
    if (!children.has(preference.preferred)) children.set(preference.preferred, []);
    children.get(preference.preferred).push(preference.alternative);
    if (!indegrees.has(preference.preferred)) indegrees.set(preference.preferred, 0);
    indegrees.set(preference.alternative, (indegrees.get(preference.alternative) ?? 0) + 1);
  }
  const queue = [...indegrees].filter(([, degree]) => !degree).map(([id]) => id);
  for (let cursor = 0; cursor < queue.length; cursor++) for (const child of children.get(queue[cursor]) ?? []) {
    indegrees.set(child, indegrees.get(child) - 1);
    if (!indegrees.get(child)) queue.push(child);
  }
  if (queue.length !== indegrees.size) throw new Error('Route preferences cannot contain a cycle.');
}

export function describePreferences(result, applied, fallback = false) {
  if (!result.lines) return result;
  if (!fallback) for (const line of result.lines) {
    const matches = applied.filter(preference => preference.preferred === line.recipe);
    if (matches.length) line.route_preference = {reason: [...new Set(matches.map(value => value.reason))].join(' '),
      alternatives: matches.map(value => value.alternative)};
  }
  return {...result, recipe_preferences: {applied: fallback ? [] : applied, fallback}};
}
