import test from 'node:test';
import assert from 'node:assert/strict';
import {associateStructures, structurePosition} from './structure.js';
import {inferProviderAssignments} from './ae2.js';

const origin = {dimension: 'minecraft:overworld', x: 0, y: 100, z: 0};
const cell = (position, allowed_hatches = []) => ({position, allowed_hatches,
  member_rule: {state_only_verified: true, matching_states: [{Name: 'test:casing', Properties: {}}]}});
const definition = {id: 'test:controller', shapes: [{index: 0, cells: [cell([1, 0, 0], ['test:item_input']), cell([0, 1, 0])]}]};
const make = () => ({machines: [{id: definition.id, origin, facts: {facingDirection: 2}, recipe_type: 'test:process'}],
  parts: [{origin: {...origin, x: -1}, hatch_type: 'test:item_input'}], providers: []});

test('captured shape coordinates follow each MI horizontal orientation', () => {
  assert.deepEqual([2, 3, 4, 5].map(facing => {
    const result = structurePosition(origin, facing, [2, 1, 3]); return [result.x, result.y, result.z];
  }), [[-2, 101, 3], [2, 101, -3], [3, 101, 2], [-3, 101, -2]]);
  assert.throws(() => structurePosition(origin, 1, [0, 0, 0]), /horizontal/);
});

test('a provider at an input hatch can assign its uniquely matching controller', () => {
  const result = make();
  associateStructures(result, {machines: [definition]}, () => ({Name: 'test:casing'}));
  assert.equal(result.machines[0].structure.status, 'matching_saved_geometry');
  assert.deepEqual(result.parts[0].controller, origin);
  const flow = resource => ({resource, amount: 1, components: {}});
  result.providers.push({adjacent: [result.parts[0].origin], patterns: [{kind: 'processing', inputs: [flow('ore')], outputs: [flow('metal')]}]});
  inferProviderAssignments(result, [{id: 'test:recipe', type: 'test:process', inputs: [flow('ore')], outputs: [flow('metal')]}]);
  assert.equal(result.machines[0].recipe_id, 'test:recipe');
  assert.equal(result.providers[0].hatch_connections.length, 1);
});

test('missing blocks and competing controllers cannot claim hatches', () => {
  const missing = make();
  associateStructures(missing, {machines: [definition]}, () => ({Name: 'minecraft:air'}));
  assert.equal(missing.parts[0].controller, undefined);
  assert.equal(missing.machines[0].structure.problems.length, 1);
  const shared = make();
  shared.machines.push({...shared.machines[0], origin: {...origin, x: -2}, facts: {facingDirection: 3}});
  associateStructures(shared, {machines: [definition]}, () => ({Name: 'test:casing'}));
  assert.equal(shared.parts[0].controller, undefined);
  assert.equal(shared.parts[0].controller_candidates.length, 2);
  assert.ok(shared.machines.every(machine => machine.structure.status === 'ambiguous_shared_hatch'));
});
