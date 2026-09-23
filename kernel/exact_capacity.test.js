import assert from 'node:assert/strict';
import test from 'node:test';
import {exactInstalledCapacity} from './exact_capacity.js';
import loadHighs from 'highs';
import {solveFactory} from './planner.js';

const highs = await loadHighs();

test('installed full-speed capacity uses the batch and whole tick count', () => {
  assert.deepEqual(exactInstalledCapacity({setup: {batch: 3, contained_count: 8},
    capacity: {ticks_per_batch: 53}}, 2),
  {numerator: '120', denominator: '53', display: '120/53'});
  assert.deepEqual(exactInstalledCapacity({capacity: {ticks_per_batch: 100}}, 1),
    {numerator: '1', denominator: '5', display: '1/5'});
});

test('large integer capacities stay exact without floating-point products', () => {
  assert.deepEqual(exactInstalledCapacity({setup: {batch: 1000000000, contained_count: 2},
    capacity: {ticks_per_batch: 20}}, 1000000),
  {numerator: '1000000000000000', denominator: '1', display: '1,000,000,000,000,000'});
});

test('missing or fractional tick metadata does not claim an exact capacity', () => {
  assert.equal(exactInstalledCapacity({capacity: {}}, 1), null);
  assert.equal(exactInstalledCapacity({capacity: {ticks_per_batch: 1.5}}, 1), null);
  assert.equal(exactInstalledCapacity({operations_per_second: 7,
    capacity: {ticks_per_batch: 20}}, 1), null);
});

test('a source-defined chance process keeps its exact expected rate separate from guarantees', () => {
  const configuration = {operations_per_second: 1 / 12,
    capacity: {expected_operations_per_second_ratio: {numerator: '1', denominator: '12'}}};
  assert.deepEqual(exactInstalledCapacity(configuration, 5),
    {numerator: '5', denominator: '12', display: '5/12'});
  assert.equal(exactInstalledCapacity({...configuration, operations_per_second: 0.1}, 5), null);
});

test('decoded plans carry the exact installed capacity beside numeric optimization values', () => {
  const configuration = {id: 'press:batch', machine: 'press', operations_per_second: 20 / 53,
    setup: {batch: 2}, capacity: {ticks_per_batch: 106}};
  const dataset = {format: 1, resources: [{id: 'part'}], recipes: [{id: 'press', primary: 'part', inputs: [],
    outputs: [{resource: 'part', amount: 1}], configurations: [configuration]}]};
  const result = solveFactory(highs, dataset, {goals: [{resource: 'part', rate: 0.5}]});
  assert.equal(result.status, 'optimal');
  assert.equal(result.lines[0].machines, 2);
  assert.deepEqual(result.lines[0].capacity_per_second_exact,
    {numerator: '40', denominator: '53', display: '40/53'});
});
