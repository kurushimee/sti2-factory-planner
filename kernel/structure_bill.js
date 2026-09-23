class StructureCapacityError extends Error {}

function requiredCopies(part, demand) {
  if (demand.count) return demand.count;
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
    if (!(capacity.energy_eu > 0)) return Infinity;
    if (demand.single_buffer && capacity.energy_eu < demand.energy.buffer) return Infinity;
    return Math.max(1, Math.ceil(demand.energy.buffer / capacity.energy_eu));
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
    .sort((a, b) => a.count - b.count || (a.part.hatch_capacity.energy_eu ?? 0) - (b.part.hatch_capacity.energy_eu ?? 0) ||
      (a.part.hatch_capacity.fluid_slots_mb?.[0] ?? 0) - (b.part.hatch_capacity.fluid_slots_mb?.[0] ?? 0) ||
      (a.part.hatch_capacity.item_slots?.length ?? 0) - (b.part.hatch_capacity.item_slots?.length ?? 0) || a.part.id.localeCompare(b.part.id)));
  if (variants.some(values => !values.length)) throw new StructureCapacityError('Available hatches cannot hold a complete batch or its required energy buffer.');
  const cacheKey = options.cache ? JSON.stringify(variants.map(values => values.map(value => [value.part.id, value.count]))) : null;
  const cached = options.cache?.get(shape)?.get(cacheKey);
  if (cached) return cached;
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
  if (!selected) throw new StructureCapacityError('The required hatches do not fit the allowed structure positions.');
  const quantities = new Map();
  const placements = cells.map((cell, index) => {
    const hatch = assignment.has(index) ? selected[assignment.get(index)] : null;
    const item = hatch?.id ?? (cell.preview_block === 'minecraft:air' ? null : cell.preview_items[0]);
    if (item) quantities.set(`item:${item}`, (quantities.get(`item:${item}`) ?? 0) + 1);
    return {position: cell.position, block: hatch?.id ?? cell.preview_block, ...(hatch ? {hatch_type: hatch.hatch_type} : {})};
  });
  const report = {build_requirements: [...quantities].map(([resource, amount]) => ({resource, amount})), placements,
    assumptions: ['The controller is counted separately.', 'Hatch selection minimizes installed hatch count, then prefers lower capacities; it is not a material-cost optimum.',
      'Items, fluids, and energy are supplied and drained without a transport limit.', 'Placement coordinates use the captured controller-relative orientation.']};
  if (demands.some(demand => demand.energy)) report.assumptions.push(
    'Energy hatches provide enough internal storage for one production tick or the required output burst. Cable throughput does not size the build bill.');
  if (options.cache) {
    if (!options.cache.has(shape)) options.cache.set(shape, new Map());
    options.cache.get(shape).set(cacheKey, report);
  }
  return report;
}

export function structureContext(dataset) {
  const definitions = new Map((dataset.machines ?? []).map(value => [value.id, value]));
  const recipes = new Map(dataset.recipes.map(value => [value.id, value]));
  const resources = new Map((dataset.resources ?? []).map(value => [value.id, value]));
  const hatches = [...definitions.values()].filter(value => value.id.startsWith('modern_industrialization:') && value.hatch_capacity &&
    /:(?:(?:bronze|steel|advanced|turbo|highly_advanced|lv|mv|hv|ev|superconductor)_(?:item|fluid|energy)_(?:input|output)|nuclear_item)_hatch$/.test(value.id));
  return {definitions, recipes, resources, hatches, billCache: new WeakMap()};
}

