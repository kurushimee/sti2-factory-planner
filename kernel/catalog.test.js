import test from 'node:test';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {configureRecipe, prepareDataset} from './catalog.js';
import {solveFactory} from './planner.js';
import {compileConfiguration} from './configuration.js';

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

test('complete capacity targets compile their explicit array loadouts without enumerating others', () => {
  const array = {...machine, id: 'array', mechanic: 'mi_array', shape_capacities: [8, 16, 32, 64],
    eligible_machines: ['press'], contained_recipe_types: {press: 'press'}, energy_multiplier: 1};
  const setup = {contained_machine: 'press', contained_count: 16, batch: 16, shape: 1};
  const configuration = compileConfiguration({...recipe, ...recipe.process}, array, setup);
  const configured = configureRecipe(recipe, {...dataset, machines: [machine, array]}, {
    goals: [{recipe: recipe.id, kind: 'capacity', configuration: configuration.id, machines: 2}],
    machine_setups: {[recipe.id]: [{machine: 'array', setup}]}, available_upgrades: ['upgrade'],
  });
  assert.equal(configured.configurations.length, 1);
  assert.equal(configured.configurations[0].id, configuration.id);
});

test('automatic array search removes oversized contents while explicit installed setups remain available', () => {
  const array = {...machine, id: 'array', mechanic: 'mi_array', shape_capacities: [8, 16, 32, 64], energy_multiplier: 0.75,
    eligible_machines: ['press'], contained_recipe_types: {press: 'press'}};
  const data = {...dataset, machines: [array]};
  let compactCount = 0, fullCount = 0;
  const compact = configureRecipe(recipe, data, {}, false, () => compactCount++);
  const full = configureRecipe(recipe, data, {limits: {[`${recipe.id}|unused`]: 0}}, false, () => fullCount++);
  assert.equal(compactCount, 64);
  assert.equal(fullCount, 2080);
  for (const candidate of full.configurations) {
    assert.ok(compact.configurations.some(value => value.operations_per_second === candidate.operations_per_second &&
      value.eu_per_operation === candidate.eu_per_operation && value.build_cost <= candidate.build_cost));
  }
  const setup = {contained_machine: 'press', contained_count: 16, batch: 1, shape: 1};
  const id = compileConfiguration({...recipe, ...recipe.process}, array, setup).id;
  const explicit = configureRecipe(recipe, data, {machine_setups: {[recipe.id]: [{machine: array.id, setup}]}});
  assert.ok(explicit.configurations.some(value => value.id === id));
});

test('configuration preparation observes the calculation budget inside loadout enumeration', async () => {
  const start = performance.now();
  const result = solveFactory(await loadHighs(), dataset, {goals: [{resource: 'plate', rate: 1}], time_limit_ms: 0});
  assert.equal(result.status, 'limit');
  assert.equal(result.phase, 'configuration');
  assert.equal(result.optimal, false);
  assert.ok(performance.now() - start < 1000);
});

test('upgrade dominance and one-tick saturation preserve the full cost-capacity frontier', () => {
  const fast = {id: 'fast', extra_max_eu: 1000000, build_cost: 1};
  const data = {...dataset, upgrades: [...dataset.upgrades, fast], machines: [{...machine, upgrades: ['upgrade', 'fast'], upgrade_limit: 64}]};
  const request = {available_upgrades: ['upgrade', 'fast']};
  let count = 0;
  const compact = configureRecipe(recipe, data, request, false, () => count++);
  assert.equal(count, 2);
  const full = configureRecipe(recipe, data, {...request, limits: {[`${recipe.id}|unused`]: 0}});
  const frontier = result => result.configurations.map(value => [value.operations_per_second, value.eu_per_operation, value.build_cost]);
  assert.deepEqual(frontier(compact), frontier(full));
  const expensive = {...data, upgrades: [dataset.upgrades[0], {...fast, build_cost: 10}]};
  const choices = configureRecipe(recipe, expensive, request).configurations;
  assert.ok(choices.some(value => value.setup.upgrade?.id === 'upgrade'));
  assert.ok(choices.some(value => value.setup.upgrade?.id === 'fast'));
  const setup = {upgrade: dataset.upgrades[0], upgrade_count: 2};
  const pinned = configureRecipe(recipe, data, {...request, machine_setups: {[recipe.id]: [{machine: machine.id, setup}]}});
  assert.ok(pinned.configurations.some(value => value.setup.upgrade?.id === 'upgrade' && value.setup.upgrade_count === 2));
});

test('capacity caching cannot transfer results between datasets with different machine rules', () => {
  const request = {goals: [{resource: 'plate', rate: 2}]};
  const original = prepareDataset(dataset, request).recipes[0].configurations[0];
  const changed = prepareDataset({...dataset, machines: [{...machine, max_eu: 64}]}, request).recipes[0].configurations[0];
  assert.equal(original.operations_per_second, 2);
  assert.equal(changed.operations_per_second, 4);
});
