import test from 'node:test';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {compileConstructionOrder, solveConstructionOrder} from './construction_order.js';

const highs = await loadHighs();
const flow = (resource, amount = 1) => ({resource, amount});
const resources = ['ore', 'case', 'coil', 'full', 'empty', 'unavailable', 'item:tool'].map(id => ({id}));
const line = (id, inputs, outputs, extra = {}) => ({recipe: {id, inputs, outputs, ...extra},
  configuration: {id, operations_per_second: 1}});
const solve = (lines, quantities, construction = {}) => solveConstructionOrder(highs,
  compileConstructionOrder(lines, resources, {construction: {external: [{resource: 'ore'}], ...construction}}, quantities));

test('a construction order shares byproducts without buying every available workstation', () => {
  const result = solve([line('joint', [flow('ore', 4)], [flow('case'), flow('coil')]),
    line('case', [flow('ore', 3)], [flow('case')]), line('coil', [flow('ore', 3)], [flow('coil')])], [flow('case', 2), flow('coil', 2)]);
  assert.equal(result.status, 'optimal');
  assert.deepEqual(result.construction.requirements, [flow('case', 2), flow('coil', 2)]);
  assert.equal(result.construction.routes.length, 1);
  assert.equal(result.construction.routes[0].recipe, 'joint');
  assert.equal(result.construction.external[0].amount, 8);
});

test('construction orders preserve chosen alternatives, returned containers, and finite supplies', () => {
  const routes = [line('container', [{choices: ['full', 'ore'], amount: 1, returns: {full: [flow('empty')]}}], [flow('case')])];
  const settings = {external: [{resource: 'full', quantity: 2}]};
  const result = solve(routes, [flow('case', 2), flow('empty', 2)], settings);
  assert.equal(result.status, 'optimal');
  assert.equal(result.construction.external[0].amount, 2);
  assert.equal(solve(routes, [flow('case', 3)], settings).status, 'infeasible');
  assert.equal(solve(routes, [flow('unavailable')], settings).status, 'infeasible');
});

test('whole construction orders buy enough consumable tools and retain batch sizes', () => {
  const route = line('tool_work', [flow('item:tool', 0.1)], [flow('case')],
    {tool_usage: {resource: 'item:tool', crafts_per_tool: 10}});
  route.configuration.setup = {batch: 4};
  const result = solve([route], [flow('case', 11)], {round_batches: true, external: [{resource: 'item:tool'}]});
  assert.equal(result.status, 'optimal');
  assert.equal(result.construction.routes[0].operations, 12);
  assert.equal(result.construction.external[0].amount, 2);
  assert.equal(result.construction.tools[0].remaining_crafts, 8);
});

test('an unproductive construction cycle cannot fill a new order', () => {
  const result = solve([line('a', [flow('coil')], [flow('case')]), line('b', [flow('case')], [flow('coil')])], [flow('case')]);
  assert.equal(result.status, 'infeasible');
  assert.equal(result.construction, null);
  assert.throws(() => compileConstructionOrder([], resources, {construction: {}}, [flow('case', -1)]), /amount/);
});

test('construction energy is supplied by the selected generation routes', () => {
  const generator = line('generator', [flow('ore')], [flow('energy:eu', 100)]);
  const bench = line('electric_bench', [], [flow('case')]);
  bench.configuration.eu_per_operation = 25;
  const model = compileConstructionOrder([generator, bench], [...resources, {id: 'energy:eu'}],
    {construction: {external: [{resource: 'ore', quantity: 1}]}}, [flow('case', 4)]);
  const result = solveConstructionOrder(highs, model);
  assert.equal(result.status, 'optimal');
  assert.equal(result.construction.external[0].amount, 1);
  assert.equal(result.construction.routes.find(route => route.recipe === 'generator').operations, 1);
  assert.equal(result.construction.balances.find(row => row.resource === 'energy:eu').surplus, 0);
});

test('construction pruning retains a slower workstation when it saves energy', () => {
  const fast = line('make_case', [], [flow('case')]);
  fast.configuration = {...fast.configuration, id: 'fast', operations_per_second: 10, eu_per_operation: 100};
  const slow = {...fast, configuration: {...fast.configuration, id: 'slow', operations_per_second: 1, eu_per_operation: 1}};
  const wasteful = {...fast, configuration: {...fast.configuration, id: 'wasteful', operations_per_second: 5, eu_per_operation: 200}};
  const model = compileConstructionOrder([fast, slow, wasteful], [...resources, {id: 'energy:eu'}],
    {construction: {external: [{resource: 'energy:eu', quantity: 1}]}}, [flow('case')]);
  assert.deepEqual(model.construction.routes.map(route => route.configuration), ['fast', 'slow']);
  const result = solveConstructionOrder(highs, model);
  assert.equal(result.status, 'optimal');
  assert.equal(result.construction.routes[0].configuration, 'slow');
});

test('continuous construction marginal costs include complete material routes', () => {
  const result = solve([line('case', [flow('ore', 3)], [flow('case')])], [flow('case', 2)]);
  assert.equal(result.marginal_costs.case, 3001);
  assert.equal(result.marginal_costs.ore, 1000);
  const rounded = solve([line('case', [flow('ore', 3)], [flow('case')])], [flow('case', 2)], {round_batches: true});
  assert.equal(rounded.marginal_costs, undefined);
});
