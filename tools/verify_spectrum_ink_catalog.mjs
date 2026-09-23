import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import loadHighs from 'highs';
import {readDataset} from './read_dataset.mjs';
import {solveFactory} from '../kernel/planner.js';

const dataset = await readDataset(process.argv[2] ?? 'data/statech-2.0.1.json.gz');
const report = JSON.parse(await readFile(new URL('../data/provenance/spectrum-ink-report.json', import.meta.url)));
const picker = dataset.machines.find(value => value.id === 'spectrum:color_picker');
assert.equal(dataset.source.spectrum_ink_capture_sha256, report.trial_capture_sha256);
assert.equal(picker.operation_ticks, report.color_picker_cycle_ticks);
assert.equal(picker.ink_storage_capacity, 16777216);

const colors = new Set();
for (const kind of ['dye', 'pigment', 'pigment_blocks']) {
  for (const color of ['black', 'blue', 'brown', 'cyan', 'gray', 'green', 'light_blue',
    'light_gray', 'lime', 'magenta', 'orange', 'pink', 'purple', 'red', 'white', 'yellow']) {
    const source = `spectrum:ink_converting/${kind}/${color}`;
    const routes = dataset.recipes.filter(value => value.source_id === source);
    assert.equal(routes.length, 1, `Missing loaded Color Picker route for ${source}.`);
    const recipe = routes[0];
    assert.equal(recipe.primary, `ink:spectrum:${color}`);
    assert.equal(recipe.outputs[0].amount, {dye: 5, pigment: 100, pigment_blocks: 900}[kind]);
    assert.equal(recipe.configurations[0].machine, picker.id);
    assert.equal(recipe.configurations[0].operations_per_second, 4);
    assert.equal(dataset.unsupported_entries.filter(value => value.source_id === source).length, 0);
    colors.add(recipe.primary);
  }
}
assert.equal(colors.size, report.ink_colors);
assert.equal(dataset.resources.filter(value => value.kind === 'ink').length, report.ink_colors);

const highs = await loadHighs();
const brownDye = dataset.recipes.find(value => value.source_id === 'spectrum:ink_converting/dye/brown');
const request = {
  goals: [{recipe: brownDye.id, resource: brownDye.primary, rate: 20}],
  available_machines: [picker.id],
  external: [{resource: 'item:minecraft:brown_dye'}],
  time_limit_ms: 30000,
};
const result = solveFactory(highs, dataset, request);
assert.equal(result.status, 'optimal');
assert.equal(result.lines.length, 1);
assert.equal(result.lines[0].machines, 1);
assert.equal(result.external.find(value => value.resource === 'item:minecraft:brown_dye').rate, 4);
assert.equal(result.startup.build_requirements.find(value => value.resource === 'item:spectrum:color_picker').amount, 1);
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify({request, result}));
console.log('All 48 loaded Color Picker routes and the measured brown-dye capacity passed.');
