function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) throw new Error(`${name} must be positive and within the supported numeric range.`);
  return value;
}

export function resolveGoals(dataset, request) {
  const recipes = new Map(dataset.recipes.map(recipe => [recipe.id, recipe]));
  const routes = {...request.routes};
  const configurations = {...request.configurations};
  const targets = [];
  const goals = (request.goals ?? []).map((goal, index) => {
    const kind = goal.kind ?? 'rate';
    if (!['rate', 'capacity', 'quantity'].includes(kind)) throw new Error(`Unknown goal type: ${kind}.`);
    let rate = goal.rate;
    let recipe;
    if (goal.recipe) {
      recipe = recipes.get(goal.recipe);
      if (!recipe) throw new Error(`Unknown goal recipe: ${goal.recipe}.`);
      if (!recipe.outputs.some(output => output.resource === goal.resource && output.amount > 0)) throw new Error(`The goal recipe does not produce ${goal.resource}.`);
      if (Object.hasOwn(routes, recipe.primary) && routes[recipe.primary] !== recipe.id) throw new Error(`Conflicting recipe selections for ${recipe.primary}.`);
      routes[recipe.primary] = recipe.id;
    }
    if (kind === 'capacity') {
      if (!recipe) throw new Error('A capacity goal needs a recipe.');
      const configuration = recipe.configurations.find(value => value.id === goal.configuration);
      if (!configuration) throw new Error(`The goal configuration is unavailable: ${goal.configuration}.`);
      if (!Number.isSafeInteger(goal.machines) || goal.machines < 1) throw new Error('A capacity goal needs a positive whole-machine count.');
      if (Object.hasOwn(configurations, recipe.id) && configurations[recipe.id] !== configuration.id) throw new Error(`Conflicting machine configurations for ${recipe.id}.`);
      configurations[recipe.id] = configuration.id;
      const amount = recipe.outputs.filter(output => output.resource === goal.resource).reduce((sum, output) => sum + output.amount, 0);
      rate = configuration.operations_per_second * goal.machines * amount;
    }
    positive(rate, 'Goal rate');
    const target = {index, resource: goal.resource, kind, rate};
    if (kind === 'quantity') {
      target.quantity = positive(goal.quantity, 'Goal quantity');
      target.steady_production_seconds = goal.quantity / rate;
      target.time_basis = 'After startup, at the requested sustained output rate.';
    }
    targets.push(target);
    return {...goal, rate};
  });
  return {request: {...request, goals, routes, configurations}, targets};
}
