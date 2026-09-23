import test from 'node:test';
import assert from 'node:assert/strict';
import {startupRequirements} from './startup.js';
import {compileConfiguration} from './configuration.js';
import {boilerWarmup} from './boiler.js';

test('irradiator stocks cover source discovery and whole initial rods at every hatch', () => {
  const result = startupRequirements([{recipe: 'irradiate', configuration: 'eight', machines: 2,
    operations_per_second: 0.04, inputs: [{resource: 'rod', rate: 0.04}, {resource: 'source', rate: 0.01}],
    outputs: [{resource: 'depleted', rate: 0.04}], configuration_details: {startup_profile: {
      kind: 'irradiator', fuel_resource: 'rod', source_resource: 'source', source_per_second: 0.005,
      batch: 8, cycle_ticks: 8000, discovery_delay_ticks: 59}}}]);
  assert.equal(result.resources.find(value => value.resource === 'rod').first_operation_stock, 16);
  assert.equal(result.resources.find(value => value.resource === 'source').first_operation_stock, 6);
  assert.ok(Math.abs(result.resources.find(value => value.resource === 'depleted').warmup_output_stock - 16.118) < 1e-10);
  assert.deepEqual(result.incomplete, []);
});

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

test('a blast furnace needs whole initial fuel and an input at each machine', () => {
  const result = startupRequirements([{recipe: 'blast', configuration: 'lava', machines: 3,
    operations_per_second: 0.3, inputs: [{resource: 'pure_iron', rate: 0.3}, {resource: 'lava_bucket', rate: 0.003}],
    outputs: [{resource: 'iron', rate: 0.3}, {resource: 'bucket', rate: 0.003}],
    configuration_details: {build_requirements: [{resource: 'blast_furnace', amount: 1}],
      startup_profile: {kind: 'vanilla_furnace', ingredient_resource: 'pure_iron',
        fuel_resource: 'lava_bucket', fuel_remainder_resource: 'bucket', first_completion_ticks: 100}}}]);
  assert.equal(result.resources.find(value => value.resource === 'lava_bucket').first_operation_stock, 3);
  assert.equal(result.resources.find(value => value.resource === 'pure_iron').first_operation_stock, 3);
  assert.equal(result.resources.find(value => value.resource === 'iron').warmup_output_stock, 2);
  assert.equal(result.resources.find(value => value.resource === 'bucket').warmup_output_stock, 1);
  assert.deepEqual(result.build_requirements, [{resource: 'blast_furnace', amount: 3}]);
  assert.deepEqual(result.incomplete, []);
});

test('retained inputs survive unknown timing and specialized startup profiles', () => {
  for (const profile of [undefined, {kind: 'irradiator', cycle_ticks: 100, discovery_delay_ticks: 20,
    fuel_resource: 'fuel', batch: 1, source_resource: 'source', source_per_second: 0.1}]) {
    const result = startupRequirements([{recipe: 'source', configuration: 'fixed', machines: 3,
      operations_per_second: 1, inputs: [], outputs: [], configuration_details: {
        startup_inputs: [{resource: 'retained', amount: 2}], startup_profile: profile}}]);
    assert.equal(result.resources.find(flow => flow.resource === 'retained').reusable_stock, 6);
    assert.equal(result.incomplete.length, profile ? 0 : 1);
  }
});
