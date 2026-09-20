import test from 'node:test';
import assert from 'node:assert/strict';
import {startupRequirements} from './startup.js';
import {compileConfiguration} from './configuration.js';

test('selected deferred configurations recover the same cold-start stocks', () => {
  const recipe = {id: 'press', duration_ticks: 200, eu_per_tick: 2};
  const machine = {id: 'press', mechanic: 'mi_crafter', base_eu: 8, max_eu: 32};
  const evaluate = compute_warmup => {
    const configuration = compileConfiguration(recipe, machine, {compute_warmup});
    return startupRequirements([{recipe: 'press', configuration: configuration.id, machines: 2,
      operations_per_second: 1, inputs: [{resource: 'ingot', rate: 1}],
      outputs: [{resource: 'plate', rate: 1}], configuration_details: configuration}]);
  };
  assert.deepEqual(evaluate(false), evaluate(true));
});

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
