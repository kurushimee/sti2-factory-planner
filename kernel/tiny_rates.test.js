import test from 'node:test';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {compileFactory, decodeFactory, FactoryBalanceError, solveFactory} from './planner.js';
import {allocateFlows} from './flows.js';
import {scaleConstraintRows} from './numerics.js';
import {compileConstructionOrder, solveConstructionOrder} from './construction_order.js';

const highs = await loadHighs();
const dataset = {format: 1, resources: ['ore', 'other', 'part'].map(id => ({id})), recipes: [{
  id: 'make', primary: 'part', inputs: [{resource: 'ore', amount: 1}], outputs: [{resource: 'part', amount: 1}],
  configurations: [{id: 'machine', machine: 'machine', operations_per_second: 1}],
}]};
const request = rate => ({goals: [{resource: 'part', rate}], external: [{resource: 'ore'}]});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= expected * 1e-8, `${actual} != ${expected}`);

test('tiny positive goals retain their whole machine, input flow, and route ownership', () => {
  for (const rate of [1e-8, 1e-10, 1e-12]) {
    const result = solveFactory(highs, dataset, request(rate));
    assert.ok(['optimal', 'feasible'].includes(result.status), JSON.stringify(result));
    assert.equal(result.lines[0].machines, 1);
    close(result.lines[0].operations_per_second, rate);
    close(result.lines[0].inputs[0].rate, rate);
    close(result.connections.find(flow => flow.destination === 'goal:part').rate, rate);
    assert.deepEqual(result.primary_routes, [{recipe: 'make', resource: 'part'}]);
    if (rate < 1e-9) {
      assert.equal(result.optimal, false);
      assert.equal(result.optimization.lower_bound, null);
    }
  }
});

test('large recipe output quantities do not erase tiny operation and ingredient rates', () => {
  const data = structuredClone(dataset);
  data.recipes[0].outputs[0].amount = 1e12;
  const result = solveFactory(highs, data, request(1));
  assert.equal(result.lines[0].machines, 1);
  close(result.lines[0].operations_per_second, 1e-12);
  close(result.external[0].rate, 1e-12);
  close(result.connections.find(flow => flow.destination === 'goal:part').rate, 1);
});

test('missing tiny alternative ingredients and zero-machine activity fail independent checks', () => {
  const data = structuredClone(dataset);
  data.recipes[0].inputs = [{choices: ['ore', 'other'], amount: 1}];
  const model = compileFactory(data, request(1e-12));
  assert.throws(() => decodeFactory(model, {Columns: {n0: {Primal: 1}, x0: {Primal: 1e-12}}}), FactoryBalanceError);
  const plain = compileFactory(dataset, request(1e-12));
  assert.throws(() => decodeFactory(plain, {Columns: {x0: {Primal: 1e-12}, s0: {Primal: 1e-12}}}), FactoryBalanceError);
  assert.throws(() => allocateFlows([], [], new Map([['part', 1e-12]])), /exceeds numerical tolerance/);
});

test('unestablished precision returns no completed plan and leaves its reason visible', () => {
  const result = solveFactory(highs, dataset, request(1e-30));
  assert.equal(result.status, 'numerical_error');
  assert.equal(result.lines, undefined);
  assert.match(result.reason, /part/);
});

test('row recovery preserves inequality direction, integer declarations, and the objective', () => {
  const model = compileFactory(dataset, request(1e-12));
  const scaled = scaleConstraintRows(model.text);
  assert.equal(scaled.split('Subject To')[0], model.text.split('Subject To')[0]);
  assert.equal(scaled.split('Bounds')[1], model.text.split('Bounds')[1]);
  assert.match(scaled, /capacity_0: \+ 1000000 x0 - 1000000 n0 <= 0/);
  assert.match(scaled, /\+ 1000000 x0 >= 0\.000001/);
});

test('large finite quantities keep exact production time after recovering a tiny rate', () => {
  const settings = request(1e-12);
  Object.assign(settings.goals[0], {kind: 'quantity', quantity: '1000000000000000000000000'});
  const result = solveFactory(highs, dataset, settings);
  assert.equal(result.lines[0].machines, 1);
  assert.equal(result.targets[0].steady_production_seconds_exact.numerator, '1000000000000000000000000000000000000');
  assert.equal(result.targets[0].steady_production_seconds_exact.denominator, '1');
});

test('tiny construction quantities retain material supply and marginal costs in original units', () => {
  const recipe = dataset.recipes[0];
  const model = compileConstructionOrder([{recipe, configuration: recipe.configurations[0]}], dataset.resources,
    {construction: {external: [{resource: 'ore', cost: 2}], materials: 1, work: 1}}, [{resource: 'part', amount: 1e-12}]);
  const result = solveConstructionOrder(highs, model, 5);
  assert.equal(result.status, 'feasible');
  assert.equal(result.optimal, false);
  close(result.construction.routes[0].operations, 1e-12);
  close(result.construction.requirements[0].amount, 1e-12);
  close(result.construction.external[0].amount, 1e-12);
  close(result.marginal_costs.part, 3);
});
