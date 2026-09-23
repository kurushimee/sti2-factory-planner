import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {readDataset} from './read_dataset.mjs';
import {solveFactory} from '../kernel/planner.js';

const dataset = await readDataset(process.argv[2] ?? 'data/statech-2.0.1.json.gz');
const highs = await loadHighs();
for (const preset of dataset.progression) {
  if (!preset.id.startsWith('statech:stage_')) continue;
  assert.equal(preset.available_machines.includes('planner:certus_farm'), Number(preset.id.split('_').at(-1)) >= 3);
}
for (const [suffix, amount, energy] of [['crystals', 4, 2.1], ['clusters', 1, 5.8]]) {
  const recipe = dataset.recipes.find(value => value.id === `certus_growth|${suffix}`);
  assert.ok(recipe);
  const configuration = recipe.configurations[0];
  assert.equal(configuration.operations_per_second, 1 / 12);
  assert.deepEqual(configuration.capacity.expected_operations_per_second_ratio,
    {numerator: '1', denominator: '12'});
  assert.equal(configuration.idle_eu_per_tick, 3.109375);
  assert.equal(configuration.eu_per_operation, energy);
  assert.ok(configuration.capacity.average_full_load_eu_per_tick_ratio);
  const request = {goals: [{recipe: recipe.id, resource: recipe.primary, rate: amount / 12}],
    available_machines: ['planner:certus_farm'], external: [{resource: 'energy:eu'}], replication: false};
  assert.throws(() => solveFactory(highs, dataset, request), /requires an item the player has already obtained/);
  request.obtained_resources = recipe.requires_obtained;
  const result = solveFactory(highs, dataset, request);
  assert.equal(result.status, 'optimal');
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].machines, 1);
  assert.ok(Math.abs(result.external[0].rate - (3.109375 * 20 + energy / 12)) < 1e-8);
  assert.equal(result.startup.resources.find(value => value.resource === 'site:flawless_budding_quartz').reusable_stock, 1);
  assert.equal(result.startup.incomplete.length, 1);
  if (suffix === 'clusters') assert.equal(result.startup.resources.find(value => value.resource.includes('#')).reusable_stock, 5);
  const limited = solveFactory(highs, dataset, {...request, goals: [{...request.goals[0], rate: amount / 6}], limits: {[configuration.id]: 1}});
  assert.equal(limited.status, 'infeasible');
}
console.log('Both certus farms match measured power, require retained sites and enchanted planes, respect installed limits, and report unknown startup timing.');
