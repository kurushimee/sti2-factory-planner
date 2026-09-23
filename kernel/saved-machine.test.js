import test from 'node:test';
import assert from 'node:assert/strict';
import {readMachineAssignment, inferIrradiatorAssignments} from './saved-machine.js';
import {reconstructFactory} from './reconstruct.js';

test('saved blast-furnace input and queued fuel select a capacity route without treating history as demand', () => {
  const machine = {id: 'minecraft:blast_furnace', recipe_type: 'minecraft:blasting', mechanic: 'utility', status: 'supported'};
  const makeRecipe = fuel => ({id: `blast:${fuel}`, type: 'minecraft:blasting', primary: 'item:iron',
    inputs: [{resource: 'item:pure_iron', amount: 1}, {resource: `item:${fuel}`, amount: 0.125}],
    outputs: [{resource: 'item:iron', amount: 1}], configurations: [{id: `config:${fuel}`, machine: machine.id,
      operations_per_second: 0.2, capacity: {ticks_per_batch: 100}}]});
  const dataset = {machines: [machine], recipes: [makeRecipe('coal'), makeRecipe('lava_bucket')]};
  const block = {id: machine.id, Items: [{Slot: 0, id: 'pure_iron', count: 2},
    {Slot: 1, id: 'coal', count: 1}, {Slot: 2, id: 'iron', count: 1}],
    CookTime: 20, CookTimeTotal: 100, BurnTime: 681, RecipesUsed: {'test:iron': 1}};
  const assignment = readMachineAssignment(block, machine, dataset);
  assert.equal(assignment.recipe_id, 'blast:coal');
  assert.equal(assignment.configuration_id, 'config:coal');
  assert.equal(assignment.assignment_evidence, 'saved_cooking_input_and_queued_fuel');
  const ambiguous = {...dataset, recipes: [{...dataset.recipes[0], configurations: [
    ...dataset.recipes[0].configurations, {...dataset.recipes[0].configurations[0], id: 'second-coal'}]},
  dataset.recipes[1]]};
  assert.equal(readMachineAssignment(block, machine, ambiguous).assignment_evidence,
    'ambiguous_saved_furnace_route');
  const origin = {dimension: 'minecraft:overworld', x: 5, y: 64, z: 0};
  const imported = {machines: [{...assignment, id: machine.id, origin, facts: block}]};
  const reconstructed = reconstructFactory(imported, dataset);
  assert.equal(reconstructed.goals.length, 1);
  assert.equal(reconstructed.goals[0].machines, 1);
  assert.equal(reconstructed.goals[0].recipe, 'blast:coal');
  block.Items = [{Slot: 0, id: 'pure_iron', count: 2}, {Slot: 2, id: 'iron', count: 1}];
  const missingFuel = readMachineAssignment(block, machine, dataset);
  assert.equal(missingFuel.recipe_id, undefined);
  assert.deepEqual(missingFuel.recipe_candidates, ['blast:coal', 'blast:lava_bucket']);
  imported.machines[0] = {...missingFuel, id: machine.id, origin, facts: block};
  assert.equal(reconstructFactory(imported, dataset).unresolved[0].recipe_candidates.length, 2);
  block.Items = [{Slot: 2, id: 'iron', count: 1}];
  assert.equal(readMachineAssignment(block, machine, dataset).assignment_evidence, 'saved_recipe_history_only');
  block.Items = [{Slot: 0, id: 'pure_iron', count: 2, components: {'minecraft:custom_name': 'Special'}}];
  assert.equal(readMachineAssignment(block, machine, dataset).assignment_evidence, 'unsupported_saved_furnace_inventory');
});

test('replicator templates establish a fixed route and obtained item, never a free supply', () => {
  const machine = {id: 'mi:replicator', replication: true, mechanic: 'replicator', status: 'supported'};
  const recipe = {id: 'replicate|item:iron', type: 'planner:replication', primary: 'item:iron', inputs: [{resource: 'uu', amount: 100}],
    outputs: [{resource: 'item:iron', amount: 1}], configurations: [{id: 'replicate|item:iron', machine: machine.id, operations_per_second: 1}]};
  const dataset = {machines: [machine], recipes: [recipe]};
  const block = {id: machine.id, items: [{key: {id: 'iron'}, amount: '1'}]};
  const saved = readMachineAssignment(block, machine, dataset);
  assert.equal(saved.assignment_evidence, 'saved_replication_template');
  const result = reconstructFactory({machines: [{id: machine.id, origin: {dimension: 'overworld', x: 0, y: 0, z: 0}, ...saved}]}, dataset);
  assert.equal(result.goals[0].configuration, recipe.id);
  assert.deepEqual(result.obtained_resources, ['item:iron']);
  assert.equal(result.external, undefined);
  block.items[0].key.components = {'minecraft:custom_name': 'Special'};
  assert.match(readMachineAssignment(block, machine, dataset).assignment_error, /components/);
});

