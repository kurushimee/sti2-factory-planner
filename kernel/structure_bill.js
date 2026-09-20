function requiredCopies(part, demand) {
  const capacity = part.hatch_capacity;
  if (demand.items?.length) {
    const slots = capacity.item_slots;
    if (!slots?.length || !slots.every(value => value === slots[0])) return Infinity;
    return Math.ceil(demand.items.reduce((sum, item) => sum + Math.ceil(item.amount / Math.min(slots[0], item.max_stack_size)), 0) / slots.length);
  }
  if (demand.fluids?.length) {
    const slots = capacity.fluid_slots_mb;
    if (!slots?.length || !slots.every(value => value === slots[0])) return Infinity;
    return Math.ceil(demand.fluids.reduce((sum, fluid) => sum + Math.ceil(fluid.amount / slots[0]), 0) / slots.length);
  }
  if (demand.energy) {
    if (!(capacity.energy_eu > 0) || !(capacity.cable_eu_per_tick > 0)) return Infinity;
    if (demand.single_buffer && capacity.energy_eu < demand.energy.buffer) return Infinity;
    return Math.max(1, Math.ceil(demand.energy.buffer / capacity.energy_eu), Math.ceil(demand.energy.rate / capacity.cable_eu_per_tick));
  }
  return 0;
}

function assignCells(parts, cells) {
  const owner = new Map();
  const place = (part, seen) => {
    for (let cell = 0; cell < cells.length; cell++) {
      if (seen.has(cell) || !cells[cell].allowed_hatches.includes(parts[part].hatch_type)) continue;
      seen.add(cell);
      if (!owner.has(cell) || place(owner.get(cell), seen)) { owner.set(cell, part); return true; }
    }
    return false;
  };
  for (let part = 0; part < parts.length; part++) if (!place(part, new Set())) return null;
  return owner;
}

export function structureBill(shape, rules, hatches, demands, options = {}) {
  if (!shape?.cells?.length) throw new Error('No captured structure template is available.');
  const cells = [...shape.cells].sort((a, b) => a.position[1] - b.position[1] || a.position[2] - b.position[2] || a.position[0] - b.position[0]);
  for (const cell of cells) {
    const rule = rules[cell.member_rule];
    if (!rule?.state_only_verified || !rule.matching_states.some(state => state.Name === cell.preview_block)) {
      throw new Error(`The structure predicate at ${cell.position.join(', ')} has no verified default block.`);
    }
    if (cell.preview_block !== 'minecraft:air' && !cell.preview_items.length) throw new Error(`The structure needs a placement adapter for ${cell.preview_block}.`);
  }
  const variants = demands.map(demand => hatches.filter(part => part.hatch_type === demand.type &&
    part.hatch_capacity && (!options.allowed_parts || options.allowed_parts.includes(part.id)) &&
    (options.steel === undefined || part.hatch_type.includes('energy') || Boolean(part.upgrades_steam_to_steel) === options.steel))
    .map(part => ({part, count: requiredCopies(part, demand)}))
    .filter(value => Number.isSafeInteger(value.count) && value.count > 0 && value.count <= cells.length)
    .sort((a, b) => a.count - b.count || (a.part.hatch_capacity.cable_eu_per_tick ?? 0) - (b.part.hatch_capacity.cable_eu_per_tick ?? 0) ||
      (a.part.hatch_capacity.fluid_slots_mb?.[0] ?? 0) - (b.part.hatch_capacity.fluid_slots_mb?.[0] ?? 0) ||
      (a.part.hatch_capacity.item_slots?.length ?? 0) - (b.part.hatch_capacity.item_slots?.length ?? 0) || a.part.id.localeCompare(b.part.id)));
  if (variants.some(values => !values.length)) throw new Error('Available hatches cannot hold a complete batch or carry the required power.');
  let selected = null, assignment = null, visits = 0;
  const search = (index, parts) => {
    if (++visits > 50000) throw new Error('The structure hatch search reached its limit.');
    if (selected && parts.length >= selected.length) return;
    if (index === variants.length) {
      const placed = assignCells(parts, cells);
      if (placed) { selected = parts; assignment = placed; }
      return;
    }
    for (const variant of variants[index]) search(index + 1, [...parts, ...Array(variant.count).fill(variant.part)]);
  };
  search(0, []);
  if (!selected) throw new Error('The required hatches do not fit the allowed structure positions.');
  const quantities = new Map();
  const placements = cells.map((cell, index) => {
    const hatch = assignment.has(index) ? selected[assignment.get(index)] : null;
    const item = hatch?.id ?? (cell.preview_block === 'minecraft:air' ? null : cell.preview_items[0]);
    if (item) quantities.set(`item:${item}`, (quantities.get(`item:${item}`) ?? 0) + 1);
    return {position: cell.position, block: hatch?.id ?? cell.preview_block, ...(hatch ? {hatch_type: hatch.hatch_type} : {})};
  });
  return {build_requirements: [...quantities].map(([resource, amount]) => ({resource, amount})), placements,
    assumptions: ['The controller is counted separately.', 'Hatch selection minimizes installed hatch count, then prefers lower capacities; it is not a material-cost optimum.',
      'External transport must keep the selected hatches supplied and drained.', 'Placement coordinates use the captured controller-relative orientation.']};
}

