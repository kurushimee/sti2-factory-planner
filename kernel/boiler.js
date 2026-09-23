export function boilerWarmup(rule, fuel) {
  for (const name of ['max_eu_per_tick', 'eu_per_degree', 'temperature_max']) {
    if (!(Number.isFinite(rule[name]) && rule[name] > 0)) throw new Error(`Invalid boiler rule: ${name}.`);
  }
  if (rule.temperature_max <= 100 || !Number.isSafeInteger(fuel.eu_per_unit) || fuel.eu_per_unit <= 0) throw new Error('The boiler temperature or fuel energy is invalid.');
  const pressure = rule.eu_per_steam_mb ?? 1;
  if (!Number.isSafeInteger(pressure) || pressure < 1 || !['item', 'fluid'].includes(fuel.kind)) throw new Error('The steam pressure or fuel kind is unsupported.');
  const maximum = Math.floor(rule.max_eu_per_tick / pressure);
  if (!maximum) throw new Error('The boiler cannot produce this pressure of steam.');
  if (fuel.kind === 'fluid' && fuel.eu_per_unit > rule.max_eu_per_tick * 100) throw new Error('The fuel unit exceeds the boiler fluid-fuel buffer refill threshold.');
  let temperature = 0, fuelBuffer = 0, steam = 0, waterBuffer = 0, water = 0, consumed = 0, deficit = 0;
  const segments = [];
  const clamp = value => Math.min(rule.temperature_max, Math.max(0, value));
  for (let tick = 1; tick <= 1000000; tick++) {
    const output = temperature > 100 ? Math.floor((temperature - 100) / (rule.temperature_max - 100) * rule.max_eu_per_tick / pressure) : 0;
    const waterUsed = Math.max(0, Math.ceil((output - waterBuffer) / 16));
    waterBuffer += waterUsed * 16 - output;
    steam += output;
    water += waterUsed;
    temperature = clamp(temperature - output * pressure / rule.eu_per_degree);
    if (rule.continuous) temperature = clamp(temperature - 0.8 * (rule.max_eu_per_tick - output * pressure) / rule.eu_per_degree);
    const heat = Math.min(fuelBuffer, rule.max_eu_per_tick, Math.ceil(rule.eu_per_degree * (rule.temperature_max - temperature)));
    if (heat > 0) {
      fuelBuffer -= heat;
      temperature = clamp(temperature + heat / rule.eu_per_degree);
    } else if (!fuelBuffer) temperature = clamp(temperature - 1);
    const refill = fuel.kind === 'fluid'
      ? Math.max(0, Math.floor((100 * rule.max_eu_per_tick - fuelBuffer) / fuel.eu_per_unit))
      : Math.max(0, Math.ceil((rule.max_eu_per_tick - fuelBuffer) / fuel.eu_per_unit));
    fuelBuffer += refill * fuel.eu_per_unit;
    consumed += refill;
    deficit = Math.max(deficit, maximum * tick - steam);
    if (segments.at(-1)?.steam_per_tick !== output) segments.push({first_tick: tick, last_tick: tick, steam_per_tick: output});
    else segments.at(-1).last_tick = tick;
    if (output === maximum) return {first_full_output_tick: tick, steam_produced: steam, water_consumed: water,
      fuel_consumed: consumed, remaining_fuel_eu: fuelBuffer, steam_deficit: deficit, output_segments: segments,
      assumptions: ['Continuous fuel and water, unrestricted steam output, and a cold boiler.']};
  }
  throw new Error('The boiler did not reach full output within the supported warm-up simulation limit.');
}
