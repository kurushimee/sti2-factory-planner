import test from 'node:test';
import assert from 'node:assert/strict';
import {startupRequirements} from './startup.js';
import {compileConfiguration} from './configuration.js';
import {boilerWarmup} from './boiler.js';

test('boiler startup stocks cover every delivery tick at full and partial demand', () => {
  const rule = {max_eu_per_tick: 8, eu_per_degree: 8, temperature_max: 1500};
  const fuel = {kind: 'item', eu_per_unit: 32000};
  const schedule = boilerWarmup(rule, fuel);
  for (const rate of [160, 80, 1]) {
    const result = startupRequirements([{recipe: 'boil', configuration: 'bronze', machines: 1,
      operations_per_second: rate, inputs: [{resource: 'coal', rate: rate / 32000}, {resource: 'water', rate: rate / 16}],
      outputs: [{resource: 'steam', rate}], configuration_details: {startup_profile: {kind: 'boiler', rule, fuel,
        fuel_resources: ['coal'], water_resource: 'water', steam_resource: 'steam'}}}]);
    let remaining = result.resources.find(value => value.resource === 'steam').quantity;
    for (const segment of schedule.output_segments) for (let tick = segment.first_tick; tick <= segment.last_tick; tick++) {
      remaining -= rate / 20;
      assert.ok(remaining >= -1e-8, `Steam runs out before tick ${tick} at ${rate} mB/s.`);
      remaining += segment.steam_per_tick;
    }
    assert.equal(result.resources.find(value => value.resource === 'water').quantity, 1203);
    assert.equal(result.resources.find(value => value.resource === 'coal').quantity, 1);
    assert.equal(result.incomplete.length, 0);
  }
});

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
