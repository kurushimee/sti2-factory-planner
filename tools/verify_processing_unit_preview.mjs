import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import loadHighs from 'highs';
import {readDataset} from './read_dataset.mjs';
import {solveFactory} from '../kernel/planner.js';

const dataset = await readDataset('data/statech-2.0.1.json.gz');
const route = dataset.recipes.find(recipe => recipe.source_id ===
  'modern_industrialization:electric_age/circuit/craft/processing_unit_asbl');
const all = dataset.progression.find(stage => stage.id === 'statech:all');
assert.ok(route && all);
const syntheses = dataset.recipes.filter(recipe => recipe.type ===
  'modern_industrialization:matter_fabricator' && recipe.inputs.some(input =>
  input.resource === 'item:kubejs:uu_matter'));
assert.equal(syntheses.length, 232);
assert.ok(syntheses.every(recipe => recipe.replication === true));
assert.equal(dataset.recipes.find(recipe => recipe.source_id ===
  'statech:modern_industrialization/matter_fabricator/artifact_synthesis').replication, undefined);
const highs = await loadHighs();
const request = {goals: [{recipe: route.id, resource: route.primary, rate: 0.2}],
  replication: false, production_only: true, exact_production: true,
  available_machines: all.available_machines, available_upgrades: all.available_upgrades,
  available_parts: all.available_parts, external: [{resource: 'energy:eu', cost: 0}],
  time_limit_ms: 60000};
const result = solveFactory(highs, dataset, request);
assert.equal(result.status, 'feasible', result.reason);
assert.equal(result.exact_production.status, 'exact');
assert.ok(result.lines.length > 150);
const byId = new Map(dataset.recipes.map(recipe => [recipe.id, recipe]));
assert.ok(result.lines.every(line => !byId.get(line.recipe).replication));
assert.ok(result.lines.every(line => line.recipe !== syntheses.find(recipe =>
  recipe.primary === 'item:minecraft:potato')?.id));
const glass = result.lines.find(line => line.recipe ===
  'modern_industrialization:furnace|minecraft:/glass_exported_mi_furnace');
assert.ok(glass?.ingredient_choices.some(choice => choice.slot === 0 &&
  choice.resource === 'item:minecraft:sand' && choice.rate > 0));
assert.ok(result.connections.length > result.lines.length);
assert.deepEqual(result.flow_roundoff_links, []);
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify({
  format: 'factory-plan', version: 1, dataset_identity: dataset.identity, dataset,
  request, positions: {}, groups: {},
}));
console.log(JSON.stringify({status: result.status, lines: result.lines.length,
  connections: result.connections.length, exact: result.exact_production.status,
  replication_routes_excluded: syntheses.length}));
