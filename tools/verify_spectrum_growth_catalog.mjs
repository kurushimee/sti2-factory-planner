import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import loadHighs from 'highs';
import {readDataset} from './read_dataset.mjs';
import {solveFactory} from '../kernel/planner.js';

const dataset = await readDataset(process.argv[2] ?? 'data/statech-2.0.1.json.gz');
const farms = dataset.recipes.filter(recipe => recipe.type === 'spectrum:crystallarieum_growing');
assert.equal(new Set(farms.map(recipe => recipe.source_id)).size, 20);
assert.equal(farms.length, 60);
assert.equal(dataset.unsupported_entries.filter(entry => entry.type === 'spectrum:crystallarieum_growing').length, 0);
for (const farm of farms) {
  assert.equal(farm.expected_yields, true);
  assert.deepEqual(farm.yield_range, [3, 5]);
  assert.equal(farm.outputs[0].amount, 4);
  assert.equal(farm.configurations[0].machine, 'spectrum:crystallarieum_turtle_farm');
  assert.equal(farm.configurations[0].startup_inputs[0].amount, 1000);
}

const iron = farms.find(recipe => recipe.source_id === 'spectrum:crystallarieum/minecraft/iron'
  && recipe.id.endsWith('|additive:0'));
assert.ok(iron);
assert.deepEqual(iron.inputs, [
  {resource: 'item:minecraft:raw_iron', amount: 1},
  {resource: 'item:minecraft:iron_nugget', amount: 6},
  {resource: 'ink:spectrum:brown', amount: 240},
]);
assert.equal(iron.configurations[0].capacity.ticks_per_batch, 640);
const picker = dataset.recipes.find(recipe => recipe.source_id === 'spectrum:ink_converting/dye/brown');
assert.ok(picker.configurations[0].build_requirements.some(flow => flow.resource === 'item:spectrum:ink_node'));

const highs = await loadHighs();
const request = {
  goals: [{recipe: iron.id, resource: iron.primary, rate: 0.125}],
  replication: false,
  available_machines: ['spectrum:crystallarieum_turtle_farm', 'spectrum:color_picker'],
  external: [
    {resource: 'item:minecraft:raw_iron'},
    {resource: 'item:minecraft:iron_nugget'},
    {resource: 'item:minecraft:brown_dye'},
  ],
  time_limit_ms: 30000,
};
const result = solveFactory(highs, dataset, request);
assert.equal(result.status, 'optimal');
assert.equal(result.lines.length, 2);
const line = result.lines.find(value => value.recipe === iron.id);
assert.equal(line.machines, 1);
const rate = resource => result.external.find(value => value.resource === resource)?.rate;
assert.equal(rate('item:minecraft:raw_iron'), 0.03125);
assert.equal(rate('item:minecraft:iron_nugget'), 0.1875);
assert.equal(rate('item:minecraft:brown_dye'), 1.5);
const bill = resource => result.startup.build_requirements.find(value => value.resource === resource)?.amount;
assert.equal(bill('item:spectrum:crystallarieum'), 1);
assert.equal(bill('item:computercraft:turtle_normal'), 1);
assert.equal(bill('item:minecraft:diamond_pickaxe'), 1);
assert.equal(bill('item:spectrum:color_picker'), 1);
assert.equal(bill('item:spectrum:ink_node'), 2);
assert.equal(bill('item:minecraft:hopper'), 2);
assert.equal(bill('item:minecraft:chest'), 4);
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify({request, result}));
console.log('All loaded growth variants and the replicatorless iron support balance passed.');