export function attachStructureBills(result, dataset, options = {}, context = structureContext(dataset)) {
  const {definitions, recipes, resources, hatches} = context;
  for (const line of result.lines ?? []) {
    const machine = definitions.get(line.machine);
    if (!machine?.shapes?.length) continue;
    const configuration = line.configuration_details;
    if (configuration.structure?.status === 'sized') continue;
    try {
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
      const profile = configuration.startup_profile;
      if (profile?.kind === 'irradiator') {
        const type = 'modern_industrialization:nuclear_item';
        demands.set(type, {type, count: profile.batch});
        add('input', profile.source_resource, 1);
      } else if (profile?.kind === 'boiler') {
        const rule = profile.rule;
        const steam = rule.max_eu_per_tick / (rule.eu_per_steam_mb ?? 1);
        add('input', profile.water_resource, Math.ceil(steam / rule.steam_to_water));
        add('output', profile.steam_resource, steam);
        const refill = profile.fuel.kind === 'fluid' ? Math.floor(100 * rule.max_eu_per_tick / profile.fuel.eu_per_unit)
          : Math.ceil(rule.max_eu_per_tick / profile.fuel.eu_per_unit);
        const fuels = new Set(line.ingredient_choices.filter(choice => profile.fuel_resources.includes(choice.resource)).map(choice => choice.resource));
        for (const resource of fuels) add('input', resource, refill);
      } else if (machine.mechanic === 'buffered_fuel_generator') {
        const fuel = recipe.inputs[0];
        const energy = recipe.outputs.find(value => value.resource === 'energy:eu')?.amount;
        if (!fuel?.resource || !(energy > 0) || recipe.inputs.length !== 1) throw new Error('This generator needs a verified fuel-storage adapter.');
        add('input', fuel.resource, Math.ceil(machine.max_eu_per_tick * fuel.amount / energy));
      } else {
        if (!configuration.capacity || configuration.operating_points) throw new Error('This utility machine needs a verified hatch-demand adapter.');
        const inputs = [...recipe.inputs, ...(configuration.inputs ?? [])];
        for (const choice of line.ingredient_choices) {
          const input = inputs[choice.slot];
          if (!input) throw new Error('An operating input has no batch-storage rule.');
          add('input', choice.resource, (input.nominal_amount ?? input.amount) * batch);
          for (const returned of input.returns?.[choice.resource] ?? []) add('output', returned.resource, returned.amount * input.amount * batch);
        }
        for (const catalyst of configuration.startup_inputs ?? []) add('input', catalyst.resource, catalyst.amount);
        for (const output of recipe.outputs) add('output', output.resource, (output.nominal_amount ?? output.amount) * batch);
      }
      if (configuration.eu_per_operation > 0 || configuration.idle_eu_per_tick > 0) {
        const type = 'modern_industrialization:energy_input';
        demands.set(type, {type, energy: {buffer: configuration.capacity.peak_eu_per_tick}});
      }
      const energy = recipe.outputs.filter(value => value.resource === 'energy:eu').reduce((sum, value) => sum + value.amount, 0);
      if (energy) {
        const type = 'modern_industrialization:energy_output';
        const condition = recipe.conditions?.find(value => value.type === 'planner:energy_output_buffer');
        demands.set(type, {type, energy: {
          buffer: condition?.capacity_eu ?? (machine.mechanic === 'buffered_fuel_generator' ? machine.max_eu_per_tick : energy * batch),
        }, single_buffer: Boolean(condition?.single_output_hatch)});
      }
      const shape = machine.shapes.find(value => value.index === (setup.shape ?? 0));
      const report = structureBill(shape, dataset.shape_member_rules ?? [], hatches, [...demands.values()],
        {...options, cache: context.billCache, ...(machine.steel_hatch_variant ? {steel: Boolean(setup.steel_hatches)} : {})});
      configuration.structure = {status: 'sized', ...report};
      configuration.build_requirements = [...configuration.build_requirements ?? [], ...report.build_requirements];
    } catch (error) {
      configuration.structure = {status: 'unsupported', infeasible: error instanceof StructureCapacityError, reason: error.message};
    }
  }
  return result;
}

export function checkFixedStructure(recipe, configuration, dataset, request, context) {
  if (!context.definitions.get(configuration.machine)?.shapes?.length) return;
  const inputs = [...recipe.inputs, ...(configuration.inputs ?? []),
    ...(configuration.operating_points ?? []).flatMap(point => point.inputs)];
  const choices = inputs.map((flow, slot) => ({slot, resource: request.ingredients?.[`${recipe.id}#${slot}`] ??
    (flow.resource || (flow.choices?.length === 1 ? flow.choices[0] : null))}));
  // Unresolved alternatives require storage checks after their material allocation is known.
  if (choices.some(choice => !choice.resource)) {
    if (request.construction) configuration.structure = {status: 'unsupported',
      reason: 'Choose the alternative ingredients before comparing this multiblock construction bill.'};
    return;
  }
  attachStructureBills({lines: [{recipe: recipe.id, machine: configuration.machine,
    configuration_details: configuration, ingredient_choices: choices}]}, dataset,
  {allowed_parts: request.available_parts}, context);
  if (configuration.structure?.infeasible) throw new Error(configuration.structure.reason);
}
