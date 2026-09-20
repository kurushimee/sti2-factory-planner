import test from 'node:test';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {compileConfiguration} from './configuration.js';
import {solveFactory} from './planner.js';

test('steam power remains a fluid demand and upgrades have concrete build counts', async () => {
  const recipe = {id: 'press', primary: 'plate', inputs: [], outputs: [{resource: 'plate', amount: 2}], duration_ticks: 20, eu_per_tick: 2};
  const machine = {id: 'test:steam_press', mechanic: 'mi_crafter', base_eu: 2, max_eu: 2, energy_resource: 'fluid:steam'};
  const configuration = compileConfiguration(recipe, machine);
  assert.equal(configuration.eu_per_operation, 0);
  assert.deepEqual(configuration.inputs, [{resource: 'fluid:steam', amount: 40}]);
  const result = solveFactory(await loadHighs(), {format: 1, resources: [{id: 'plate'}, {id: 'fluid:steam'}], recipes: [{...recipe, configurations: [configuration]}]},
    {goals: [{resource: 'plate', rate: 4}], external: [{resource: 'fluid:steam'}]});
  assert.equal(result.status, 'optimal');
  assert.equal(result.lines[0].machines, 2);
  assert.equal(result.external[0].rate, 80);
  const electric = compileConfiguration(recipe, {...machine, id: 'test:electric_press', energy_resource: 'energy:eu', upgrade_limit: 64, upgrades: ['test:upgrade']},
    {upgrade: {id: 'test:upgrade', extra_max_eu: 16}, upgrade_count: 8});
  assert.deepEqual(electric.build_requirements, [{resource: 'item:test:electric_press', amount: 1}, {resource: 'item:test:upgrade', amount: 8}]);
});
test('coil limits, tower outputs, and steel hatch tiers constrain configurations', () => {
  const recipe = {id: 'process', duration_ticks: 100, eu_per_tick: 128, outputs: []};
  const machine = {id: 'test:blast_furnace', mechanic: 'mi_crafter', base_eu: 8, max_eu: 128, recipe_eu_limits: [32, 128, 1024]};
  assert.throws(() => compileConfiguration(recipe, machine), /coil tier/);
  assert.equal(compileConfiguration(recipe, machine, {shape: 1}).capacity.ticks_per_batch, 100);
  const tower = {...machine, recipe_eu_limits: undefined, fluid_output_limits: [1, 2]};
  const distill = {...recipe, outputs: [{resource: 'fluid:a'}, {resource: 'fluid:b'}]};
  assert.throws(() => compileConfiguration(distill, tower), /discard/);
  assert.equal(compileConfiguration(distill, tower, {shape: 1}).machine, machine.id);
  const steam = {id: 'test:quarry', mechanic: 'mi_crafter', base_eu: 2, max_eu: 2,
    steel_hatch_variant: {base_eu: 4, max_eu: 4}, energy_resource: 'fluid:steam'};
  const steelRecipe = {...recipe, eu_per_tick: 4};
  assert.throws(() => compileConfiguration(steelRecipe, steam), /voltage/);
  assert.equal(compileConfiguration(steelRecipe, steam, {steel_hatches: true}).capacity.ticks_per_batch, 100);
});