export function attachStructureBills(result, dataset) {
  const definitions = new Map((dataset.machines ?? []).map(value => [value.id, value]));
  const recipes = new Map(dataset.recipes.map(value => [value.id, value]));
  const resources = new Map(dataset.resources.map(value => [value.id, value]));
  const hatches = [...definitions.values()].filter(value => value.id.startsWith('modern_industrialization:') && value.hatch_capacity &&
    /:(?:bronze|steel|advanced|turbo|highly_advanced|lv|mv|hv|ev|superconductor)_(?:item|fluid|energy)_(?:input|output)_hatch$/.test(value.id));
  for (const line of result.lines ?? []) {
    const machine = definitions.get(line.machine);
    if (!machine?.shapes?.length) continue;
    const configuration = line.configuration_details;
    try {
      if (!configuration.capacity || configuration.operating_points) throw new Error('This utility machine needs a verified hatch-demand adapter.');
      const recipe = recipes.get(line.recipe);
      const setup = configuration.setup ?? {};
      const batch = setup.batch ?? setup.contained_count ?? 1;
      const demands = new Map();
      const add = (direction, resource, amount) => {
        if (resource === 'energy:eu' || !(amount > 0)) return;
        const fluid = resource.startsWith('fluid:');
        const type = `modern_industrialization:${fluid ? 'fluid' : 'item'}_${direction}`;
        if (!demands.has(type)) demands.set(type, {type, [fluid ? 'fluids' : 'items']: []});
        const entries = demands.get(type)[fluid ? 'fluids' : 'items'];
        const existing = entries.find(value => value.resource === resource);
        if (existing) { existing.amount += amount; return; }
        const max = resources.get(resource)?.max_stack_size;
        if (!fluid && !(max > 0)) throw new Error(`The captured stack limit is missing for ${resource}.`);
        entries.push({resource, amount, ...(!fluid ? {max_stack_size: max} : {})});
      };
      const inputs = [...recipe.inputs, ...(configuration.inputs ?? [])];
      for (const choice of line.ingredient_choices) {
        const input = inputs[choice.slot];
        if (!input) throw new Error('An operating input has no batch-storage rule.');
        add('input', choice.resource, (input.nominal_amount ?? input.amount) * batch);
        for (const returned of input.returns?.[choice.resource] ?? []) add('output', returned.resource, returned.amount * input.amount * batch);
      }
      for (const catalyst of configuration.startup_inputs ?? []) add('input', catalyst.resource, catalyst.amount);
      for (const output of recipe.outputs) add('output', output.resource, (output.nominal_amount ?? output.amount) * batch);
      if (configuration.eu_per_operation > 0) {
        const type = 'modern_industrialization:energy_input';
        demands.set(type, {type, energy: {buffer: configuration.capacity.peak_eu_per_tick,
          rate: configuration.capacity.average_full_load_eu_per_tick}});
      }
      const energy = recipe.outputs.filter(value => value.resource === 'energy:eu').reduce((sum, value) => sum + value.amount, 0);
      if (energy) {
        const type = 'modern_industrialization:energy_output';
        const condition = recipe.conditions?.find(value => value.type === 'planner:energy_output_buffer');
        demands.set(type, {type, energy: {buffer: condition?.capacity_eu ?? energy * batch,
          rate: energy * configuration.operations_per_second / 20}, single_buffer: Boolean(condition?.single_output_hatch)});
      }
      const shape = machine.shapes.find(value => value.index === (setup.shape ?? 0));
      const report = structureBill(shape, dataset.shape_member_rules ?? [], hatches, [...demands.values()],
        machine.steel_hatch_variant ? {steel: Boolean(setup.steel_hatches)} : {});
      configuration.structure = {status: 'sized', ...report};
      configuration.build_requirements = [...configuration.build_requirements ?? [], ...report.build_requirements];
    } catch (error) {
      configuration.structure = {status: 'unsupported', reason: error.message};
    }
  }
  return result;
}
