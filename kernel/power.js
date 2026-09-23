const ENERGY = 'energy:eu';
const key = line => `${line.recipe}|${line.configuration}`;

export function generationSupport(lines, connections) {
  const indexed = new Map(lines.map(line => [key(line), line]));
  const upstream = new Map();
  for (const connection of connections) {
    if (connection.resource === ENERGY || !indexed.has(connection.source) || !indexed.has(connection.destination)) continue;
    if (!upstream.has(connection.destination)) upstream.set(connection.destination, []);
    upstream.get(connection.destination).push(connection.source);
  }
  const support = new Set(lines.filter(line => line.outputs.some(flow => flow.resource === ENERGY && flow.rate > 0)).map(key));
  const pending = [...support];
  while (pending.length) {
    for (const source of upstream.get(pending.pop()) ?? []) {
      if (!support.has(source)) { support.add(source); pending.push(source); }
    }
  }
  let generation = 0, production = 0;
  for (const line of lines) {
    const power = line.power_eu_per_tick + line.inputs.filter(flow => flow.resource === ENERGY).reduce((sum, flow) => sum + flow.rate / 20, 0);
    if (support.has(key(line))) generation += power;
    else production += power;
  }
  return {
    generation_related_consumption_eu_per_tick: generation,
    other_production_consumption_eu_per_tick: production,
    generation_support_lines: [...support].sort(),
    attribution_basis: 'Generators and their material suppliers are counted in full, including shared suppliers. Each allocation is counted once. Electrical connections do not classify a consumer as a fuel supplier.',
  };
}
