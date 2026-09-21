import test from 'node:test';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {compileFactory, decodeFactory, FactoryBalanceError} from './planner.js';
import {findFactorySeed} from './seed.js';

const highs = await loadHighs();
const capturedConsumer = 0.8000002025463024;
const capturedProducer = 3.2000008090872143;
const dataset = {format: 1, resources: ['acid', 'part', 'ore'].map(id => ({id})), recipes: [
  {id: 'consume', primary: 'part', inputs: [{resource: 'acid', amount: 1000}], outputs: [{resource: 'part', amount: 1}],
    configurations: [{id: 'consumer', machine: 'consumer', operations_per_second: 10}]},
  {id: 'produce', primary: 'acid', inputs: [{resource: 'ore', amount: 1}], outputs: [{resource: 'acid', amount: 250}],
    configurations: [{id: 'producer', machine: 'producer', operations_per_second: 10}]},
]};
const request = {goals: [{resource: 'part', rate: capturedConsumer}], external: [{resource: 'ore'}]};

test('the captured phosphoric-acid residual is rejected without relaxing its tolerance', () => {
  const model = compileFactory(dataset, request);
  const values = {x0: capturedConsumer, x1: capturedProducer, n0: 1, n1: 1, s0: capturedProducer};
  const Columns = Object.fromEntries(Object.entries(values).map(([name, Primal]) => [name, {Primal}]));
  assert.throws(() => decodeFactory(model, {Columns}), error => {
    assert.ok(error instanceof FactoryBalanceError);
    assert.equal(error.balance.resource, 'acid');
    assert.equal(error.balance.tolerance, 1e-7);
    assert.ok(-error.balance.net > error.balance.tolerance * 2);
    return true;
  });
});

test('a large-plan seed retries a rejected resource balance with unscaled constraints', () => {
  let reset = false, rejections = 0;
  const runtime = {constants: highs.constants, infinity: highs.infinity, createModel: options => {
    const native = highs.createModel(options);
    return new Proxy(native, {get(target, key) {
      if (key === 'clearSolver') return () => {reset = true; return target.clearSolver();};
      if (key === 'getSolution') return () => {
        const solution = target.getSolution();
        if (reset) return solution;
        const colValue = solution.colValue.slice();
        colValue[target.getColByName('x0')] = capturedConsumer;
        colValue[target.getColByName('x1')] = capturedProducer;
        return {...solution, colValue};
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    }});
  }};
  const model = compileFactory(dataset, request);
  const result = findFactorySeed(runtime, model, request, Date.now() + 5000, candidate => {
    try {decodeFactory(model, candidate); return true;}
    catch (error) {
      if (!(error instanceof FactoryBalanceError)) throw error;
      rejections++; return false;
    }
  });
  assert.equal(rejections, 1);
  assert.equal(result.numerical_retries, 1);
  const plan = decodeFactory(model, result);
  assert.ok(plan.balances.every(row => row.surplus >= -row.numerical_tolerance));
  assert.equal(plan.lines[0].machines, 1);
  assert.equal(plan.lines[1].machines, 1);
});
