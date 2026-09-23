import test from 'node:test';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {ConstructionBalanceError, decodeConstruction} from './construction.js';
import {compileConstructionOrder, solveConstructionOrder} from './construction_order.js';

const highs = await loadHighs();
const flow = (resource, amount = 1) => ({resource, amount});
const line = (id, inputs, outputs, capacity = 1) => ({recipe: {id, inputs, outputs}, configuration: {id, operations_per_second: capacity}});
const order = () => compileConstructionOrder([
  line('consume', [flow('oil', 1000)], [flow('part')]),
  line('main', [flow('ore')], [flow('oil', 850)]),
  line('alternative', [flow('ore')], [flow('oil', 1000)], 0.000001),
], ['oil', 'part', 'ore'].map(id => ({id})), {construction: {external: [{resource: 'ore'}]}}, [flow('part', 60634.399123363226)]);

// These three operation counts reproduce the rejected plant-oil row from the endgame order.
const captured = {order: 1, cx0: 60634.399123363226, cx1: 71334.58720395205, cx2: 2.0153717154579057e-11, cs0: 71334.58720395205};

function corruptFirstSolution(always = false) {
  let reset = false;
  return {constants: highs.constants, infinity: highs.infinity, createModel: options => {
    const native = highs.createModel(options);
    return new Proxy(native, {get(target, key) {
      if (key === 'clearSolver') return () => {reset = true; return target.clearSolver();};
      if (key === 'getSolution') return () => {
        const solution = target.getSolution();
        if (reset && !always) return solution;
        const values = solution.colValue.slice();
        for (const [name, value] of Object.entries(captured)) values[target.getColByName(name)] = value;
        return {...solution, colValue: values};
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    }});
  }};
}

test('the captured scaled plant-oil residual fails the independent balance check', () => {
  assert.throws(() => decodeConstruction(order().construction, name => captured[name] ?? 0), error => {
    assert.ok(error instanceof ConstructionBalanceError);
    assert.equal(error.balance.resource, 'oil');
    assert.ok(-error.balance.surplus > error.balance.tolerance * 9);
    assert.equal(error.balance.terms.length, 3);
    return true;
  });
});

test('a rejected feasible buffer is solved again without scaling before it can be accepted', () => {
  const progress = [];
  const result = solveConstructionOrder(corruptFirstSolution(), order(), 5, {lines: []}, event => progress.push(event));
  assert.equal(result.status, 'optimal');
  assert.equal(result.search.numerical_retries, 1);
  assert.ok(progress.some(event => event.phase === 'construction_precision'));
  const balance = result.construction.balances.find(row => row.resource === 'oil');
  assert.ok(balance.surplus >= -balance.numerical_tolerance);
});

test('a repeated numerical failure returns no construction plan', () => {
  const result = solveConstructionOrder(corruptFirstSolution(true), order(), 5);
  assert.equal(result.status, 'numerical_error');
  assert.equal(result.construction, null);
  assert.equal(result.balance.resource, 'oil');
});
