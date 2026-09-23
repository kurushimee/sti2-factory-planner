import test from 'node:test';
import assert from 'node:assert/strict';
import {allocateFlows} from './flows.js';
import {readFileSync} from 'node:fs';

const consumer = (index, rate) => ({recipe: `consumer${index}`, configuration: 'fixed',
  inputs: [{resource: 'energy:eu', rate}], outputs: [], power_eu_per_tick: 0});

test('many small consumers do not erode a large shared source by repeated subtraction', () => {
  const lines = Array.from({length: 10000}, (_, index) => consumer(index, 0.1));
  lines.push(consumer('last', 1e9 - 1000));
  const result = allocateFlows(lines, [{resource: 'energy:eu', rate: 1e9}], new Map());
  assert.equal(result.connections.length, lines.length);
  assert.equal(result.connections.at(-1).rate, 1e9 - 1000);
  assert.deepEqual(result.retained, []);
  assert.deepEqual(result.flow_roundoff, []);
  assert.deepEqual(result.flow_roundoff_links, []);
});

test('the numerical allowance is shared by a resource rather than renewed for each consumer', () => {
  const lines = [consumer('full', 1), ...Array.from({length: 25}, (_, index) => consumer(index, 1e-8))];
  assert.throws(() => allocateFlows(lines, [{resource: 'energy:eu', rate: 1}], new Map()), /exceeds numerical tolerance/);
});

test('a large factory still rejects a deficit larger than its floating-point budget', () => {
  assert.throws(() => allocateFlows([consumer('all', 1e9 + 0.001)], [{resource: 'energy:eu', rate: 1e9}], new Map()), /exceeds numerical tolerance/);
});

test('accepted roundoff is recorded and small supplied flows remain connected', () => {
  const result = allocateFlows([consumer('all', 1 + 1e-8)], [{resource: 'energy:eu', rate: 1}], new Map());
  assert.equal(result.connections[0].rate, 1);
  assert.equal(result.flow_roundoff.length, 1);
  assert.ok(Math.abs(result.flow_roundoff[0].rate - 1e-8) < 1e-15);
  assert.equal(result.flow_roundoff_links[0].destination, 'consumerall|fixed');
  assert.equal(result.flow_roundoff_links[0].source, 'unallocated:energy:eu');
  assert.ok(Math.abs(result.flow_roundoff_links[0].rate - 1e-8) < 1e-15);
  const small = allocateFlows([consumer('small', 1e-12)], [{resource: 'energy:eu', rate: 1e-12}], new Map());
  assert.equal(small.connections[0].rate, 1e-12);
  assert.deepEqual(small.flow_roundoff, []);
});

test('the captured endgame candidate allocates its large power and shared material flows', () => {
  const fixture = JSON.parse(readFileSync(new URL('../data/provenance/large-flow-fixture.json', import.meta.url)));
  const result = allocateFlows(fixture.lines, fixture.external, new Map(fixture.demands));
  assert.equal(fixture.lines.length, 493);
  assert.ok(result.connections.length > 1000);
  for (const residual of result.flow_roundoff) assert.ok(residual.rate <= residual.numerical_tolerance);
  const power = result.connections.filter(value => value.resource === 'energy:eu').reduce((total, value) => total + value.rate, 0);
  assert.ok(power > 5e8);
});
