function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be a safe integer of at least ${minimum}.`);
  }
  return value;
}

export function miPower(recipeEu, totalEu, baseEu, maxEu, efficiency) {
  for (const [name, value] of Object.entries({recipeEu, totalEu, baseEu, maxEu, efficiency})) {
    integer(value, name);
  }
  const ramp = Number(BigInt(efficiency) * BigInt(totalEu) / 600n);
  return Math.min(totalEu, maxEu, Math.max(baseEu, recipeEu) + ramp);
}

function batchEnergy(energy, batch, discount) {
  // Tesseract performs this multiplication in Java float precision before casting to long.
  const result = Math.trunc(Math.fround(Math.fround(energy * batch) * Math.fround(discount)));
  return integer(result, 'Transformed energy', 1);
}

function ceilRatio(numerator, denominator) {
  return Number((BigInt(numerator) + BigInt(denominator) - 1n) / BigInt(denominator));
}

export function machineCapacity(recipe, machine, setup = {}) {
  if (machine.mechanic === 'ae_molecular_assembler') return molecularAssemblerCapacity(machine, setup);
  const duration = integer(recipe.duration_ticks, 'Recipe duration', 1);
  const recipeEu = integer(recipe.eu_per_tick, 'Recipe EU/t', 1);
  const total = integer(duration * recipeEu, 'Recipe energy', 1);
  const batch = integer(setup.batch ?? 1, 'Batch size', 1);
  if (batch > (machine.batch_limit ?? 1)) throw new Error('The batch exceeds the machine limit.');
  const count = integer(setup.upgrade_count ?? 0, 'Upgrade count');
  const upgrade = setup.upgrade;
  if (count && (!upgrade || !machine.upgrades?.includes(upgrade.id))) {
    throw new Error('The selected upgrade is incompatible with this machine.');
  }
  if (count > (machine.upgrade_limit ?? 0)) throw new Error('The upgrade count exceeds the machine limit.');
  const bonus = integer(count * (upgrade?.extra_max_eu ?? 0), 'Upgrade energy');
  const limit = integer(machine.max_eu + bonus, 'Machine recipe limit', 1);
  if (recipeEu > limit) throw new Error('The recipe exceeds the machine voltage limit.');
  const modular = machine.mechanic === 'mi_batch';
  if (!['mi_crafter', 'mi_batch'].includes(machine.mechanic)) {
    throw new Error(`Unsupported machine mechanic: ${machine.mechanic}.`);
  }
  if (!modular && batch !== 1) throw new Error('This machine cannot batch recipes.');
  const transform = modular ? value => batchEnergy(value, batch, machine.energy_multiplier) : value => value;
  const energy = transform(total);
  const base = Math.max(transform(machine.base_eu), transform(recipeEu));
  const max = modular ? integer(transform(machine.max_eu) + bonus, 'Batch power limit', 1) : limit;
  const peak = Math.min(energy, max);
  const ticks = ceilRatio(energy, peak);
  const missing = BigInt(Math.max(0, peak - base));
  const efficiencyLimit = Number((missing * 600n + BigInt(energy) - 1n) / BigInt(energy));
  const completions = [];
  let elapsed = 0;
  for (let efficiency = 0; efficiency < efficiencyLimit; efficiency++) {
    const power = miPower(0, energy, base, max, efficiency);
    elapsed = integer(elapsed + ceilRatio(energy, power), 'Warm-up duration');
    completions.push(elapsed);
  }
  // Include the first full-speed operation so the buffer also covers discrete output delivery.
  completions.push(elapsed + ticks);
  const rate = batch * 20 / ticks;
  let maximumDeficit = 0;
  completions.forEach((time, index) => {
    maximumDeficit = Math.max(maximumDeficit, time * batch / ticks - index * batch);
  });
  return {
    operations_per_second: rate,
    ticks_per_batch: ticks,
    energy_per_batch: energy,
    eu_per_operation: energy / batch,
    average_full_load_eu_per_tick: energy / ticks,
    peak_eu_per_tick: peak,
    efficiency_limit: efficiencyLimit,
    warmup_ticks: elapsed,
    completion_ticks: completions,
    output_buffer_operations: maximumDeficit,
    assumptions: ['Ingredients arrive continuously.', 'The power connection can supply the peak draw.', 'Outputs can always be accepted.', 'No overdrive or lubricant is applied.'],
  };
}

export function molecularAssemblerCapacity(machine, setup = {}) {
  const cards = integer(setup.upgrade_count ?? 0, 'Acceleration card count');
  if (cards > 5) throw new Error('A molecular assembler has five acceleration card slots.');
  if (cards && setup.upgrade?.id !== 'ae2:speed_card') throw new Error('A molecular assembler requires acceleration cards.');
  const euPerAe = machine.eu_per_ae;
  const multiplier = machine.usage_multiplier;
  if (!(euPerAe > 0 && Number.isFinite(euPerAe) && multiplier > 0 && Number.isFinite(multiplier))) throw new Error('Molecular assembler power conversion is missing.');
  const speed = [10, 13, 17, 20, 25, 50][cards];
  const ticks = Math.ceil(100 / speed);
  const power = speed * (speed / 10) * multiplier * euPerAe;
  return {operations_per_second: 20 / ticks, ticks_per_batch: ticks, energy_per_batch: ticks * power,
    eu_per_operation: ticks * power, average_full_load_eu_per_tick: power, peak_eu_per_tick: power,
    efficiency_limit: 0, warmup_ticks: 0, completion_ticks: [ticks], output_buffer_operations: 1,
    assumptions: ['Ingredients arrive continuously.', 'The assembler has a dedicated pattern.', 'The AE network supplies power and accepts outputs every tick.']};
}
