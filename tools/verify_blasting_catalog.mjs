import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import loadHighs from 'highs';
import {readDataset} from './read_dataset.mjs';
import {solveFactory} from '../kernel/planner.js';

const dataset = await readDataset(process.argv[2] ?? 'data/statech-2.0.1.json.gz');
const report = JSON.parse(await readFile(new URL('../data/provenance/blasting-report.json', import.meta.url)));
const machine = dataset.machines.find(value => value.id === 'minecraft:blast_furnace');
assert.equal(dataset.source.blasting_capture_sha256, report.trial_capture_sha256);
assert.deepEqual(machine.fuel_burn_ticks, report.fuel_burn_ticks);
assert.equal(machine.operation_ticks, report.cooking_ticks);
for (const source of report.source_recipes) {
  const routes = dataset.recipes.filter(value => value.source_id === source);
  assert.equal(routes.length, 2, `Missing coal or lava route for ${source}.`);
  assert.deepEqual(new Set(routes.map(value => value.inputs[1].resource)),
    new Set(['item:minecraft:coal', 'item:minecraft:lava_bucket']));
  assert.ok(routes.every(value => value.configurations.length === 1 &&
    value.configurations[0].operations_per_second === 0.2 &&
    value.configurations[0].startup_profile.kind === 'vanilla_furnace'));
  if (!source.endsWith('/iron')) {
    const lava = routes.find(value => value.inputs[1].resource === 'item:minecraft:lava_bucket');
    assert.ok(lava.configurations[0].assumptions.some(value => value.includes('not tick-tested')));
  }
  assert.equal(dataset.unsupported_entries.filter(value => value.source_id === source).length, 0);
}

const highs = await loadHighs();
const iron = dataset.recipes.filter(value => value.source_id === 'spectrum:blasting/pure_resources/iron');
let uiFixture;
for (const [fuel, expected] of [['item:minecraft:coal', 0.125], ['item:minecraft:lava_bucket', 0.01]]) {
  const recipe = iron.find(value => value.inputs[1].resource === fuel);
  const request = {goals: [{recipe: recipe.id, resource: 'item:minecraft:iron_ingot', rate: 1}],
    available_machines: [machine.id], external: [{resource: 'item:spectrum:pure_iron'}, {resource: fuel}],
    time_limit_ms: 30000};
  const plan = solveFactory(highs, dataset, request);
  assert.equal(plan.status, 'optimal');
  assert.equal(plan.lines.length, 1);
  assert.equal(plan.lines[0].machines, 5);
  assert.equal(plan.external.find(value => value.resource === fuel).rate, expected);
  assert.equal(plan.startup.resources.find(value => value.resource === fuel).first_operation_stock, 5);
  assert.equal(plan.startup.build_requirements.find(value => value.resource === 'item:minecraft:blast_furnace').amount, 5);
  const bucket = plan.lines[0].outputs.find(value => value.resource === 'item:minecraft:bucket');
  assert.equal(bucket?.rate ?? 0, fuel.endsWith('lava_bucket') ? 0.01 : 0);
  if (bucket) assert.equal(plan.startup.resources.find(value => value.resource === bucket.resource)
    .warmup_output_stock, 1);
  if (fuel.endsWith('lava_bucket')) uiFixture = {request, result: plan};
}
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(uiFixture));
console.log('All 16 loaded Spectrum blasting routes, whole furnaces, fuels, returned buckets, and startup stocks passed.');
