export function startupRequirements(lines) {
  const resources = new Map();
  const incomplete = [];
  const builds = new Map();
  const add = (resource, field, amount, line) => {
    if (!(amount > 0)) return;
    if (!resources.has(resource)) resources.set(resource, {resource, warmup_output_stock: 0, first_operation_stock: 0, remaining_warmup_input_stock: 0, reusable_stock: 0, origins: []});
    const entry = resources.get(resource);
    entry[field] += amount;
    if (!entry.origins.includes(line)) entry.origins.push(line);
  };
  for (const line of lines) {
    const key = `${line.recipe}|${line.configuration}`;
    const configuration = line.configuration_details;
    for (const flow of configuration.build_requirements ?? []) builds.set(flow.resource, (builds.get(flow.resource) ?? 0) + flow.amount * line.machines);
    const capacity = configuration.capacity;
    if (!capacity?.completion_ticks || !capacity.ticks_per_batch) {
      incomplete.push({recipe: line.recipe, configuration: line.configuration, reason: 'No verified cold-start completion schedule is available.'});
      continue;
    }
    if (!line.operations_per_second) continue;
    const batch = capacity.operations_per_second * capacity.ticks_per_batch / 20;
    const requiredPerMachinePerTick = line.operations_per_second / line.machines / 20;
    let deficit = 0;
    for (const [index, tick] of capacity.completion_ticks.entries()) deficit = Math.max(deficit, tick * requiredPerMachinePerTick - index * batch);
    for (const output of line.outputs) add(output.resource, 'warmup_output_stock', deficit * line.machines * output.rate / line.operations_per_second, key);
    for (const input of line.inputs) {
      const load = batch * line.machines * input.rate / line.operations_per_second;
      add(input.resource, 'first_operation_stock', load, key);
      add(input.resource, 'remaining_warmup_input_stock', load * Math.max(0, capacity.completion_ticks.length - 1), key);
    }
    for (const catalyst of configuration.startup_inputs ?? []) add(catalyst.resource, 'reusable_stock', catalyst.amount * line.machines, key);
  }
  return {resources: [...resources.values()].map(value => ({...value,
    quantity: value.warmup_output_stock + value.first_operation_stock + value.remaining_warmup_input_stock + value.reusable_stock})),
    build_requirements: [...builds].map(([resource, amount]) => ({resource, amount})), incomplete,
    method: 'Conservative stock bound for one cold start: reserve every warm-up input operation through the first full-speed completion, plus each producer’s delivery deficit. Incoming startup production is not credited against these stocks.',
    assumptions: ['All configured machines receive continuous ingredients and peak power during warm-up.',
      'These quantities must be obtained before startup; a steady-state cycle does not create its initial stock.',
      'Probabilistic recipes use expected quantities, not a guarantee against random shortages.',
      'An idle restart may require replenishing this stock. Scheduling repeated passive restarts is not established by this bound.']};
}
