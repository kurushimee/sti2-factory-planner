import assert from 'node:assert/strict';
import {readDataset} from './read_dataset.mjs';
import {configureRecipe} from '../kernel/catalog.js';

const dataset = await readDataset(process.argv[2] ?? 'data/statech-2.0.1.json.gz');
const removed = dataset.machines.filter(machine => machine.availability?.automatic === false);
assert.equal(removed.length, 4);
for (const machine of removed) {
  assert.ok(!dataset.default_machines.includes(machine.id));
  assert.ok(dataset.progression.every(preset => !preset.available_machines.includes(machine.id)));
  const recipe = dataset.recipes.find(value => value.process?.type === machine.recipe_type);
  assert.ok(recipe, machine.id);
  for (const replication of [false, true]) {
    const automatic = configureRecipe(recipe, dataset, {replication});
    assert.ok(automatic.configurations.every(value => value.machine !== machine.id));
  }
  const owned = configureRecipe(recipe, dataset, {available_machines: [machine.id]});
  assert.ok(owned.configurations.some(value => value.machine === machine.id));
}
console.log('Four unused pack machines stay out of default and progression planning in both modes, while explicit owned-machine choices remain available.');
