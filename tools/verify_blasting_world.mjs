import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {readDataset} from './read_dataset.mjs';
import {inspectWorld} from '../kernel/world.js';
import {reconstructFactory, worldMachineKey} from '../kernel/reconstruct.js';

const [archivePath, fixturePath, datasetPath, reportPath, privateWorldPath] = process.argv.slice(2);
if (!archivePath || !fixturePath || !datasetPath || !reportPath) {
  throw new Error('Provide the private blasting-world ZIP, saved fixture, bundled dataset, and report output path.');
}
const [archive, fixtureBytes, datasetBytes] = await Promise.all([
  readFile(archivePath), readFile(fixturePath), readFile(datasetPath)]);
const fixture = JSON.parse(fixtureBytes);
const dataset = await readDataset(datasetPath);
const world = inspectWorld(new Uint8Array(archive), dataset);
assert.deepEqual(world.errors, []);
assert.deepEqual(world.unsupported, []);
assert.equal(fixture.length, 4);
assert.equal(world.machines.length, 4);
const byRole = new Map();
for (const expected of fixture) {
  const matches = world.machines.filter(value => value.id === 'minecraft:blast_furnace' &&
    value.origin.dimension === 'minecraft:overworld' && value.origin.x === expected.x &&
    value.origin.y === expected.y && value.origin.z === expected.z);
  assert.equal(matches.length, 1, `The saved ${expected.role} furnace is missing.`);
  const saved = matches[0], slots = new Map((saved.facts.Items ?? []).map(value => [value.Slot, value]));
  assert.equal(saved.facts.CookTime, expected.cook_time_ticks);
  assert.equal(saved.facts.BurnTime, expected.burn_time_remaining_ticks);
  assert.equal(saved.facts.RecipesUsed['spectrum:blasting/pure_resources/iron'], expected.recipes_used);
  assert.equal(slots.get(0)?.count ?? 0, expected.input_count);
  assert.equal(slots.get(1)?.id ?? 'minecraft:air', expected.fuel_slot);
  assert.equal(slots.get(2)?.count ?? 0, expected.output_count);
  byRole.set(expected.role, saved);
}
const coal = byRole.get('coal_active'), lava = byRole.get('lava_active');
assert.ok(coal.recipe_id.endsWith('fuel:minecraft:coal'));
assert.ok(lava.recipe_id.endsWith('fuel:minecraft:lava_bucket'));
assert.equal(coal.assignment_evidence, 'saved_cooking_input_and_queued_fuel');
assert.equal(lava.assignment_evidence, 'saved_cooking_input_and_queued_fuel');
assert.equal(byRole.get('history_only').recipe_id, null);
assert.equal(byRole.get('history_only').assignment_evidence, 'saved_recipe_history_only');
assert.equal(byRole.get('fuel_unknown').recipe_id, null);
assert.equal(byRole.get('fuel_unknown').recipe_candidates.length, 2);
assert.equal(world.reconstruction.assignments.length, 2);
assert.equal(world.reconstruction.goals.length, 2);
assert.ok(world.reconstruction.goals.every(value => value.kind === 'capacity' && value.machines === 1));
assert.deepEqual(world.reconstruction.unresolved.map(value => value.origin.x).sort(), [608, 612]);
assert.ok(world.reconstruction.assignments.every(value => value.capacity_basis.includes('not an observed production rate')));
const corrected = reconstructFactory(world, dataset, {[worldMachineKey(byRole.get('fuel_unknown'))]: {recipe: coal.recipe_id}});
assert.equal(corrected.goals.find(value => value.recipe === coal.recipe_id).machines, 2);
assert.deepEqual(corrected.unresolved.map(value => value.origin.x), [608]);
const digest = value => createHash('sha256').update(value).digest('hex');
const report = {pack: 'StaTech Industry 2.0.1', world_archive_sha256: digest(archive),
  fixture_sha256: digest(fixtureBytes), dataset_sha256: digest(datasetBytes),
  machines: fixture.map(value => ({role: value.role, x: value.x, cook_time_ticks: value.cook_time_ticks,
    burn_time_remaining_ticks: value.burn_time_remaining_ticks, recipes_used: value.recipes_used,
    assignment_evidence: byRole.get(value.role).assignment_evidence})),
  inferred_capacity_goals: 2, focused_corrections: 2,
  limitation: 'Cooking input and queued fuel establish a configured capacity, not an observed long-term output rate. Recipe history and output inventory are past quantities, not goals.'};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
if (privateWorldPath) await writeFile(privateWorldPath, JSON.stringify(world));
console.log('The real world ZIP recovered two active blast-furnace capacities and kept two ambiguous saved machines editable.');