test('molecular assembler reads its dedicated slot and speed cards, with active forced-plan precedence', () => {
  const pattern = recipeId => ({id: 'ae2:crafting_pattern', components: {'ae2:encoded_crafting_pattern': {recipeId, inputs: [], canSubstitute: false}}});
  const block = {id: 'ae2:molecular_assembler', inv: {item10: pattern('sticks')},
    upgrades: [{id: 'ae2:speed_card', count: 1, Slot: 0}, {id: 'ae2:speed_card', count: 1, Slot: 1}]};
  const result = readMachineAssignment(block, {}, {});
  assert.equal(result.recipe_id, 'sticks');
  assert.equal(result.upgrades.count, 2);
  assert.equal(result.assignment_evidence, 'saved_dedicated_crafting_pattern');
  block.myPlan = pattern('active');
  assert.equal(readMachineAssignment(block, {}, {}).recipe_id, 'active');
  assert.equal(readMachineAssignment(block, {}, {}).assignment_evidence, 'saved_transient_crafting_pattern');
});

test('irradiator reconstruction uses uniquely associated active rods and accounts for its ongoing source consumer', () => {
  const origin = {dimension: 'minecraft:overworld', x: 1, y: 2, z: 3};
  const machine = {id: 'irradiator', mechanic: 'irradiator', status: 'supported'};
  const recipe = {id: 'irradiate', type: 'planner:irradiation', primary: 'depleted', inputs: [{resource: 'item:fuel', amount: 1}],
    outputs: [{resource: 'depleted', amount: 1}], configurations: [1, 2].map(batch => ({id: `hatches:${batch}`, machine: machine.id,
      operations_per_second: batch / 400, startup_profile: {kind: 'irradiator', batch, fuel_resource: 'item:fuel', source_resource: 'item:source'},
      operating_points: [{operations_per_second: 0, inputs: [{resource: 'item:source', amount: .005}]}]}))};
  const sourceRecipe = {id: 'source', primary: 'item:source', inputs: [], outputs: [{resource: 'item:source', amount: 1}],
    configurations: [{id: 'source', machine: 'source-machine', operations_per_second: 1}]};
  const dataset = {machines: [machine, {id: 'source-machine', mechanic: 'utility', status: 'supported'}], recipes: [recipe, sourceRecipe]};
  const slot = id => ({key: {id}, amount: '1'});
  const imported = {machines: [{id: machine.id, origin, structure: {status: 'matching_saved_geometry'}},
    {id: 'source-machine', origin: {...origin, x: 5}, recipe_id: 'source'}], parts: [
      ...[0, 1].map(() => ({controller: origin, hatch_type: 'modern_industrialization:nuclear_item', facts: {items: [slot('fuel'), slot('depleted')]}})),
      {controller: origin, hatch_type: 'modern_industrialization:item_input', facts: {items: [slot('source')]}}]};
  inferIrradiatorAssignments(imported, dataset);
  const result = reconstructFactory(imported, dataset);
  assert.deepEqual(result.unresolved, []);
  assert.equal(result.goals.length, 1);
  assert.equal(result.goals[0].configuration, 'hatches:2');
  assert.equal(result.goals[0].machines, 1);
  assert.equal(result.goal_candidates.find(value => value.recipe === 'source').retained, false);
  imported.parts[0].facts.items[0].amount = '0';
  inferIrradiatorAssignments(imported, dataset);
  assert.match(reconstructFactory(imported, dataset).unresolved[0].reason, /no active fuel/);
  const corrected = reconstructFactory(imported, dataset, {'minecraft:overworld|1|2|3': {recipe: 'irradiate'}});
  assert.deepEqual(corrected.unresolved, []);
  assert.equal(corrected.goals[0].configuration, 'hatches:2');
  imported.parts[0].facts.items[0] = slot('different-fuel');
  inferIrradiatorAssignments(imported, dataset);
  assert.match(reconstructFactory(imported, dataset).unresolved[0].reason, /different fuel/);
  imported.machines[0].structure.status = 'ambiguous_shared_hatch';
  inferIrradiatorAssignments(imported, dataset);
  assert.match(reconstructFactory(imported, dataset).unresolved[0].reason, /uniquely matched/);
});
