import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {inspectWorld} from '../kernel/world.js';

const [archivePath, capturePath, datasetPath, reportPath] = process.argv.slice(2);
if (!archivePath || !capturePath || !datasetPath || !reportPath) {
  throw new Error('Pass the private solar-world ZIP, panel capture, bundled dataset, and report path.');
}
const archive = await readFile(archivePath);
const captureBytes = await readFile(capturePath);
const capture = JSON.parse(captureBytes);
const datasetBytes = await readFile(datasetPath);
const dataset = JSON.parse(gunzipSync(datasetBytes));
const world = inspectWorld(new Uint8Array(archive), dataset);
assert.deepEqual(world.errors, []);
assert.deepEqual(world.unsupported, []);
assert.deepEqual(world.reconstruction.unresolved, []);
assert.deepEqual(world.reconstruction.goals, []);
assert.equal(world.machines.length, 3);
assert.equal(world.reconstruction.solar_panels.length, 3);
const panels = capture.map((sample, index) => {
  const origin = {dimension: 'minecraft:overworld', x: 400 + 8 * index, y: 250, z: 0};
  const matching = world.machines.filter(machine => machine.id === sample.machine &&
    Object.entries(origin).every(([key, value]) => machine.origin[key] === value));
  assert.equal(matching.length, 1, `The saved ${sample.machine} panel is missing.`);
  const saved = matching[0];
  const cell = saved.facts.items.find(stack => stack.key?.id === sample.cell);
  assert.equal(cell.amount, '1');
  assert.equal(cell.key.components['extended_industrialization:solar_ticks'], 4);
  const water = saved.facts.fluids.find(stack => stack.key?.id === 'extended_industrialization:distilled_water');
  assert.equal(water.amount, '9');
  const panel = world.reconstruction.solar_panels.find(value => value.machine_id === sample.machine);
  assert.equal(panel.recipe, `planner:solar|${sample.machine}|water`);
  assert.equal(panel.saved_cell.amount, '1');
  assert.equal(panel.saved_fluid.amount_mb, '9');
  return {machine: sample.machine, origin, recipe: panel.recipe, cell: sample.cell,
    saved_cell_count: panel.saved_cell.amount, saved_water_mb: panel.saved_fluid.amount_mb};
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {pack: 'StaTech Industry 2.0.1', world_archive_sha256: hash(archive),
  capture_sha256: hash(captureBytes), dataset_sha256: hash(datasetBytes), panels,
  limitation: 'The saved cell and 9 mB of water establish a configuration snapshot. Open sky, clear weather, replacement cells, continuous water delivery, cable transfer, and any planned storage remain separate assumptions.'};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log('The real world archive preserved three distinct solar tiers, cells, water stocks, and reviewable routes.');
