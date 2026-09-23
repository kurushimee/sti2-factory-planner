export function clearSolarEfficiency(time) {
  if (!Number.isInteger(time) || time < 0 || time >= 24000) throw new Error('Solar time must be a tick within one Minecraft day.');
  if (time > 12000) return 0;
  if (time >= 1500 && time <= 10500) return 1;
  return Math.max(0, Math.fround(Math.fround(Math.fround(-time * time) / Math.fround(15750000)) +
    Math.fround(Math.fround(2 * Math.fround(time)) / Math.fround(2625))));
}

export function clearSolarProfile(peak, options = {}) {
  if (!Number.isSafeInteger(peak) || peak <= 0) throw new Error('Solar peak must be a positive whole EU/t value.');
  const days = options.days ?? 1;
  const wearAtStart = options.cell_wear ?? 0;
  const tickAtStart = options.generator_tick ?? 0;
  if (!Number.isSafeInteger(days) || days < 1 || days > 100 ||
      !Number.isSafeInteger(wearAtStart) || wearAtStart < 0 || wearAtStart >= 12000 ||
      !Number.isSafeInteger(tickAtStart) || tickAtStart < 0 || tickAtStart >= 20) {
    throw new Error('Solar days, cell wear, and generator tick need supported whole values.');
  }
  const water = options.distilled_water === true;
  const power = new Float64Array(days * 24000);
  let cellWear = wearAtStart, generatorTick = tickAtStart, cellsConsumed = 0, waterUsed = 0, total = 0;
  for (let tick = 0; tick < power.length; tick++) {
    const efficiency = clearSolarEfficiency(tick % 24000);
    if (efficiency <= 0) continue;
    generatorTick = generatorTick % 20 + 1;
    if (water) waterUsed++;
    if (!water || generatorTick % 2 === 0) cellWear++;
    if (cellWear === 12000) {
      cellWear = 0;
      cellsConsumed++;
      continue;
    }
    const produced = Math.trunc(Math.fround(peak * efficiency) * (water ? 1.5 : 1));
    power[tick] = produced;
    total += produced;
  }
  return {power_eu_per_tick: power, total_eu: total, water_mb: waterUsed, cells_consumed: cellsConsumed,
    ending_cell_wear: cellWear, ending_generator_tick: generatorTick,
    assumptions: 'Clear weather, open sky, enabled panel, empty output buffer, and immediate replacement of an expired cell.'};
}
