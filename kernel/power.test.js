import test from 'node:test';
import assert from 'node:assert/strict';
import {generationSupport} from './power.js';

test('generation support includes shared fuel work once and excludes electricity consumers', () => {
  const line = (recipe, power, outputs = [], inputs = []) => ({recipe, configuration: 'a', power_eu_per_tick: power, outputs, inputs});
  const lines = [line('mine', 3), line('fuel', 5), line('generator', 2, [{resource: 'energy:eu', rate: 2000}]),
    line('factory', 20), line('pump', 0, [], [{resource: 'energy:eu', rate: 40}])];
  const edge = (source, destination, resource = 'item:fuel') => ({source: source + '|a', destination: destination + '|a', resource});
  const result = generationSupport(lines, [edge('mine', 'fuel'), edge('fuel', 'generator'), edge('fuel', 'factory'),
    edge('pump', 'fuel'), edge('fuel', 'pump'), edge('generator', 'factory', 'energy:eu'), edge('generator', 'mine', 'energy:eu')]);
  assert.equal(result.generation_related_consumption_eu_per_tick, 12);
  assert.equal(result.other_production_consumption_eu_per_tick, 20);
  assert.deepEqual(result.generation_support_lines, ['fuel|a', 'generator|a', 'mine|a', 'pump|a']);
});

test('external electricity does not turn ordinary production into generation support', () => {
  const result = generationSupport([{recipe: 'a', configuration: 'b', inputs: [], outputs: [], power_eu_per_tick: 4}],
    [{source: 'external:energy:eu', destination: 'a|b', resource: 'energy:eu'}]);
  assert.equal(result.generation_related_consumption_eu_per_tick, 0);
  assert.equal(result.other_production_consumption_eu_per_tick, 4);
});
