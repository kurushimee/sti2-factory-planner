export function allocateFlows(lines, external, demands) {
  const supply = new Map(), connections = [], retained = [];
  const magnitude = new Map(), residuals = new Map();
  const accumulate = (total, value) => {
    const next = total.sum + value;
    total.correction += Math.abs(total.sum) >= Math.abs(value) ? (total.sum - next) + value : (value - next) + total.sum;
    total.sum = next;
  };
  const measure = (resource, rate) => {
    if (!magnitude.has(resource)) magnitude.set(resource, {sum: 0, correction: 0});
    accumulate(magnitude.get(resource), Math.abs(rate));
  };
  const key = line => `${line.recipe}|${line.configuration}`;
  const add = (resource, origin, rate) => {
    if (!supply.has(resource)) supply.set(resource, []);
    supply.get(resource).push({origin, rate, used: {sum: 0, correction: 0}});
    measure(resource, rate);
  };
  for (const line of lines) for (const output of line.outputs) add(output.resource, key(line), output.rate);
  for (const source of external) add(source.resource, `external:${source.resource}`, source.rate);
  for (const line of lines) {
    for (const input of line.inputs) measure(input.resource, input.rate);
    if (line.power_eu_per_tick) measure('energy:eu', line.power_eu_per_tick * 20);
  }
  for (const [resource, demand] of demands) measure(resource, demand);
  const take = (resource, destination, rate) => {
    const received = {sum: 0, correction: 0};
    for (const source of supply.get(resource) ?? []) {
      const remaining = (rate - received.sum) - received.correction;
      if (remaining <= 0) break;
      const available = (source.rate - source.used.sum) - source.used.correction;
      const amount = Math.max(0, Math.min(available, remaining));
      if (!amount) continue;
      connections.push({source: source.origin, destination, resource, rate: amount});
      accumulate(source.used, amount);
      accumulate(received, amount);
    }
    const remaining = (rate - received.sum) - received.correction;
    if (remaining > 0) {
      const total = magnitude.get(resource);
      const tolerance = Math.max(1e-7, (total.sum + total.correction) * Number.EPSILON * 16);
      const omitted = (residuals.get(resource)?.rate ?? 0) + remaining;
      if (omitted > tolerance) throw new Error(`Could not allocate the solved flow for ${resource}: deficit ${omitted}/s exceeds numerical tolerance ${tolerance}/s.`);
      residuals.set(resource, {resource, rate: omitted, numerical_tolerance: tolerance});
    }
  };
  for (const line of lines) {
    for (const input of line.inputs) take(input.resource, key(line), input.rate);
    if (line.power_eu_per_tick) take('energy:eu', key(line), line.power_eu_per_tick * 20);
  }
  for (const [resource, demand] of demands) if (demand) take(resource, `goal:${resource}`, demand);
  for (const [resource, sources] of supply) for (const source of sources) {
    const remaining = (source.rate - source.used.sum) - source.used.correction;
    if (remaining > 0) retained.push({resource, source: source.origin, rate: remaining});
  }
  return {connections, retained, flow_roundoff: [...residuals.values()]};
}
