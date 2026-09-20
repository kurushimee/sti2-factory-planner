import test from 'node:test';
import assert from 'node:assert/strict';
import {readMachineAssignment} from './saved-machine.js';
import {reconstructFactory} from './reconstruct.js';

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
