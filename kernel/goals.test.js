import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveGoals} from './goals.js';

const dataset = {recipes: [{id: 'cut', primary: 'plate', outputs: [{resource: 'plate', amount: 3}],
  configurations: [{id: 'saw', operations_per_second: 2}]}]};

test('capacity goals count recipe outputs rather than treating operations as items', () => {
  const original = {goals: [{kind: 'capacity', recipe: 'cut', configuration: 'saw', resource: 'plate', machines: 4}]};
  const {request} = resolveGoals(dataset, original);
  assert.equal(request.goals[0].rate, 24);
  assert.equal(request.routes.plate, 'cut');
  assert.equal(request.configurations.cut, 'saw');
  assert.equal(original.goals[0].rate, undefined);
});

test('finite quantities retain their rate and label the time assumption', () => {
  const result = resolveGoals(dataset, {goals: [{kind: 'quantity', resource: 'plate', rate: 10, quantity: 1e12}]});
  assert.equal(result.targets[0].steady_production_seconds, 1e11);
  assert.match(result.targets[0].time_basis, /After startup/);
});

test('conflicting goal routes and unavailable capacity setups fail explicitly', () => {
  assert.throws(() => resolveGoals(dataset, {routes: {plate: 'other'}, goals: [{recipe: 'cut', resource: 'plate', rate: 1}]}), /Conflicting/);
  assert.throws(() => resolveGoals(dataset, {goals: [{kind: 'capacity', recipe: 'cut', resource: 'plate', configuration: 'absent', machines: 1}]}), /unavailable/);
  assert.throws(() => resolveGoals(dataset, {goals: [{kind: 'quantity', resource: 'plate', rate: 0, quantity: 20}]}), /positive/);
});
test('goal selections preserve prototype-like resource and recipe names', () => {
  const data = {recipes: [{id: '__proto__', primary: '__proto__', outputs: [{resource: '__proto__', amount: 1}], configurations: [{id: 'setup', operations_per_second: 1}]}]};
  const result = resolveGoals(data, {goals: [{kind: 'capacity', recipe: '__proto__', resource: '__proto__', configuration: 'setup', machines: 1}]});
  assert.equal(result.request.routes.__proto__, '__proto__');
  assert.equal(result.request.configurations.__proto__, 'setup');
});
test('independent goals for coproducts share the same recipe operations', () => {
  const data = {recipes: [{id: 'separate', primary: 'a', outputs: [{resource: 'a', amount: 2}, {resource: 'b', amount: 3}], configurations: []}]};
  const result = resolveGoals(data, {goals: [{recipe: 'separate', resource: 'a', rate: 4}, {recipe: 'separate', resource: 'b', rate: 6}]});
  assert.equal(result.request.recipe_minimum_rates.separate, 2);
});
