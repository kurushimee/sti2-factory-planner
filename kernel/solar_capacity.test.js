import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import loadHighs from 'highs';
import {solveFactory} from './planner.js';

const dataset = JSON.parse(gunzipSync(readFileSync('data/statech-2.0.1.json.gz')));
const recipes = dataset.recipes.filter(recipe => recipe.id.startsWith('planner:solar|') && recipe.id.endsWith('|water'));
const goals = recipes.map(recipe => ({kind: 'capacity', resource: 'energy:eu', recipe: recipe.id,
  configuration: recipe.configurations[0].id, machines: 1}));
const request = {goals, installed: Object.fromEntries(recipes.map(recipe => [recipe.configurations[0].id, 1])),
  available_machines: recipes.map(recipe => recipe.configurations[0].machine).concat('modern_industrialization:hv_storage_unit'),
  periodic_storage: ['modern_industrialization:hv_storage_unit'],
  external: recipes.map(recipe => ({resource: recipe.inputs[0].resource})).concat({resource: 'fluid:extended_industrialization:distilled_water'}),
  time_limit_ms: 30000};

test('three measured water-assisted solar capacity goals remain feasible without ghost machines', async () => {
  const highs = await loadHighs();
  const result = solveFactory(highs, dataset, request);
  assert.equal(result.status, 'feasible');
  assert.equal(result.search?.method, 'periodic_precision_recovery');
  assert.equal(result.lines.length, 3);
  assert.deepEqual(result.lines.map(line => line.recipe).sort(), recipes.map(recipe => recipe.id).sort());
  assert.ok(result.lines.every(line => line.machines === 1 && line.operations_per_second === 1));
  assert.equal(result.periodic_power.generation.filter(line => line.machines > 0).length, 3);
  assert.ok(result.periodic_power.storage[0].machines >= 1);
  assert.ok(result.periodic_power.energy_balance_surplus_eu_per_period >=
    -result.periodic_power.energy_roundoff_bound_eu_per_period);
  assert.ok(result.balances.find(balance => balance.resource === 'energy:eu').surplus >= -1e-12);
});
