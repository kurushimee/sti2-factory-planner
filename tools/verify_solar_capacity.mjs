import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import loadHighs from 'highs';
import {solveFactory} from '../kernel/planner.js';

const [datasetPath, resultPath, planPath] = process.argv.slice(2);
if (!datasetPath || !resultPath) throw new Error('Pass the bundled dataset and a result JSON path.');
const dataset = JSON.parse(gunzipSync(await readFile(datasetPath)));
const recipes = dataset.recipes.filter(recipe => recipe.id.startsWith('planner:solar|') && recipe.id.endsWith('|water'));
assert.equal(recipes.length, 3);
const request = {goals: recipes.map(recipe => ({kind: 'capacity', resource: 'energy:eu',
  recipe: recipe.id, configuration: recipe.configurations[0].id, machines: 1})),
  installed: Object.fromEntries(recipes.map(recipe => [recipe.configurations[0].id, 1])),
  available_machines: recipes.map(recipe => recipe.configurations[0].machine).concat('modern_industrialization:hv_storage_unit'),
  periodic_storage: ['modern_industrialization:hv_storage_unit'],
  external: recipes.map(recipe => ({resource: recipe.inputs[0].resource})).concat({resource: 'fluid:extended_industrialization:distilled_water'}),
  time_limit_ms: 30000};
const result = solveFactory(await loadHighs(), dataset, request);
assert.equal(result.status, 'feasible');
assert.equal(result.search.method, 'periodic_precision_recovery');
assert.equal(result.lines.length, 3);
assert.ok(result.lines.every(line => line.machines === 1));
assert.ok(result.periodic_power.energy_balance_surplus_eu_per_period >=
  -result.periodic_power.energy_roundoff_bound_eu_per_period);
await writeFile(resultPath, JSON.stringify({request, result}));
if (planPath) await writeFile(planPath, JSON.stringify({format: 'factory-plan', version: 1,
  dataset_identity: dataset.identity, dataset, request, positions: {}, groups: {}}));
console.log('The three exact solar capacity goals passed whole-machine, resource, and full-cycle energy checks.');
