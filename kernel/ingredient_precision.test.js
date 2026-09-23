import test from 'node:test';
import assert from 'node:assert/strict';
import {compileConstructionOrder} from './construction_order.js';
import {ConstructionBalanceError, decodeConstruction} from './construction.js';

function order(amount) {
  return compileConstructionOrder([{recipe: {id: 'part', inputs: [{choices: ['a', 'b'], amount: 8}],
    outputs: [{resource: 'part', amount: 1}]}, configuration: {id: 'bench', operations_per_second: 1}}],
  ['a', 'b', 'part'].map(id => ({id})), {construction: {external: [{resource: 'a'}, {resource: 'b'}]}}, [{resource: 'part', amount}]);
}

test('balanced resource rows cannot conceal missing alternative ingredients', () => {
  for (const amount of [1, 1e-12]) {
    const model = order(amount);
    const values = {order: 1, cx0: amount};
    assert.throws(() => decodeConstruction(model.construction, name => values[name] ?? 0), error =>
      error instanceof ConstructionBalanceError && error.balance.resource === 'part, ingredient 1');
  }
});

test('the captured endgame ingredient residual remains within the declared solver tolerance', () => {
  const model = order(448.5);
  const values = {order: 1, cx0: 448.5, ca0_0_0: 3586.5000000004657, ca0_0_1: 1.5,
    cs0: 3586.5000000004657, cs1: 1.5};
  const result = decodeConstruction(model.construction, name => values[name] ?? 0);
  assert.equal(result.routes[0].operations, 448.5);
});
