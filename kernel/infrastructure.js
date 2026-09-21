export function infrastructurePower(dataset, request) {
  const manual = request.overhead_eu_per_tick ?? 0;
  if (!Number.isFinite(manual) || manual < 0 || manual > Number.MAX_SAFE_INTEGER) throw new Error('Infrastructure overhead must be a finite nonnegative EU/t value.');
  const entries = [], seen = new Set();
  let total = manual;
  if (!Array.isArray(request.infrastructure ?? [])) throw new Error('Infrastructure must be a list of configured machines.');
  for (const selection of request.infrastructure ?? []) {
    if (!selection || !Number.isSafeInteger(selection.count) || selection.count < 0) throw new Error('Infrastructure counts must be whole nonnegative numbers.');
    const machine = dataset.machines?.find(value => value.id === selection.machine);
    const variant = machine?.infrastructure?.find(value => value.id === selection.variant);
    if (!variant) throw new Error(`Unknown infrastructure configuration: ${selection.machine}, ${selection.variant}.`);
    const key = `${selection.machine}|${selection.variant}`;
    if (seen.has(key)) throw new Error(`Duplicate infrastructure configuration: ${key}.`);
    seen.add(key);
    if (!selection.count) continue;
    if (request.disabled_machines?.includes(selection.machine)) throw new Error(`Configured infrastructure is disabled: ${selection.machine}.`);
    const drain = selection.count * variant.passive_eu_per_tick;
    total += drain;
    if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) throw new Error('Infrastructure power exceeds the supported numeric range.');
    entries.push({...selection, name: variant.name ?? variant.id, passive_eu_per_tick: drain,
      transfer_eu_per_tick_per_machine: variant.max_transfer_eu_per_tick ?? null,
      max_axis_distance: variant.max_axis_distance ?? null,
      assumptions: variant.assumptions ?? [],
      construction_status: 'Infrastructure structures and receiver networks are not included in the construction estimate.'});
  }
  return {entries, manual_eu_per_tick: manual, total_eu_per_tick: total};
}
