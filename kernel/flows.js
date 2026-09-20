export function allocateFlows(lines, external, demands) {
  const supply = new Map(), connections = [], retained = [];
  const key = line => `${line.recipe}|${line.configuration}`;
  const add = (resource, origin, rate) => {
    if (!supply.has(resource)) supply.set(resource, []);
    supply.get(resource).push({origin, remaining: rate});
  };
  for (const line of lines) for (const output of line.outputs) add(output.resource, key(line), output.rate);
  for (const source of external) add(source.resource, `external:${source.resource}`, source.rate);
  const take = (resource, destination, rate) => {
    let remaining = rate;
    for (const source of supply.get(resource) ?? []) {
      const amount = Math.min(source.remaining, remaining);
      if (amount > 1e-10) connections.push({source: source.origin, destination, resource, rate: amount});
      source.remaining -= amount;
      remaining -= amount;
    }
    if (remaining > Math.max(1e-7, rate * Number.EPSILON * 32)) throw new Error(`Could not allocate the solved flow for ${resource}.`);
  };
  for (const line of lines) {
    for (const input of line.inputs) take(input.resource, key(line), input.rate);
    if (line.power_eu_per_tick) take('energy:eu', key(line), line.power_eu_per_tick * 20);
  }
  for (const [resource, demand] of demands) if (demand) take(resource, `goal:${resource}`, demand);
  for (const [resource, sources] of supply) for (const source of sources) {
    if (source.remaining > 1e-10) retained.push({resource, source: source.origin, rate: source.remaining});
  }
  return {connections, retained};
}
