import test from 'node:test';
import assert from 'node:assert/strict';
import {materialSignature, preferredRecipes, validatePreferences} from './recipe_preferences.js';
import {solveFactory} from './planner.js';
import loadHighs from 'highs';

const highs = await loadHighs();

const recipe = (id, input = 1, output = 1) => ({id, primary: 'part', inputs: [{resource: 'ore', amount: input}],
  outputs: [{resource: 'part', amount: output}], configurations: [{id, machine: id, operations_per_second: 1}]});
const dataset = {format: 1, resources: [{id: 'ore'}, {id: 'part'}], recipes: [recipe('craft'), recipe('assemble')],
  route_preferences: [{preferred: 'craft', alternative: 'assemble', reason: 'The material requirements match.'}]};

test('material equivalence accounts for output quantity and exact decimal sums', () => {
  const split = recipe('split', 0.1, 0.3);
  split.inputs.push({resource: 'ore', amount: 0.2});
  assert.equal(materialSignature(split), materialSignature(recipe('whole')));
  assert.equal(materialSignature(recipe('batch', 4, 4)), materialSignature(recipe('whole')));
  assert.notEqual(materialSignature(recipe('efficient', 1, 4)), materialSignature(recipe('whole')));
});

test('conditional, reusable, returned, and probabilistic materials are not silently equated', () => {
  for (const extra of [{conditions: [{type: 'biome'}]}, {catalysts: [{choices: ['tool'], amount: 1}]}, {expected_yields: true}, {tool_usage: {}}]) {
    assert.equal(materialSignature({...recipe('special'), ...extra}), null);
  }
  const returned = recipe('returned');
  returned.inputs[0].returns = {ore: [{resource: 'part', amount: 1}]};
  assert.equal(materialSignature(returned), null);
});

test('available unbounded preferences retain deliberate selections and limited alternatives', () => {
  assert.deepEqual(preferredRecipes(dataset, {}).dataset.recipes.map(recipe => recipe.id), ['craft']);
  for (const request of [{honor_route_preferences: false}, {goals: [{recipe: 'assemble'}]}, {routes: {part: 'assemble'}},
    {configurations: {assemble: 'assemble'}}, {machine_setups: {assemble: []}}, {disabled_machines: ['craft']},
    {disabled_recipes: ['craft']}, {limits: {craft: 1}}, {installed: {craft: 1}}, {dispatch: {craft: {maximum: 1}}},
    {installed: {assemble: 1}}, {limits: {assemble: 2}}, {dispatch: {assemble: {minimum: 1}}}]) {
    assert.equal(preferredRecipes(dataset, request).dataset.recipes.length, 2);
  }
  const unavailable = {...dataset, recipes: [{...dataset.recipes[0], unsupported: 'No available automation.'}, dataset.recipes[1]]};
  assert.equal(preferredRecipes(unavailable, {}).dataset.recipes.length, 2);
});

test('planning prefers equal-material automation despite a faster assembly machine', () => {
  const data = structuredClone(dataset);
  data.recipes[1].configurations[0].operations_per_second = 100;
  const request = {goals: [{resource: 'part', rate: 2}], external: [{resource: 'ore'}]};
  const result = solveFactory(highs, data, request);
  assert.equal(result.lines[0].recipe, 'craft');
  assert.equal(result.lines[0].machines, 2);
  assert.equal(result.recipe_preferences.fallback, false);
  assert.deepEqual(result.lines[0].route_preference.alternatives, ['assemble']);
  const pinned = solveFactory(highs, data, {...request, routes: {part: 'assemble'}});
  assert.equal(pinned.lines[0].recipe, 'assemble');
  const disabled = solveFactory(highs, data, {...request, disabled_machines: ['craft']});
  assert.equal(disabled.lines[0].recipe, 'assemble');
});

test('a genuinely material-saving industrial route remains available', () => {
  const data = {...dataset, recipes: [...dataset.recipes, recipe('efficient', 0.5)]};
  const result = solveFactory(highs, data, {goals: [{resource: 'part', rate: 2}], external: [{resource: 'ore'}]});
  assert.equal(result.lines[0].recipe, 'efficient');
  assert.equal(result.external[0].rate, 1);
});

test('insufficient power for the preferred route falls back without reporting an infeasible factory', () => {
  const data = structuredClone(dataset);
  data.resources.push({id: 'energy:eu'});
  data.recipes[0].configurations[0].eu_per_operation = 2;
  const result = solveFactory(highs, data, {goals: [{resource: 'part', rate: 1}], external: [{resource: 'ore'}]});
  assert.equal(result.lines[0].recipe, 'assemble');
  assert.equal(result.recipe_preferences.fallback, true);
});

test('invalid material claims, missing recipes, duplicate preferences, and cycles are rejected', () => {
  validatePreferences(dataset);
  for (const data of [
    {...dataset, recipes: [recipe('craft'), recipe('assemble', 2)]},
    {...dataset, recipes: [recipe('craft')]},
    {...dataset, route_preferences: [...dataset.route_preferences, ...dataset.route_preferences]},
    {...dataset, route_preferences: [...dataset.route_preferences, {preferred: 'assemble', alternative: 'craft', reason: 'Cycle.'}]},
  ]) assert.throws(() => validatePreferences(data), /preference|recipes/);
});
