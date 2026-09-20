import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {solveFactory} from '../kernel/planner.js';
import {inspectWorld} from '../kernel/world.js';

const path = process.argv[2];
if (!path) throw new Error('Provide the compiled StaTech catalog path.');
const dataset = JSON.parse(await readFile(path, 'utf8'));
const recipe = dataset.recipes.find(value => value.source_id === 'statech:modern_industrialization/macerator/copper_dust_from_copper_cluster');
assert.deepEqual(recipe.process, {duration_ticks: 200, eu_per_tick: 2, type: 'modern_industrialization:macerator'});
assert.equal(recipe.outputs[0].amount, 6);
const highs = await loadHighs();
const before = performance.now();
const result = solveFactory(highs, dataset, {
  goals: [{recipe: recipe.id, resource: 'item:modern_industrialization:copper_dust', rate: 12}],
  available_machines: ['modern_industrialization:electric_macerator'],
  routes: {'item:modern_industrialization:copper_dust': recipe.id},
  external: [{resource: 'item:spectrum:copper_cluster'}, {resource: 'energy:eu'}],
});
assert.equal(result.status, 'optimal');
assert.equal(result.lines.length, 1);
assert.equal(result.lines[0].machines, 2);
assert.equal(result.lines[0].capacity_per_second, 40 / 13);
assert.equal(result.lines[0].operations_per_second, 2);
assert.equal(result.power.consumption_eu_per_tick, 40);
assert.equal(result.external.find(value => value.resource === 'item:spectrum:copper_cluster').rate, 2);
assert.equal(result.startup.incomplete.length, 0);
console.log(JSON.stringify({case: 'Captured copper-cluster maceration', machines: 2, output_per_second: 12,
  consumption_eu_per_tick: 40, elapsed_ms: Math.round(performance.now() - before)}));

const cake = dataset.recipes.find(value => value.source_id === 'minecraft:cake');
const crafted = solveFactory(highs, dataset, {goals: [{recipe: cake.id, resource: 'item:minecraft:cake', rate: 2}],
  routes: {'item:minecraft:cake': cake.id}, available_machines: ['ae2:molecular_assembler'],
  external: ['milk_bucket', 'sugar', 'egg', 'wheat'].map(id => ({resource: `item:minecraft:${id}`})).concat([{resource: 'energy:eu'}])});
assert.equal(crafted.status, 'optimal');
assert.equal(crafted.lines.find(line => line.recipe === cake.id).machines, 1);
assert.equal(crafted.lines.find(line => line.recipe === cake.id).outputs.find(flow => flow.resource === 'item:minecraft:bucket').rate, 6);
assert.equal(crafted.power.consumption_eu_per_tick, 2);
console.log('Captured cake crafting returns six buckets per second at two cakes per second.');

if (process.argv[3]) {
  const imported = inspectWorld(new Uint8Array(await readFile(process.argv[3])), dataset);
  assert.equal(imported.reconstruction.goals.length, 1);
  assert.equal(imported.reconstruction.unresolved.length, 3);
  assert.equal(imported.reconstruction.goals[0].machines, 1);
  assert.equal(imported.reconstruction.stock_targets[0].stock_target, '4096');
  assert.equal(imported.machines.find(value => value.origin.x === 0).provider_candidates.length, 1);
  const reconstructed = solveFactory(highs, dataset, {goals: imported.reconstruction.goals,
    machine_setups: imported.reconstruction.machine_setups, available_machines: ['modern_industrialization:electric_macerator'],
    external: [{resource: 'item:spectrum:copper_cluster'}, {resource: 'energy:eu'}]});
  assert.equal(reconstructed.status, 'optimal');
  assert.equal(reconstructed.lines.length, 1);
  assert.equal(reconstructed.lines[0].machines, 1);
  assert.equal(reconstructed.lines[0].configuration_details.setup.upgrade_count, 8);
  assert.equal(reconstructed.targets[0].rate, 40);
  console.log('The real saved macerator reconstructs a 40-dust/s capacity goal with its eight advanced upgrades. Three unassigned machines remain visible for correction.');
}
