import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructFactory} from './reconstruct.js';

const machine = {id: 'machine', status: 'supported', mechanic: 'mi_crafter', recipe_type: 'process', base_eu: 8, max_eu: 32};
const recipe = (id, input, output) => ({id, source_id: id, type: 'process', primary: output, inputs: input ? [{resource: input, amount: 1}] : [],
  outputs: [{resource: output, amount: 1}], configurations: [], process: {type: 'process', duration_ticks: 20, eu_per_tick: 2}});
const saved = (id, x) => ({id: 'machine', recipe_id: id, recipe_type: 'process', upgrades: {},
  origin: {dimension: 'minecraft:overworld', x, y: 100, z: 0}, assignment_evidence: 'saved_active_recipe'});

test('imported sink capacity is retained while upstream bottlenecks remain adjustable', () => {
  const dataset = {machines: [machine], recipes: [recipe('plate', 'ore', 'plate'), recipe('gear', 'plate', 'gear')]};
  const result = reconstructFactory({machines: [saved('plate', 0), saved('gear', 1), saved('gear', 2)], requesters: []}, dataset);
  assert.equal(result.goals.length, 1);
  assert.equal(result.goals[0].recipe, 'gear');
  assert.equal(result.goals[0].machines, 2);
  assert.equal(result.goals[0].origins.length, 2);
  assert.deepEqual(Object.keys(result.machine_setups), ['gear']);
  assert.equal(result.assignments.length, 3);
  assert.equal(result.unresolved.length, 0);
  const omitted = reconstructFactory({machines: [saved('gear', 1)]}, dataset, {'minecraft:overworld|1|100|0': {goal: false}});
  assert.equal(omitted.goals.length, 0);
  assert.equal(omitted.unresolved.length, 0);
});

test('unknown assignments and closed cycles require focused corrections', () => {
  const dataset = {machines: [machine], recipes: [recipe('a', 'b', 'a'), recipe('b', 'a', 'b')]};
  const world = {machines: [saved('a', 0), saved('b', 1), saved(null, 2)]};
  const unresolved = reconstructFactory(world, dataset);
  assert.equal(unresolved.goals.length, 0);
  assert.equal(unresolved.unresolved.length, 2);
  const corrected = reconstructFactory(world, dataset, {'minecraft:overworld|0|100|0': {goal: true}});
  assert.equal(corrected.goals[0].recipe, 'a');
  assert.equal(corrected.unresolved.length, 1);
});

test('requester quantities stay separate from imported production capacity', () => {
  const result = reconstructFactory({machines: [saved('a', 0)], requesters: [{origin: {x: 8}, requests: [{resource: 'a', stock_target: '4096', rate: null}]}]},
    {machines: [machine], recipes: [recipe('a', null, 'a')]});
  assert.equal(result.stock_targets[0].stock_target, '4096');
  assert.equal(result.stock_targets[0].rate, null);
  assert.equal(result.goals[0].machines, 1);
  assert.equal(result.goals[0].kind, 'capacity');
});
