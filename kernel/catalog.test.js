import test from 'node:test';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {configureRecipe, prepareDataset} from './catalog.js';
import {solveFactory} from './planner.js';

const machine = {id: 'press', status: 'supported', mechanic: 'mi_crafter', recipe_type: 'press', base_eu: 8, max_eu: 32,
  upgrades: ['upgrade'], upgrade_limit: 3};
const recipe = {id: 'plate', primary: 'plate', inputs: [{resource: 'ingot', amount: 1}], outputs: [{resource: 'plate', amount: 2}],
  configurations: [], process: {type: 'press', duration_ticks: 40, eu_per_tick: 8}};
const dataset = {format: 1, resources: ['plate', 'ingot', 'energy:eu'].map(id => ({id})), recipes: [recipe], machines: [machine],
  upgrades: [{id: 'upgrade', extra_max_eu: 16}]};

test('catalogs compile available loadouts and keep steam and power dependencies', async () => {
  const plain = configureRecipe(recipe, dataset, {});
  assert.equal(plain.configurations.length, 1);
  assert.equal(plain.configurations[0].operations_per_second, 2);
  const upgraded = configureRecipe(recipe, dataset, {available_upgrades: ['upgrade']});
  assert.equal(upgraded.configurations.length, 4);
  assert.equal(Math.max(...upgraded.configurations.map(value => value.operations_per_second)), 5);
  const result = solveFactory(await loadHighs(), dataset, {goals: [{resource: 'plate', rate: 4}], external: [{resource: 'ingot'}, {resource: 'energy:eu'}]});
  assert.equal(result.status, 'optimal');
  assert.equal(result.lines[0].machines, 1);
  assert.equal(result.external.find(value => value.resource === 'ingot').rate, 2);
  assert.equal(result.power.consumption_eu_per_tick, 32);
});

test('dependency closure includes useful coproduct suppliers without including disconnected recipes', () => {
  const coproduct = {...recipe, id: 'coproduct', primary: 'other', outputs: [{resource: 'other', amount: 1}, {resource: 'ingot', amount: 1}], inputs: []};
  const disconnected = {...recipe, id: 'unrelated', primary: 'unrelated', outputs: [{resource: 'unrelated', amount: 1}]};
  const prepared = prepareDataset({...dataset, recipes: [recipe, coproduct, disconnected]}, {goals: [{resource: 'plate', rate: 1}]});
  assert.deepEqual(prepared.recipes.map(value => value.id), ['plate', 'coproduct']);
});

test('limited cheap configurations do not prune the more expensive machines needed for capacity', () => {
  const second = {...machine, id: 'second', build_cost: 2};
  const all = {...dataset, machines: [machine, second]};
  assert.equal(configureRecipe(recipe, all, {}).configurations.length, 1);
  const firstId = configureRecipe(recipe, all, {}).configurations[0].id;
  assert.equal(configureRecipe(recipe, all, {limits: {[firstId]: 1}}).configurations.length, 2);
  assert.equal(configureRecipe(recipe, all, {configurations: {plate: 'plate|second|none:0|batch:1|:0|shape:0|steel:false|'}}).configurations.length, 2);
});

test('unverified conditions and unresolved catalyst choices remain explicit exclusions', () => {
  assert.match(configureRecipe({...recipe, conditions: [{type: 'unknown'}]}, dataset).unsupported, /condition adapter/);
  assert.match(configureRecipe({...recipe, catalysts: [{choices: ['a', 'b'], amount: 1}]}, dataset).unsupported, /reusable ingredient/);
  const chosen = configureRecipe({...recipe, catalysts: [{choices: ['a', 'b'], amount: 1}]}, dataset, {catalysts: {'plate#0': 'b'}});
  assert.deepEqual(chosen.configurations[0].startup_inputs, [{resource: 'b', amount: 1}]);
});
