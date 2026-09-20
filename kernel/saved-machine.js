import {decodePatterns} from './ae2.js';

const locationKey = origin => `${origin.dimension}|${origin.x}|${origin.y}|${origin.z}`;

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
