import {configureRecipe, prepareDataset} from './catalog.js';
import {constructionBill} from './construction.js';
import {compileConstructionOrder, solveConstructionOrder} from './construction_order.js';
import {infrastructurePower} from './infrastructure.js';
import {structureContext} from './structure_bill.js';
import {withRecipes, describePreferences, preferredRecipes} from './recipe_preferences.js';

class RefinementDeadline extends Error {}

function resolvedIngredients(request, plan) {
  const ingredients = {...request.ingredients}, slots = new Map();
  for (const line of plan.lines) for (const choice of line.ingredient_choices ?? []) {
    const key = `${line.recipe}#${choice.slot}`;
    if (!slots.has(key)) slots.set(key, new Set());
    slots.get(key).add(choice.resource);
  }
  for (const [key, choices] of slots) if (choices.size === 1 && !Object.hasOwn(ingredients, key)) ingredients[key] = [...choices][0];
  return ingredients;
}

function requirementsFor(dataset, request, plan) {
  const resources = new Set(dataset.resources.map(resource => resource.id)), quantities = new Map();
  const add = (configuration, count) => {
    if (!count) return;
    const {bill, error} = constructionBill(configuration, resources);
    if (error) throw new Error(error);
    for (const flow of bill) quantities.set(flow.resource, (quantities.get(flow.resource) ?? 0) + flow.amount * count);
  };
  for (const line of plan.lines) add(line.configuration_details, line.machines);
  for (const entry of infrastructurePower(dataset, request).entries) add({structure: entry.structure, build_requirements: entry.structure.build_requirements}, entry.count);
  return [...quantities].map(([resource, amount]) => ({resource, amount}));
}

function priceOrder(highs, dataset, request, plan, deadline, checkBudget, progress) {
  const requirements = requirementsFor(dataset, request, plan);
  const orderRequest = {...request, ingredients: resolvedIngredients(request, plan),
    goals: [...(request.goals ?? []).map((goal, index) => ({...goal, rate: plan.targets?.find(target => target.index === index)?.rate ?? goal.rate})),
      ...requirements.map(flow => ({resource: flow.resource, rate: 1}))]};
  const prepared = prepareDataset(dataset, orderRequest, checkBudget, {workstations: true});
  const recipes = [];
  const installed = new Map();
  for (const line of plan.lines) {
    if (!installed.has(line.recipe)) installed.set(line.recipe, new Map());
    installed.get(line.recipe).set(line.configuration, line.configuration_details);
  }
  for (const recipe of prepared.recipes) {
    if (recipe.unsupported) continue;
    const pinned = request.configurations?.[recipe.id];
    const configurations = new Map(recipe.configurations.map(configuration => [configuration.id, configuration]));
    for (const [id, configuration] of installed.get(recipe.id) ?? []) configurations.set(id, configuration);
    const valid = [];
    for (const configuration of configurations.values()) {
      if (configuration.structure?.status === 'unsupported') continue;
      if (pinned && !(Array.isArray(pinned) ? pinned : [pinned]).includes(configuration.id)) continue;
      valid.push(configuration);
    }
    recipes.push({...recipe, configurations: valid});
  }
  checkBudget();
  const configured = withRecipes(prepared, recipes), preferred = preferredRecipes(configured, orderRequest);
  const solve = (source, until) => {
    const lines = source.recipes.flatMap(recipe => recipe.configurations.map(configuration => ({recipe, configuration})));
    const model = compileConstructionOrder(lines, dataset.resources, orderRequest, requirements);
    checkBudget();
    return solveConstructionOrder(highs, model, Math.max(0.001, (until - Date.now()) / 1000), plan, progress);
  };
  if (!preferred.applied.length) return solve(configured, deadline);
  const first = solve(preferred.dataset, Date.now() + Math.max(0, deadline - Date.now()) * 0.9);
  if (first.construction) {
    first.construction.recipe_preferences = {applied: preferred.applied, fallback: false};
    return first;
  }
  checkBudget();
  progress({phase: 'route_preference_fallback'});
  const fallback = solve(configured, deadline);
  if (fallback.construction) {
    fallback.construction.recipe_preferences = {applied: [], fallback: true};
    if (first.status !== 'infeasible') {
      fallback.status = 'feasible';
      fallback.optimal = false;
      fallback.optimization.lower_bound = null;
      fallback.optimization.relative_gap = null;
    }
  }
  return fallback;
}

