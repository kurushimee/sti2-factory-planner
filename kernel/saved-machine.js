import {decodePatterns} from './ae2.js';

const locationKey = origin => `${origin.dimension}|${origin.x}|${origin.y}|${origin.z}`;
const furnaceRoutes = new WeakMap();

function blastFurnaceRoutes(dataset) {
  if (furnaceRoutes.has(dataset)) return furnaceRoutes.get(dataset);
  const byInput = new Map();
  for (const recipe of dataset.recipes ?? []) {
    if (recipe.type !== 'minecraft:blasting' || recipe.inputs?.length !== 2) continue;
    if (recipe.unsupported) continue;
    for (const input of recipe.inputs[0].choices ?? [recipe.inputs[0].resource]) {
      if (!byInput.has(input)) byInput.set(input, []);
      for (const configuration of recipe.configurations ?? []) {
        if (configuration.machine === 'minecraft:blast_furnace') byInput.get(input).push({recipe, configuration});
      }
    }
  }
  furnaceRoutes.set(dataset, byInput);
  return byInput;
}

function readBlastFurnaceAssignment(block, dataset) {
  const slots = new Map((block.Items ?? []).map(stack => [stack.Slot, stack]));
  const input = slots.get(0), fuel = slots.get(1);
  const history = Object.keys(block.RecipesUsed ?? {});
  const stock = stack => stack?.id && Number.isSafeInteger(stack.count) && stack.count > 0;
  if (slots.size !== (block.Items ?? []).length || (input?.components && Object.keys(input.components).length)
    || (fuel?.components && Object.keys(fuel.components).length)) {
    return {assignment_evidence: 'unsupported_saved_furnace_inventory',
      assignment_error: 'The saved blast-furnace inventory has duplicate slots or item components that need a matching recipe rule.'};
  }
  if (!stock(input)) return {assignment_evidence: history.length ? 'saved_recipe_history_only' : 'unassigned',
    assignment_error: 'No active input is saved. Recipe history and stored output do not establish an installed production route.'};
  const options = blastFurnaceRoutes(dataset).get(`item:${input.id}`) ?? [];
  const recipe_candidates = [...new Set(options.map(value => value.recipe.id))];
  const progress = block.CookTime, burning = block.BurnTime, total = block.CookTimeTotal;
  if (!Number.isSafeInteger(progress) || !Number.isSafeInteger(burning) || !Number.isSafeInteger(total)
    || progress < 0 || burning < 0 || total <= 0 || progress >= total) {
    return {assignment_evidence: 'invalid_saved_furnace_progress', recipe_candidates,
      assignment_error: 'The saved blast-furnace progress is invalid or unsupported.'};
  }
  if (progress === 0 || burning === 0) return {assignment_evidence: 'saved_input_without_active_cooking', recipe_candidates,
    assignment_error: 'The saved input is not actively cooking. Confirm an intended recipe and fuel before adding a capacity goal.'};
  if (!stock(fuel)) return {assignment_evidence: 'saved_cooking_without_queued_fuel', recipe_candidates,
    assignment_error: 'The furnace is cooking, but its fuel slot does not identify the next fuel. Choose a supported fuel route.'};
  const matches = options.filter(value => (value.recipe.inputs[1].choices ?? [value.recipe.inputs[1].resource])
    .includes(`item:${fuel.id}`)
    && value.configuration.capacity?.ticks_per_batch === total);
  if (matches.length !== 1) return {assignment_evidence: 'ambiguous_saved_furnace_route', recipe_candidates,
    assignment_error: 'The saved input, queued fuel, and cook time do not identify one supported blast-furnace route.'};
  return {recipe_id: matches[0].recipe.id, recipe_type: 'minecraft:blasting',
    configuration_id: matches[0].configuration.id, recipe_candidates,
    assignment_evidence: 'saved_cooking_input_and_queued_fuel',
    assignment_note: 'The input and cooking progress are saved facts. The queued fuel selects future full-burn operation; recipe history and stored output are not sustained rates.'};
}

