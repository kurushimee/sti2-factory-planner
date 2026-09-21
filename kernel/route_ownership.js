// A recipe may run for any useful net output; its display title does not choose its purpose.
export function matchRouteOwnership(candidates) {
  const owner = new Map();
  const assigned = new Map();
  const ordered = [...candidates.keys()].sort((a, b) => candidates.get(a).length - candidates.get(b).length || a.localeCompare(b));
  for (const recipe of ordered) {
    const queue = [recipe], visited = new Set(queue), parent = new Map();
    let end;
    for (let index = 0; index < queue.length && end === undefined; index++) {
      const current = queue[index];
      for (const resource of candidates.get(current)) {
        if (!owner.has(resource)) { end = {recipe: current, resource}; break; }
        const displaced = owner.get(resource);
        if (!visited.has(displaced)) {
          visited.add(displaced);
          parent.set(displaced, {recipe: current, resource});
          queue.push(displaced);
        }
      }
    }
    if (end === undefined) {
      // This alternating search found more recipes than distinct candidate resources.
      // Any feasible selection must omit at least one of these recipes.
      return {assignments: [], conflict: [...visited].sort()};
    }
    while (end) {
      owner.set(end.resource, end.recipe);
      assigned.set(end.recipe, end.resource);
      end = parent.get(end.recipe);
    }
  }
  return {assignments: [...assigned].map(([recipe, resource]) => ({recipe, resource})), conflict: []};
}

export function productionRouteOwnership(plan, request) {
  const useful = new Set((request.goals ?? []).filter(goal => goal.rate > 0).map(goal => goal.resource));
  const outputs = new Map();
  const addScope = (lines, amountField) => {
    const net = new Map();
    for (const line of lines) {
      if (!net.has(line.recipe)) net.set(line.recipe, new Map());
      const flows = net.get(line.recipe);
      for (const flow of line.outputs) flows.set(flow.resource, (flows.get(flow.resource) ?? 0) + flow[amountField]);
      for (const flow of line.inputs) {
        flows.set(flow.resource, (flows.get(flow.resource) ?? 0) - flow[amountField]);
        if (flow[amountField] > 1e-10) useful.add(flow.resource);
      }
      if (line.power_eu_per_tick > 0) useful.add('energy:eu');
    }
    for (const [recipe, flows] of net) {
      if (!outputs.has(recipe)) outputs.set(recipe, new Set());
      for (const [resource, amount] of flows) if (amount > 1e-10) outputs.get(recipe).add(resource);
    }
  };
  addScope(plan.lines.filter(line => line.operations_per_second > 1e-10), 'rate');
  addScope(plan.construction?.routes ?? [], 'amount');
  for (const flow of plan.construction?.requirements ?? []) if (flow.amount > 1e-10) useful.add(flow.resource);
  const selected = new Map();
  for (const goal of request.goals ?? []) {
    if (!goal.recipe) continue;
    if (!selected.has(goal.resource)) selected.set(goal.resource, new Set());
    selected.get(goal.resource).add(goal.recipe);
  }
  const candidates = new Map();
  for (const [recipe, resources] of outputs) {
    const choices = [];
    for (const resource of [...resources].sort()) {
      if (!useful.has(resource) && resource !== 'energy:eu') continue;
      const pin = request.routes && Object.hasOwn(request.routes, resource) ? request.routes[resource] : undefined;
      if (pin && pin !== recipe) continue;
      const goals = selected.get(resource);
      if (goals && !goals.has(recipe)) continue;
      // Several explicitly requested recipes and mixed generators are deliberate exceptions.
      choices.push(resource === 'energy:eu' || goals?.size > 1 || request.single_primary_route === false ? {resource, recipe} : resource);
    }
    candidates.set(recipe, choices);
  }
  const result = matchRouteOwnership(candidates);
  result.assignments = result.assignments.map(({recipe, resource}) => ({recipe,
    resource: typeof resource === 'string' ? resource : resource.resource}));
  return result;
}
