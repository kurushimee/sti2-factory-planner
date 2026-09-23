import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import loadHighs from 'highs';
import {readDataset} from './read_dataset.mjs';
import {solveFactory} from '../kernel/planner.js';
import {materialSignature} from '../kernel/recipe_preferences.js';

const dataset = await readDataset(process.argv[2] ?? 'data/statech-2.0.1.json.gz');
assert.equal(dataset.route_preferences.length, 378);
const recipes = new Map(dataset.recipes.map(recipe => [recipe.id, recipe]));
for (const preference of dataset.route_preferences) assert.equal(materialSignature(recipes.get(preference.preferred)), materialSignature(recipes.get(preference.alternative)));
const preference = dataset.route_preferences.find(value => value.preferred.endsWith('casing/craft/steel_plated_bricks'));
const ordinary = recipes.get(preference.preferred);
const request = {goals: [{resource: ordinary.primary, rate: 1}],
  available_machines: ['ae2:molecular_assembler', 'modern_industrialization:assembler'],
  external: [...ordinary.inputs.map(flow => ({resource: flow.resource})), {resource: 'energy:eu'}]};
const highs = await loadHighs();
const result = solveFactory(highs, dataset, request);
assert.ok(result.lines.some(line => line.recipe === preference.preferred));
assert.ok(!result.lines.some(line => line.recipe === preference.alternative));
assert.equal(result.lines.find(line => line.recipe === preference.preferred).route_preference.reason, preference.reason);
for (const settings of [
  {...request, available_machines: ['modern_industrialization:assembler']},
  {...request, routes: {[ordinary.primary]: preference.alternative}},
  {...request, goals: [{recipe: preference.alternative, resource: ordinary.primary, rate: 1}]},
]) {
  const alternative = solveFactory(highs, dataset, settings);
  assert.ok(alternative.lines.some(line => line.recipe === preference.alternative));
}
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify({request, result}));
console.log('All 378 released material pairs match exactly. Available ordinary automation is preferred; unavailable automation and explicit assembly choices retain the industrial route.');
