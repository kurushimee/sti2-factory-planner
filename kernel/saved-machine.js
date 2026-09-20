import {decodePatterns} from './ae2.js';

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
