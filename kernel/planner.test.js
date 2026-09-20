import test from 'node:test';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {solveFactory} from './planner.js';

const highs = await loadHighs();
const flow = (resource, amount) => ({resource, amount});
function recipe(id, primary, inputs, outputs, capacity = 10, energy = 0) {
  return {id, primary, inputs, outputs, configurations: [{id: `${id}:standard`, machine: id, operations_per_second: capacity, eu_per_operation: energy}]};
}
function dataset(resources, recipes) {
  return {format: 1, resources: resources.map(id => ({id})), recipes};
}
function line(result, id) { return result.lines.find(entry => entry.recipe === id); }
function supply(result, id) { return result.external.find(entry => entry.resource === id)?.rate ?? 0; }
function close(actual, expected) { assert(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`); }

test('shared and independent intermediate goals retain their combined demand', () => {
  const data = dataset(['ore', 'plate', 'gear', 'wire'], [
    recipe('smelt', 'plate', [flow('ore', 1)], [flow('plate', 1)], 4),
    recipe('gear', 'gear', [flow('plate', 2)], [flow('gear', 1)]),
    recipe('wire', 'wire', [flow('plate', 1)], [flow('wire', 2)]),
  ]);
  const result = solveFactory(highs, data, {goals: [{resource: 'gear', rate: 3}, {resource: 'wire', rate: 4}, {resource: 'plate', rate: 1}], external: [{resource: 'ore'}]});
  assert.equal(result.status, 'optimal');
  close(line(result, 'smelt').operations_per_second, 9);
  assert.equal(line(result, 'smelt').machines, 3);
  close(supply(result, 'ore'), 9);
});

test('byproducts and returned containers are credited across the plan', () => {
  const data = dataset(['ore', 'copper', 'nickel', 'can', 'filled'], [
    recipe('separate', 'copper', [flow('ore', 1)], [flow('copper', 2), flow('nickel', 1)]),
    recipe('fill', 'filled', [flow('copper', 1), flow('can', 1)], [flow('filled', 1)]),
    recipe('empty', 'nickel', [flow('filled', 1)], [flow('can', 1), flow('nickel', 1)]),
  ]);
  const result = solveFactory(highs, data, {goals: [{resource: 'nickel', rate: 3}], external: [{resource: 'ore'}], single_primary_route: false});
  assert.equal(result.status, 'optimal');
  close(supply(result, 'ore'), 1);
  close(line(result, 'fill').operations_per_second, 2);
  close(line(result, 'empty').operations_per_second, 2);
});

test('a lossless recycling loop cannot create requested output', () => {
  const data = dataset(['a', 'b'], [recipe('ab', 'b', [flow('a', 1)], [flow('b', 1)]), recipe('ba', 'a', [flow('b', 1)], [flow('a', 1)])]);
  assert.equal(solveFactory(highs, data, {goals: [{resource: 'a', rate: 1}]}).status, 'infeasible');
});

test('generation includes the fuel chain power feedback and infrastructure', () => {
  const data = dataset(['raw', 'fuel', 'product', 'energy:eu'], [
    recipe('refine', 'fuel', [flow('raw', 1)], [flow('fuel', 1)], 10, 20),
    recipe('generate', 'energy:eu', [flow('fuel', 1)], [flow('energy:eu', 100)], 10),
    recipe('produce', 'product', [], [flow('product', 1)], 10, 40),
  ]);
  const result = solveFactory(highs, data, {goals: [{resource: 'product', rate: 2}], external: [{resource: 'raw'}], overhead_eu_per_tick: 1});
  assert.equal(result.status, 'optimal');
  close(line(result, 'generate').operations_per_second, 1.25);
  close(supply(result, 'raw'), 1.25);
  close(result.connections.filter(connection => connection.resource === 'energy:eu').reduce((sum, connection) => sum + connection.rate, 0), 125);
  assert(result.connections.some(connection => connection.source === 'generate|generate:standard' && connection.destination === 'refine|refine:standard'));
  assert(result.connections.some(connection => connection.destination === 'goal:energy:eu' && connection.rate === 20));
});

test('replication is excluded and unavailable pins explain the conflict', () => {
  const data = dataset(['ore', 'part'], [recipe('normal', 'part', [flow('ore', 2)], [flow('part', 1)]), {...recipe('replicate', 'part', [flow('ore', 1)], [flow('part', 1)]), replication: true}]);
  const request = {goals: [{resource: 'part', rate: 1}], external: [{resource: 'ore'}]};
  close(supply(solveFactory(highs, data, request), 'ore'), 2);
  close(supply(solveFactory(highs, data, {...request, replication: true}), 'ore'), 1);
  assert.throws(() => solveFactory(highs, data, {...request, routes: {part: 'replicate'}}), /Pinned route is unavailable/);
});

test('one primary route is enforced without suppressing byproduct supplies', () => {
  const data = dataset(['raw', 'a', 'b', 'c'], [
    recipe('route_b', 'a', [flow('raw', 1)], [flow('a', 1), flow('b', 1)]),
    recipe('route_c', 'a', [flow('raw', 1)], [flow('a', 1), flow('c', 1)]),
    recipe('make_b', 'b', [flow('raw', 5)], [flow('b', 1)]),
    recipe('make_c', 'c', [flow('raw', 5)], [flow('c', 1)]),
  ]);
  const request = {goals: [{resource: 'b', rate: 1}, {resource: 'c', rate: 1}], external: [{resource: 'raw'}]};
  const mixed = solveFactory(highs, data, {...request, single_primary_route: false});
  close(supply(mixed, 'raw'), 2);
  const single = solveFactory(highs, data, request);
  assert.equal(single.status, 'optimal');
  close(supply(single, 'raw'), 6);
  assert(single.branches > 1);
  assert.equal(single.lines.filter(entry => entry.primary === 'a' && entry.operations_per_second > 0).length, 1);
});

test('installed limits cannot be hidden by fractional machines', () => {
  const data = dataset(['ore', 'part'], [recipe('make', 'part', [flow('ore', 1)], [flow('part', 1)], 3)]);
  const request = {goals: [{resource: 'part', rate: 4}], external: [{resource: 'ore'}]};
  assert.equal(line(solveFactory(highs, data, request), 'make').machines, 2);
  assert.equal(solveFactory(highs, data, {...request, limits: {'make:standard': 1}}).status, 'infeasible');
});

test('unsupported mechanics do not turn dependencies into free supplies', () => {
  const data = dataset(['part'], [{...recipe('unknown', 'part', [], [flow('part', 1)]), unsupported: 'The source has not been verified.'}]);
  const result = solveFactory(highs, data, {goals: [{resource: 'part', rate: 1}]});
  assert.equal(result.status, 'infeasible');
  assert.equal(result.exclusions.length, 1);
});

test('a time limit is reported without claiming an optimum', () => {
  const result = solveFactory(highs, dataset(['part'], []), {goals: [{resource: 'part', rate: 1}], time_limit_ms: 0});
  assert.equal(result.status, 'limit');
  assert.equal(result.optimal, false);
});

test('large finite rates still require the final whole machine', () => {
  const data = dataset(['ore', 'part'], [recipe('make', 'part', [flow('ore', 1)], [flow('part', 1)], 10)]);
  const result = solveFactory(highs, data, {goals: [{resource: 'part', rate: 1000000000001}], external: [{resource: 'ore'}]});
  assert.equal(result.status, 'optimal');
  assert.equal(line(result, 'make').machines, 100000000001);
  assert.equal(supply(result, 'ore'), 1000000000001);
});

test('ingredient alternatives are optimized across shared demand and can be pinned', () => {
  const data = dataset(['iron', 'copper', 'machine', 'wire'], [
    recipe('build', 'machine', [{choices: ['iron', 'copper'], amount: 2}], [flow('machine', 1)]),
    recipe('wire', 'wire', [flow('copper', 1)], [flow('wire', 1)]),
  ]);
  const request = {goals: [{resource: 'machine', rate: 2}, {resource: 'wire', rate: 1}],
    external: [{resource: 'iron', cost: 2}, {resource: 'copper', cost: 1, limit: 3}]};
  const result = solveFactory(highs, data, request);
  close(supply(result, 'iron'), 2);
  close(supply(result, 'copper'), 3);
  close(line(result, 'build').inputs.reduce((sum, flow) => sum + flow.rate, 0), 4);
  const pinned = solveFactory(highs, data, {...request, ingredients: {'build#0': 'iron'}});
  close(supply(pinned, 'iron'), 4);
  close(supply(pinned, 'copper'), 1);
  assert.throws(() => solveFactory(highs, data, {...request, ingredients: {'build#0': 'wood'}}), /pinned ingredient/);
});

test('resource and recipe names cannot inherit route or configuration pins', () => {
  const data = dataset(['ore', 'toString'], [recipe('constructor', 'toString', [flow('ore', 1)], [flow('toString', 1)])]);
  const result = solveFactory(highs, data, {goals: [{resource: 'toString', rate: 1}], external: [{resource: 'ore'}]});
  assert.equal(result.status, 'optimal');
});
test('mixed generation and idle reserve include support power without burning reserve fuel', () => {
  const data = dataset(['ore', 'fuel', 'part', 'energy:eu'], [
    recipe('fuel', 'fuel', [flow('ore', 1)], [flow('fuel', 1)], 10, 20),
    recipe('generator_a', 'energy:eu', [flow('fuel', 1)], [flow('energy:eu', 100)], 1),
    recipe('generator_b', 'energy:eu', [flow('fuel', 1)], [flow('energy:eu', 100)], 1),
    recipe('make', 'part', [], [flow('part', 1)], 10, 120),
  ]);
  const result = solveFactory(highs, data, {goals: [{resource: 'part', rate: 1}], external: [{resource: 'ore'}],
    reserve_fraction: 0.5, limits: {'generator_a:standard': 1}, dispatch: {'generator_a:standard': {minimum: 1}}});
  assert.equal(result.status, 'optimal');
  close(line(result, 'generator_a').operations_per_second, 1);
  close(line(result, 'generator_b').operations_per_second, 0.5);
  close(supply(result, 'ore'), 1.5);
  close(result.power.gross_generation_eu_per_tick, 7.5);
  close(result.power.consumption_eu_per_tick, 7.5);
  close(result.power.installed_generation_eu_per_tick, 15);
  assert.equal(line(result, 'generator_b').machines, 2);
});
