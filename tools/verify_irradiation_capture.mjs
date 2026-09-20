import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {inspectWorld} from '../kernel/world.js';

const [archivePath, datasetPath, reportPath, completedArchivePath] = process.argv.slice(2);
if (!completedArchivePath) throw new Error('Provide the active world ZIP, dataset, report path, and completed-cycle world ZIP.');
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const archive = new Uint8Array(await readFile(archivePath));
const result = inspectWorld(archive, dataset);
assert.deepEqual(result.errors, []);
const controller = result.machines.find(machine => machine.id === 'yet_another_industrialization:nuclear_rod_irradiator');
assert.equal(controller.structure.status, 'matching_saved_geometry');
assert.equal(controller.assignment_evidence, 'saved_nuclear_fuel_and_source_with_unique_hatches');
assert.equal(controller.saved_setup.batch, 8);
assert.equal(controller.recipe_id, 'irradiate|item:modern_industrialization:uranium_fuel_rod|modern_industrialization:beryllium_block');
const assignment = result.reconstruction.assignments.find(value => value.recipe === controller.recipe_id);
assert.equal(assignment.configuration.operations_per_second, .02);
assert.equal(assignment.configuration.idle_eu_per_tick, 1024);
const goal = result.reconstruction.goals.find(value => value.recipe === controller.recipe_id);
assert.equal(goal.machines, 1);
assert.equal(goal.configuration, controller.configuration_id);
const completedArchive = new Uint8Array(await readFile(completedArchivePath));
const completed = inspectWorld(completedArchive, dataset);
assert.match(completed.reconstruction.unresolved.find(value => value.machine_id === controller.id).reason, /no active fuel/);
assert.equal(completed.reconstruction.assignments.some(value => value.recipe === controller.recipe_id), false);
const {facts, ...configuration} = controller;
await writeFile(reportPath, JSON.stringify({archive_sha256: createHash('sha256').update(archive).digest('hex'),
  completed_archive_sha256: createHash('sha256').update(completedArchive).digest('hex'), controller: configuration,
  goal, configured_operations_per_second: assignment.configuration.operations_per_second,
  evidence: 'The loaded pack saved a matched structure with eight installed uranium rods and a beryllium source. The completed-cycle save has only depleted outputs and remains unresolved.',
  limits: 'Configured capacity assumes continuous inputs, power, and accepted outputs. Saved inventory is not an observed production rate.'}, null, 2) + '\n');
console.log('The real irradiator save reconstructs eight nuclear hatches; depleted outputs alone remain unresolved.');
