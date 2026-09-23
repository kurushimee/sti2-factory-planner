import test from 'node:test';
import assert from 'node:assert/strict';
import {productionTime} from './quantity.js';

test('large finite quantities preserve every digit and exact completion ticks', () => {
  const result = productionTime('1000000000000000000000000000001', 0.25);
  assert.equal(result.quantity, '1000000000000000000000000000001');
  assert.deepEqual(result.steady_production_seconds_exact, {numerator: '4000000000000000000000000000004', denominator: '1'});
  assert.equal(result.completion_ticks_ceil, '80000000000000000000000000000080');
  assert.equal(result.time_display, '4,000,000,000,000,000,000,000,000,000,004 seconds');
  assert.equal(result.steady_production_seconds, null);
});
test('decimal quantities and rates give an exact ratio before upward tick rounding', () => {
  const result = productionTime('1.5', 0.9);
  assert.deepEqual(result.steady_production_seconds_exact, {numerator: '5', denominator: '3'});
  assert.equal(result.time_display, '5/3 seconds');
  assert.equal(result.steady_production_seconds, null);
  assert.equal(result.completion_ticks_ceil, '34');
  assert.equal(productionTime('6e2', 1).steady_production_seconds, 600);
  assert.equal(productionTime('0.5', 1).steady_production_seconds, 0.5);
  assert.equal(productionTime('1e1000', 1).steady_production_seconds, null);
  assert.equal(productionTime('1e1000', 1).time_display, '10^1000 seconds');
  assert.equal(productionTime('2e1000', 1).time_display, '2 × 10^1000 seconds');
  assert.equal(productionTime('5e-1000', 1).time_display, '1/(2 × 10^999) seconds');
  assert.equal(productionTime('0.0000001', 1).time_display, '1/10,000,000 seconds');
});
test('invalid and unbounded quantity text is rejected without rounded integer coercion', () => {
  for (const quantity of [0, -1, Infinity, 1e30, '-4', 'NaN', '0e2', '1e1001', '2'.repeat(1001)]) {
    assert.throws(() => productionTime(quantity, 1), /quantity/);
  }
});
