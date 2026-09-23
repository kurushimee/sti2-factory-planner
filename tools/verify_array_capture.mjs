import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {inspectWorld} from '../kernel/world.js';

const [archivePath, datasetPath, reportPath] = process.argv.slice(2);
const archive = new Uint8Array(await readFile(archivePath));
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const world = inspectWorld(archive, dataset);
assert.deepEqual(world.errors, []);
const reports = [];
for (const [x, machineId, contained, ticks, energy, output] of [
  [320, 'extended_industrialization:processing_array', 'modern_industrialization:electric_macerator', 10, 3200, 48],
  [384, 'industrialization_overdrive:multi_processing_array', 'modern_industrialization:distillation_tower', 53, 57600, 8000],
]) {
  const controller = world.machines.find(value => value.origin.x === x && value.id === machineId);
  assert(controller, `Missing saved controller at ${x}.`);
  assert.equal(controller.structure.status, 'matching_saved_geometry');
  assert.equal(controller.contained_machine.id, contained);
  assert.equal(controller.contained_machine.count, 8);
  assert.equal(controller.upgrades.id, 'modern_industrialization:advanced_upgrade');
  assert.equal(controller.upgrades.count, 4);
  const assignment = world.reconstruction.assignments.find(value => value.origin.x === x);
  assert(assignment, JSON.stringify(world.reconstruction.unresolved.find(value => value.origin?.x === x)));
  assert.equal(assignment.configuration.capacity.ticks_per_batch, ticks);
  assert.equal(assignment.configuration.capacity.energy_per_batch, energy);
  const evidencePath = `data/provenance/${x === 320 ? 'processing-array' : 'multi-processing-array'}-structure-check.json`;
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(evidence.machine, machineId);
  for (const sample of evidence.array_cycle.steady_batches.slice(1)) {
    assert.equal(sample.ticks, ticks);
    assert.equal(sample.energy, energy);
    assert.equal(sample.batch, 8);
    assert.equal(sample.output_quantity, output);
  }
  reports.push({machine: machineId, origin: controller.origin, contained_machine: controller.contained_machine, upgrades: controller.upgrades,
    recipe: assignment.recipe, configuration: assignment.configuration.id, setup: assignment.setup,
    assignment_evidence: assignment.assignment_evidence, steady_ticks: ticks, energy_per_batch: energy,
    operations_per_batch: 8, total_output_per_batch: output});
}
await writeFile(reportPath, JSON.stringify({archive_sha256: createHash('sha256').update(archive).digest('hex'), arrays: reports,
  evidence: 'Both structures matched in the loaded pack and ran real batches with continuous direct hatch supply. Saved controllers retain their machines, upgrades, and active recipe assignments.',
  limits: 'The first recorded completion crosses the warm-up boundary and is excluded from steady interval comparison. Direct supply does not verify external cable or transport capacity. Saved configuration is not an observed long-term rate.'}, null, 2) + '\n');
console.log('Both formed arrays match saved configurations and independently checked steady batch arithmetic.');
