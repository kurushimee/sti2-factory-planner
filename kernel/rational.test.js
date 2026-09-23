import assert from 'node:assert/strict';
import test from 'node:test';
import * as Q from './rational.js';

test('decimal inputs and large fractions retain their exact values', () => {
  assert.equal(Q.text(Q.decimal('0.00640625')), '41/6400');
  assert.equal(Q.text(Q.add(Q.decimal('0.1'), Q.decimal('0.2'))), '3/10');
  assert.equal(Q.text(Q.divide(Q.decimal(1), Q.decimal(3))), '1/3');
  assert.equal(Q.compare(Q.decimal('1e-18'), Q.ZERO), 1);
  assert.equal(Q.number(Q.ratio(1n, 10n ** 50n)), 1e-50);
});
