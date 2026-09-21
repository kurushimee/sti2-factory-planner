import test from 'node:test';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {findFactorySeed} from './seed.js';
import {compileFactory, decodeFactory} from './planner.js';
import {productionRouteOwnership} from './route_ownership.js';

const highs = await loadHighs();
const recipe = (id, cost, capacity) => ({id, primary: 'part', inputs: [{resource: 'ore', amount: cost}],
  outputs: [{resource: 'part', amount: 1}], configurations: [{id, machine: 'press', operations_per_second: capacity}]});
const dataset = {format: 1, resources: ['ore', 'part'].map(id => ({id})), recipes: [recipe('cheap', 1, 1), recipe('fast', 2, 10)]};

test('a relaxed seed repairs competing routes and verifies whole capacities in the original model', () => {
  const request = {goals: [{resource: 'part', rate: 3}], external: [{resource: 'ore'}], limits: {cheap: 1}};
  const model = compileFactory(dataset, request);
  const seed = findFactorySeed(highs, model, request, Date.now() + 5000);
  assert.ok(seed);
  const plan = decodeFactory(model, seed);
  assert.deepEqual(productionRouteOwnership(plan, request).conflict, []);
  assert.equal(plan.lines.length, 1);
  assert.equal(plan.lines[0].recipe, 'fast');
  assert.equal(plan.lines[0].machines, 1);
  assert.equal(plan.external.find(value => value.resource === 'ore').rate, 6);
  assert.ok(seed.lower_bound < seed.objective);
});

test('seed rounding preserves installed counts and respects machine limits', () => {
  const request = {goals: [{resource: 'part', rate: 2.1}], external: [{resource: 'ore'}], installed: {cheap: 3}, limits: {fast: 0}};
  const model = compileFactory(dataset, request);
  const seed = findFactorySeed(highs, model, request, Date.now() + 5000);
  assert.ok(seed);
  assert.equal(decodeFactory(model, seed).lines[0].machines, 3);
  assert.equal(findFactorySeed(highs, model, request, Date.now() - 1), null);
});
