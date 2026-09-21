import {productionRouteOwnership} from './route_ownership.js';

// Reuse the LP basis while finding a buildable candidate. Exclusions here do not prove optimality.
export function findFactorySeed(highs, model, request, deadline) {
  if (model.construction) return null;
  const native = highs.createModel({format: 'lp', data: model.text.replace(/\nGenerals\n[^]*?\nEnd$/, '\nEnd')});
  const start = Date.now();
  let lowerBound = null, attempts = 0;
  try {
    native.options.set({output_flag: false, primal_feasibility_tolerance: 1e-9});
    const names = new Set(model.lines.flatMap(line => [line.operation, line.machine,
      ...line.inputTerms.map(term => term.variable), ...line.returnTerms.map(term => term.variable)]));
    const indices = new Map([...names].map(name => [name, native.getColByName(name)]));
    const protectedRecipes = new Set([...Object.values(request.routes ?? {}), ...(request.goals ?? []).map(goal => goal.recipe).filter(Boolean)]);
    const pending = [new Set()];
    const visited = new Set();
    const byRecipe = new Map();
    for (const line of model.lines) {
      if (!byRecipe.has(line.recipe.id)) byRecipe.set(line.recipe.id, []);
      byRecipe.get(line.recipe.id).push(line);
    }
    let previous = new Set(), fixedMachines = false;
    const run = () => {
      if (Date.now() >= deadline) return false;
      native.options.set('time_limit', native.getRunTime() + Math.max(0.001, (deadline - Date.now()) / 1000));
      native.run();
      return native.getModelStatus() === highs.constants.modelStatus.optimal;
    };
    const summary = (values, disabled) => ({lines: model.lines.filter(line => !disabled.has(line.recipe.id) && values[indices.get(line.operation)] > 1e-9).map(line => {
      const value = name => values[indices.get(name)];
      return {recipe: line.recipe.id, operations_per_second: value(line.operation),
        inputs: line.inputTerms.map(term => ({resource: term.resource, rate: term.coefficient * value(term.variable)})),
        outputs: [...line.recipe.outputs.map(flow => ({resource: flow.resource, rate: flow.amount * value(line.operation)})),
          ...line.returnTerms.map(term => ({resource: term.resource, rate: term.coefficient * value(term.variable)}))],
        power_eu_per_tick: value(line.operation) * (line.configuration.eu_per_operation ?? 0) / 20 + value(line.machine) * (line.configuration.idle_eu_per_tick ?? 0)};
    })});
    while (pending.length && Date.now() < deadline) {
      const disabled = pending.pop();
      const signature = JSON.stringify([...disabled].sort());
      if (visited.has(signature)) continue;
      visited.add(signature);
      for (const recipe of new Set([...disabled, ...previous])) {
        if (disabled.has(recipe) === previous.has(recipe)) continue;
        for (const line of byRecipe.get(recipe)) native.changeColBounds(indices.get(line.operation), 0, disabled.has(recipe) ? 0 : highs.infinity);
      }
      previous = disabled;
      if (fixedMachines) for (const line of model.lines) native.changeColBounds(indices.get(line.machine), 0, highs.infinity);
      fixedMachines = false;
      if (!run()) continue;
      attempts++;
      if (attempts === 1) lowerBound = native.getObjectiveValue();
      const relaxed = native.getSolution().colValue;
      let ownership = productionRouteOwnership(summary(relaxed, disabled), request);
      if (!ownership.conflict.length) {
        for (const headroom of [1, 1.01, 1.1, 2]) {
          fixedMachines = true;
          for (const line of model.lines) {
            const id = line.configuration.id;
            const installed = Object.hasOwn(request.installed ?? {}, id) ? request.installed[id] : undefined;
            const limit = Object.hasOwn(request.limits ?? {}, id) ? request.limits[id] : Infinity;
            const count = installed ?? Math.min(limit, Math.ceil(relaxed[indices.get(line.machine)] * headroom));
            native.changeColBounds(indices.get(line.machine), count, count);
          }
          if (!run()) continue;
          const values = native.getSolution().colValue;
          ownership = productionRouteOwnership(summary(values, disabled), request);
          if (ownership.conflict.length) break;
          const columns = Object.create(null);
          for (let index = 0; index < values.length; index++) columns[native.getColName(index)] = {Primal: values[index]};
          return {Columns: columns, objective: native.getObjectiveValue(), lower_bound: lowerBound,
            excluded_recipes: [...disabled], attempts, elapsed_ms: Date.now() - start};
        }
      }
      for (const recipe of ownership.conflict) if (!protectedRecipes.has(recipe) && !disabled.has(recipe)) {
        pending.push(new Set([...disabled, recipe]));
      }
    }
    return null;
  } finally {
    native.dispose();
  }
}
