import test from 'node:test';
import assert from 'node:assert/strict';
import {blockStateAt, decodePatterns, readProviders, readRequester, inferProviderAssignments} from './ae2.js';

test('AE2 patterns preserve fluid units and stored quantities', () => {
  const [pattern] = decodePatterns([{Slot: 3, id: 'ae2:processing_pattern', components: {
    'ae2:encoded_processing_pattern': {sparseInputs: [{'#t': 'ae2:f', id: 'minecraft:water', '#': '1000'}, {}],
      sparseOutputs: [{'#t': 'ae2:i', id: 'test:product', '#': '2'}]},
  }}]);
  assert.equal(pattern.slot, 3);
  assert.deepEqual(pattern.inputs, [{resource: 'fluid:minecraft:water', amount: 1000, components: {}}]);
  assert.equal(pattern.outputs[0].amount, 2);
});

test('cable-mounted providers target only their attached side', () => {
  const providers = readProviders({id: 'ae2:cable_bus', west: {id: 'ae2:cable_pattern_provider', patterns: []}},
    {dimension: 'minecraft:overworld', x: 1, y: 100, z: 0}, null);
  assert.equal(providers.length, 1);
  assert.deepEqual(providers[0].adjacent, [{dimension: 'minecraft:overworld', x: 0, y: 100, z: 0}]);
  assert.equal(providers[0].origin.part, 'west');
});

test('block states use padded long storage at negative coordinates', () => {
  const palette = Array.from({length: 17}, (_, index) => ({Name: `test:${index}`}));
  const data = Array(342).fill('0');
  data[0] = (16n << 55n).toString();
  assert.equal(blockStateAt({sections: [{Y: -1, block_states: {palette, data}}]}, 11, -16, 0).Name, 'test:16');
});

test('patterns do not create machines and ambiguous assignments remain editable', () => {
  const origin = {dimension: 'minecraft:overworld', x: 0, y: 0, z: 0};
  const flow = resource => ({choices: [resource], amount: 1, probability: 1});
  const recipe = id => ({type: 'test:smelt', source_id: id, status: 'normalized', inputs: [flow('ore')], outputs: [flow('metal')]});
  const pattern = {kind: 'processing', inputs: [{resource: 'ore', amount: 1, components: {}}], outputs: [{resource: 'metal', amount: 1, components: {}}]};
  const result = {machines: [{origin, recipe_type: 'test:smelt', recipe_id: null}], providers: [{adjacent: [origin], patterns: [pattern]}]};
  inferProviderAssignments(result, [recipe('first'), recipe('second')]);
  assert.equal(result.machines.length, 1);
  assert.equal(result.machines[0].recipe_id, null);
  assert.equal(result.machines[0].assignment_evidence, 'ambiguous_adjacent_patterns');
});
test('requester thresholds remain exact quantities without inventing a rate', () => {
  const result = readRequester({id: 'merequester:requester', requests: {
    0: {state: 1, key: {'#t': 'ae2:i', id: 'minecraft:iron_ingot'}, amount: '9223372036854775807', batch: '64'},
    1: {state: 0, key: {'#t': 'ae2:f', id: 'minecraft:water'}, amount: '1000', batch: '100'},
    2: {state: 1, amount: '0', batch: '1'},
  }}, {x: 10, y: 100, z: 0});
  assert.equal(result.requests.length, 2);
  assert.equal(result.requests[0].stock_target, '9223372036854775807');
  assert.equal(result.requests[0].rate, null);
  assert.equal(result.requests[1].enabled, false);
  assert.equal(result.requests[1].interpretation, 'quantity');
});
