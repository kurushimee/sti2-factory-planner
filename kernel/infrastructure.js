import {structureBill, structureContext} from './structure_bill.js';

export function infrastructurePower(dataset, request) {
  const manual = request.overhead_eu_per_tick ?? 0;
  if (!Number.isFinite(manual) || manual < 0 || manual > Number.MAX_SAFE_INTEGER) throw new Error('Infrastructure overhead must be a finite nonnegative EU/t value.');
  const entries = [], seen = new Set();
  let structures;
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
    const transmission = selection.transmit_eu_per_tick ?? 0;
    if (!Number.isFinite(transmission) || transmission < 0 || transmission > (variant.max_transfer_eu_per_tick ?? 0)) throw new Error('The planned infrastructure transmission exceeds its supported limit.');
    let structure = {status: 'unsupported', reason: 'Select an input and receiver tier to size this infrastructure structure.'};
    if (selection.energy_hatch) {
      if (!variant.structure?.energy_input) throw new Error('This infrastructure has no verified energy-input structure adapter.');
      structures ??= structureContext(dataset);
      const part = structures.definitions.get(selection.energy_hatch);
      if (part?.hatch_type !== 'modern_industrialization:energy_input' || !structures.hatches.includes(part)) throw new Error('The selected infrastructure energy hatch has no supported transfer model.');
      if (request.available_parts && !request.available_parts.includes(part.id)) throw new Error('The selected infrastructure energy hatch is unavailable.');
      const demand = variant.passive_eu_per_tick + transmission;
      const bill = structureBill(machine.shapes?.find(shape => shape.index === variant.structure.shape), dataset.shape_member_rules ?? [],
        [part], [{type: part.hatch_type, energy: {buffer: demand, rate: demand}}]);
      structure = {status: 'sized', ...bill, assumptions: ['The controller is included in this bill.', ...bill.assumptions.slice(1)],
        build_requirements: [{resource: `item:${machine.id}`, amount: 1}, ...bill.build_requirements]};
    }
    if (request.construction && structure.status !== 'sized') throw new Error(`Infrastructure construction is incomplete: ${structure.reason}`);
    entries.push({...selection, name: variant.name ?? variant.id, passive_eu_per_tick: drain, structure,
      transmit_eu_per_tick_per_machine: transmission,
      transfer_eu_per_tick_per_machine: variant.max_transfer_eu_per_tick ?? null,
      max_axis_distance: variant.max_axis_distance ?? null,
      assumptions: variant.assumptions ?? [],
      construction_status: structure.status === 'sized' ? 'The tower bill includes its controller and structure. Receivers and cable networks are separate build requirements.' : structure.reason});
  }
  return {entries, manual_eu_per_tick: manual, total_eu_per_tick: total};
}
