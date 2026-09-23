import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import loadHighs from 'highs';
import {readDataset} from './read_dataset.mjs';
import {solveFactory} from '../kernel/planner.js';

const dataset = await readDataset(process.argv[2] ?? 'data/statech-2.0.1.json.gz');
const recipe = dataset.recipes.find(value => value.source_id ===
  'modern_industrialization:electric_age/upgrades/quantum');
assert.ok(recipe, 'The quantum upgrade recipe must be present.');
const stage = dataset.progression[7];
const siteRequirements = [...new Set(dataset.recipes.filter(value => value.type === 'planner:certus_growth')
  .flatMap(value => value.requires_obtained ?? []))];
const request = {goals: [{recipe: recipe.id, resource: recipe.primary, rate: 0.02}],
  replication: false, production_only: true, exact_production: true,
  available_machines: stage.available_machines, available_upgrades: stage.available_upgrades,
  obtained_resources: siteRequirements, external: [{resource: 'energy:eu', cost: 0}],
  time_limit_ms: 60000};
const highs = await loadHighs();
const start = performance.now();
const result = solveFactory(highs, dataset, request);
assert.equal(result.status, 'feasible', JSON.stringify({status: result.status, reason: result.reason}));
assert.equal(result.optimal, false);
assert.equal(result.search.method, 'catalog_seed_refinement');
assert.equal(result.optimization.lower_bound, null);
assert.equal(result.exact_production.status, 'exact', result.exact_production.reason);
assert.deepEqual(result.flow_roundoff, []);
assert.ok(result.lines.length > 400);
assert.ok(result.connections.length > 1000);
assert.equal(result.targets[0].rate, request.goals[0].rate);
assert.ok(result.lines.some(line => line.recipe === recipe.id));
assert.ok(result.lines.every(line => Number.isSafeInteger(line.machines) && line.machines > 0));
assert.ok(result.lines.every(line => line.operations_per_second_exact && line.capacity_per_second_exact),
  result.lines.filter(line => !line.operations_per_second_exact || !line.capacity_per_second_exact)
    .map(line => `${line.configuration}: machines=${line.machines}, operations=${line.operations_per_second}, capacity=${line.capacity_per_second}`).join(', '));
assert.ok(result.connections.every(flow => flow.rate_exact && flow.rate_exact.numerator !== '0'));
assert.ok(result.external.every(flow => flow.resource === 'energy:eu'));
const byId = new Map(dataset.recipes.map(value => [value.id, value]));
assert.ok(result.lines.every(line => !byId.get(line.recipe).replication));
const certus = result.lines.filter(line => byId.get(line.recipe).type === 'planner:certus_growth');
assert.ok(certus.length > 0);
assert.ok(certus.every(line => BigInt(line.capacity_per_second_exact.numerator) * 12n ===
  BigInt(line.machines) * BigInt(line.capacity_per_second_exact.denominator)));
const keys = new Set(result.lines.map(line => `${line.recipe}|${line.configuration}`));
for (const flow of result.connections) {
  assert.ok(keys.has(flow.source) || flow.source.startsWith('external:'), flow.source);
  assert.ok(keys.has(flow.destination) || flow.destination.startsWith('goal:') ||
    flow.destination.startsWith('surplus:'));
}
if (process.argv[3]) {
  await mkdir(dirname(process.argv[3]), {recursive: true});
  await writeFile(process.argv[3], JSON.stringify({request, result}));
}
if (process.argv[4]) {
  await mkdir(dirname(process.argv[4]), {recursive: true});
  await writeFile(process.argv[4], JSON.stringify({format: 'factory-plan', version: 1,
    dataset_identity: dataset.identity, dataset, request, positions: {}, groups: {}}));
}
const withoutSite = solveFactory(highs, dataset, {...request, obtained_resources: []});
assert.equal(withoutSite.status, 'unresolved');
assert.match(withoutSite.reason, /Flawless budding quartz kept at its original site/);
assert.match(withoutSite.reason, /Annihilation plane with Silk Touch I/);
assert.doesNotMatch(withoutSite.reason, /Creative Blaze Cake/);
const plate = dataset.recipes.find(value => value.source_id ===
  'modern_industrialization:materials/iron/compressor/main');
const simpleAtLateStage = solveFactory(highs, dataset, {...request,
  goals: [{recipe: plate.id, resource: plate.primary, rate: 1}], obtained_resources: [],
  time_limit_ms: 30000});
assert.equal(simpleAtLateStage.status, 'feasible');
assert.equal(simpleAtLateStage.search.method, 'catalog_progression_fallback');
assert.equal(simpleAtLateStage.exact_production.status, 'exact');
assert.deepEqual(simpleAtLateStage.flow_roundoff, []);
assert.ok(simpleAtLateStage.lines.some(line => line.recipe === plate.id));
const hourly = solveFactory(highs, dataset, {...request,
  goals: [{recipe: recipe.id, resource: recipe.primary, rate: 1 / 3600,
    rate_ratio: {numerator: '1', denominator: '3600'}}]});
assert.equal(hourly.status, 'feasible', JSON.stringify({status: hourly.status, reason: hourly.reason}));
assert.equal(hourly.exact_production.status, 'exact', hourly.exact_production.reason);
assert.deepEqual(hourly.flow_roundoff, []);
assert.equal(hourly.exact_production.endpoints.find(endpoint => endpoint.key === `goal:${recipe.primary}`).rate.display,
  '1/3600');
console.log(JSON.stringify({elapsed_ms: Math.round(performance.now() - start), lines: result.lines.length,
  connections: result.connections.length, certus_lines: certus.length, without_site: withoutSite.status,
  early_goal_at_late_stage: simpleAtLateStage.lines.length, hourly_goal_lines: hourly.lines.length}));
