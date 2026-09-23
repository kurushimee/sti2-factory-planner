import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {readDataset} from './read_dataset.mjs';
import {solveFactory} from '../kernel/planner.js';

const dataset = await readDataset(process.argv[2] ?? 'data/statech-2.0.1.json.gz');
const farms = dataset.recipes.filter(recipe => recipe.type === 'spectrum:crystallarieum_growing');
assert.equal(new Set(farms.map(recipe => recipe.source_id)).size, 20);
assert.equal(farms.length, 60);
assert.equal(dataset.unsupported_entries.filter(entry => entry.type === 'spectrum:crystallarieum_growing').length, 0);
assert.equal(dataset.machines.find(machine => machine.id === 'spectrum:crystallarieum_turtle_farm').status, 'unsupported');
assert.ok(!dataset.default_machines.includes('spectrum:crystallarieum_turtle_farm'));
for (const farm of farms) {
  assert.equal(farm.expected_yields, true);
  assert.deepEqual(farm.yield_range, [3, 5]);
  assert.equal(farm.outputs[0].amount, 4);
  assert.deepEqual(farm.configurations, []);
  assert.match(farm.unsupported, /no source-derived cycle time/);
  assert.ok(farm.assumptions.some(value => value.includes('excluding harvesting and restart')));
}

const iron = farms.find(recipe => recipe.source_id === 'spectrum:crystallarieum/minecraft/iron'
  && recipe.id.endsWith('|additive:0'));
assert.ok(iron);
assert.deepEqual(iron.inputs, [
  {resource: 'item:minecraft:raw_iron', amount: 1},
  {resource: 'item:minecraft:iron_nugget', amount: 6},
  {resource: 'ink:spectrum:brown', amount: 240},
]);
assert.ok(iron.assumptions.some(value => value.includes('600 ticks')));
const picker = dataset.recipes.find(recipe => recipe.source_id === 'spectrum:ink_converting/dye/brown');
assert.ok(picker.configurations[0].build_requirements.some(flow => flow.resource === 'item:spectrum:ink_node'));

const highs = await loadHighs();
assert.throws(() => solveFactory(highs, dataset, {
  goals: [{recipe: iron.id, resource: iron.primary, rate: 0.125}],
  available_machines: ['spectrum:crystallarieum_turtle_farm', 'spectrum:color_picker'],
  external: [{resource: 'item:minecraft:raw_iron'}, {resource: 'item:minecraft:iron_nugget'},
    {resource: 'item:minecraft:brown_dye'}],
}), /Goal recipe is unavailable:.*no source-derived cycle time/);
console.log('The 60 loaded growth variants retain exact recipe facts without assigning a trial-derived farm rate.');
