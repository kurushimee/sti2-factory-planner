import test from 'node:test';
import assert from 'node:assert/strict';
import {startupRequirements} from './startup.js';

test('startup stocks combine shared producer deficits and separate first input loads', () => {
  const line = (recipe, machines) => ({recipe, configuration: 'test', machines, operations_per_second: machines,
    inputs: [{resource: 'water', rate: 2 * machines}], outputs: [{resource: 'product', rate: 3 * machines}],
    configuration_details: {build_requirements: [{resource: 'item:machine', amount: 1}],
      startup_inputs: [{resource: 'catalyst', amount: 1}],
      capacity: {operations_per_second: 1, ticks_per_batch: 20, completion_ticks: [40, 60]}}});
  const result = startupRequirements([line('first', 2), line('second', 1)]);
  assert.equal(result.resources.find(flow => flow.resource === 'product').quantity, 18);
  assert.equal(result.resources.find(flow => flow.resource === 'water').quantity, 12);
  assert.equal(result.resources.find(flow => flow.resource === 'catalyst').quantity, 3);
  assert.deepEqual(result.build_requirements, [{resource: 'item:machine', amount: 3}]);
});

test('missing warm-up behavior is visible instead of becoming a zero stock claim', () => {
  const result = startupRequirements([{recipe: 'unknown', configuration: 'fixed', machines: 1,
    operations_per_second: 1, inputs: [], outputs: [], configuration_details: {}}]);
  assert.equal(result.incomplete.length, 1);
});