function pricedConfigurations(dataset, request, plan, prices, checkBudget, broaden = false) {
  const active = new Map(), cache = new Map(), structures = structureContext(dataset);
  const ingredients = resolvedIngredients(request, plan);
  for (const line of plan.lines) {
    if (!active.has(line.recipe)) active.set(line.recipe, []);
    active.get(line.recipe).push(line);
  }
  const machineWeight = request.weights?.machines ?? 1, energyWeight = request.weights?.energy ?? 0.000001;
  const recipes = [];
  const reachable = broaden ? prepareDataset(dataset, {...request, construction: undefined}, checkBudget) :
    {recipes: dataset.recipes.filter(recipe => active.has(recipe.id))};
  for (const recipe of reachable.recipes) {
    checkBudget();
    if (recipe.unsupported) continue;
    const installed = active.get(recipe.id) ?? [];
    // The first pass expands material-sensitive loadouts. The broader pass keeps its
    // incumbent plus the ordinary capacity frontier instead of repeating that work.
    const configured = installed.length && !broaden ? configureRecipe(recipe, dataset, {...request, ingredients}, false, checkBudget, cache, structures) : recipe;
    const candidates = new Map(configured.configurations.map(configuration => [configuration.id, configuration]));
    for (const line of installed) candidates.set(line.configuration, {...line.configuration_details});
    const priced = [];
    for (const configuration of candidates.values()) {
      if (configuration.structure?.status === 'unsupported' || !configuration.build_requirements?.length) continue;
      let cost = 0;
      for (const flow of configuration.build_requirements) {
        if (!Number.isFinite(prices[flow.resource])) {cost = Infinity; break;}
        cost += flow.amount * Math.max(0, prices[flow.resource]);
      }
      if (!Number.isFinite(cost)) continue;
      const base = configuration.base_build_cost ?? configuration.build_cost ?? 1;
      priced.push({...configuration, base_build_cost: base, construction_cost_estimate: cost,
        build_cost: base + cost / machineWeight});
    }
    const kept = new Map();
    const operations = installed.reduce((sum, line) => sum + line.operations_per_second, 0);
    const score = configuration => Math.ceil(operations / configuration.operations_per_second) * configuration.build_cost * machineWeight +
      operations * (configuration.eu_per_operation ?? 0) * energyWeight;
    const keep = configurations => {for (const configuration of configurations) kept.set(configuration.id, configuration);};
    keep([...priced].sort((a, b) => score(a) - score(b)).slice(0, 4));
    if (broaden) keep([...priced].sort((a, b) => a.build_cost - b.build_cost).slice(0, 2));
    keep([...priced].sort((a, b) => a.build_cost / a.operations_per_second - b.build_cost / b.operations_per_second).slice(0, 2));
    keep(priced.filter(configuration => installed.some(line => line.configuration === configuration.id)));
    const selected = {...configured, configurations: [...kept.values()]};
    delete selected.process;
    recipes.push(selected);
  }
  return {dataset: withRecipes(dataset, recipes), ingredients,
    compared: {recipes: recipes.filter(recipe => recipe.configurations.length).length,
      configurations: recipes.reduce((sum, recipe) => sum + recipe.configurations.length, 0)}};
}

function attachCost(plan, order, estimated = false) {
  let operatingObjective = plan.objective;
  if (estimated) for (const line of plan.lines) {
    const configuration = line.configuration_details;
    operatingObjective -= line.machines * (configuration.construction_cost_estimate ?? 0);
    configuration.build_cost = configuration.base_build_cost ?? configuration.build_cost;
    delete configuration.base_build_cost;
    delete configuration.construction_cost_estimate;
  }
  const objective = operatingObjective + order.construction.objective;
  return {...plan, construction: order.construction, primary_routes: order.primary_routes, objective, status: 'feasible', optimal: false,
    optimization: {objective, lower_bound: null, relative_gap: null,
      explanation: 'Production and construction balances are verified. Reachable routes and selected machine loadouts were compared using construction material costs; the lowest total cost has not been proved.'},
    search: {...plan.search, method: 'material_cost_refinement',
      construction_attempts: order.search?.attempts ?? 1}};
}

// Every candidate is checked against a complete construction order before replacing the incumbent.
export function refineMaterialPlan(highs, dataset, request, solveOrdinary, deadline, progress = () => {}) {
  const checkBudget = () => {if (Date.now() >= deadline) throw new RefinementDeadline();};
  let best = null;
  try {
    progress({phase: 'production_baseline'});
    const ordinaryRequest = {...request, construction: undefined, time_limit_ms: Math.max(1, (deadline - Date.now()) * 0.6)};
    const baseline = solveOrdinary(dataset, ordinaryRequest);
    if (!baseline.lines) return baseline;
    checkBudget();
    progress({phase: 'construction_baseline'});
    const order = priceOrder(highs, dataset, request, baseline, deadline, checkBudget, progress);
    if (!order.construction) return {status: order.status === 'numerical_error' ? 'numerical_error' : 'limit',
      optimal: false, phase: 'construction', construction_status: order.status, ...(order.balance ? {balance: order.balance} : {}),
      reason: order.reason ?? 'No complete construction order was established with the available workstation candidates.'};
    best = attachCost(baseline, order);
    if (!order.marginal_costs) return best;
    let prices = order.marginal_costs;
    const comparisons = [];
    for (const broaden of [false, true]) {
      progress({phase: broaden ? 'route_choices' : 'machine_choices'});
      const candidates = pricedConfigurations(dataset, request, best, prices, checkBudget, broaden);
      const comparison = {scope: broaden ? 'alternative_routes' : 'current_routes', ...candidates.compared, verified: false, selected: false};
      comparisons.push(comparison);
      best.search.material_comparisons = comparisons;
      checkBudget();
      progress({phase: 'production_refinement'});
      let candidate = solveOrdinary(candidates.dataset, {...ordinaryRequest, ingredients: candidates.ingredients,
        time_limit_ms: Math.max(1, (deadline - Date.now()) / 2)}, true);
      if (!candidate.lines) continue;
      if (best.recipe_preferences && !candidate.recipe_preferences) candidate = describePreferences(candidate, best.recipe_preferences.applied, best.recipe_preferences.fallback);
      checkBudget();
      progress({phase: 'construction_verification'});
      const candidateOrder = priceOrder(highs, dataset, request, candidate, deadline, checkBudget, progress);
      if (!candidateOrder.construction) continue;
      const verified = attachCost(candidate, candidateOrder, true);
      comparison.verified = true;
      comparison.selected = verified.objective < best.objective;
      if (comparison.selected) {
        best = verified;
        best.search.material_comparisons = comparisons;
        prices = candidateOrder.marginal_costs ?? prices;
      }
    }
    return best;
  } catch (error) {
    if (!(error instanceof RefinementDeadline)) throw error;
    return best ?? {status: 'limit', optimal: false, phase: 'construction'};
  }
}