export function inferIrradiatorAssignments(imported, dataset) {
  const definitions = new Map((dataset.machines ?? []).map(machine => [machine.id, machine]));
  for (const machine of imported.machines) {
    if (definitions.get(machine.id)?.mechanic !== 'irradiator') continue;
    delete machine.assignment_error;
    delete machine.configuration_id;
    machine.recipe_id = null;
    machine.assignment_evidence = 'unassigned';
    const fail = message => { machine.assignment_error = message; };
    if (machine.structure?.status !== 'matching_saved_geometry') {
      fail('The irradiator needs a uniquely matched structure before its nuclear hatches can establish capacity.'); continue;
    }
    const parts = imported.parts.filter(part => part.controller && locationKey(part.controller) === locationKey(machine.origin));
    const nuclear = parts.filter(part => part.hatch_type === 'modern_industrialization:nuclear_item');
    machine.saved_setup = {batch: nuclear.length};
    const occupied = slot => slot?.key?.id && BigInt(slot.amount ?? 0) > 0n;
    const fuels = nuclear.map(part => part.facts.items?.[0]);
    if (!nuclear.length || fuels.some(slot => !occupied(slot))) {
      fail('Some nuclear hatches have no active fuel. Choose the intended fuel and source; depleted output alone does not identify the original rod configuration.'); continue;
    }
    const fuelIds = new Set(fuels.map(slot => `item:${slot.key.id}`));
    if (fuelIds.size !== 1) {
      fail('The irradiator contains different fuel rods. A shared-source mixed-fuel allocation needs an explicit correction.'); continue;
    }
    const sourceSlots = parts.filter(part => part.hatch_type === 'modern_industrialization:item_input')
      .flatMap(part => part.facts.items ?? []).filter(occupied);
    const sourceIds = new Set(sourceSlots.map(slot => `item:${slot.key.id}`));
    if (sourceIds.size !== 1) {
      fail('The source input is empty or contains different items. Choose the intended neutron source.'); continue;
    }
    const matches = (dataset.recipes ?? []).flatMap(recipe => (recipe.configurations ?? []).filter(configuration =>
      configuration.machine === machine.id && configuration.startup_profile?.kind === 'irradiator'
      && configuration.startup_profile.batch === nuclear.length
      && fuelIds.has(configuration.startup_profile.fuel_resource)
      && sourceIds.has(configuration.startup_profile.source_resource)).map(configuration => ({recipe, configuration})));
    if (matches.length !== 1) {
      fail('The saved fuel and neutron source do not identify one supported irradiation configuration.'); continue;
    }
    const {recipe, configuration} = matches[0];
    machine.recipe_id = recipe.id;
    machine.recipe_type = recipe.type;
    machine.configuration_id = configuration.id;
    machine.assignment_evidence = 'saved_nuclear_fuel_and_source_with_unique_hatches';
  }
}

export function readMachineAssignment(block, machine, dataset) {
  if (block.id === 'minecraft:blast_furnace' && machine.recipe_type === 'minecraft:blasting') {
    return readBlastFurnaceAssignment(block, dataset);
  }
  if (machine.replication) {
    const template = block.items?.[0];
    if (!template?.key?.id || BigInt(template.amount ?? 0) <= 0n) return {assignment_evidence: 'missing_replication_template'};
    const resource = `item:${template.key.id}`;
    if (Object.keys(template.key.components ?? {}).length) return {assignment_evidence: 'unsupported_component_template',
      assignment_error: 'The saved replication template has components that need a matching replication rule.'};
    const recipe = dataset.recipes?.find(value => value.id === `replicate|${resource}` && value.configurations.some(configuration => configuration.machine === block.id));
    return recipe ? {recipe_id: recipe.id, recipe_type: recipe.type, obtained_resources: [resource], assignment_evidence: 'saved_replication_template'}
      : {assignment_error: 'The saved template has no supported replication route.', assignment_evidence: 'unsupported_replication_template'};
  }
  if (block.id === 'ae2:molecular_assembler') {
    const pattern = block.myPlan?.id ? block.myPlan : block.inv?.item10;
    const decoded = pattern ? decodePatterns([pattern])[0] : null;
    const installed = block.upgrades ?? [];
    if (installed.some(stack => stack.id !== 'ae2:speed_card')) return {assignment_error: 'The molecular assembler contains an unsupported upgrade.'};
    const count = installed.reduce((sum, stack) => sum + (stack.count ?? 1), 0);
    if (decoded?.kind !== 'crafting') return {upgrades: {id: 'ae2:speed_card', count}, assignment_evidence: 'unassigned',
      ...(decoded ? {assignment_error: 'The molecular assembler pattern has no supported crafting recipe.'} : {})};
    return {recipe_id: decoded.recipe_id, recipe_type: 'planner:crafting', upgrades: {id: 'ae2:speed_card', count},
      crafting_pattern: pattern.components['ae2:encoded_crafting_pattern'],
      assignment_evidence: block.myPlan?.id ? 'saved_transient_crafting_pattern' : 'saved_dedicated_crafting_pattern'};
  }
  return {};
}
