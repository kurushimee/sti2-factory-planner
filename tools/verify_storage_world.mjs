import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {inspectWorld} from '../kernel/world.js';

const [archivePath, fixturePath, datasetPath, reportPath] = process.argv.slice(2);
if (!archivePath || !fixturePath || !datasetPath || !reportPath) {
  throw new Error('Provide the private storage-world ZIP, fixture JSON, bundled dataset, and report output path.');
}
const archive = await readFile(archivePath);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const dataset = JSON.parse(gunzipSync(await readFile(datasetPath)));
const world = inspectWorld(new Uint8Array(archive), dataset);
assert.deepEqual(world.errors, []);
assert.deepEqual(world.unsupported, []);
assert.equal(fixture.length, 5);
assert.equal(world.machines.length, 5);
assert.deepEqual(world.reconstruction.unresolved, []);
assert.deepEqual(world.reconstruction.goals, []);
assert.equal(world.reconstruction.storage_units.length, 5);
const machines = fixture.map(expected => {
  const matches = world.machines.filter(machine => machine.id === expected.machine &&
    machine.origin.dimension === 'minecraft:overworld' && machine.origin.x === expected.x &&
    machine.origin.y === expected.y && machine.origin.z === expected.z);
  assert.equal(matches.length, 1, `The saved storage unit is missing: ${expected.machine}.`);
  const saved = matches[0];
  assert.equal(BigInt(saved.facts.storedEu), BigInt(expected.stored_eu));
  const key = `${saved.origin.dimension}|${saved.origin.x}|${saved.origin.y}|${saved.origin.z}`;
  const [unit] = world.reconstruction.storage_units.filter(value => value.machine === key);
  assert.equal(unit.saved_charge_eu, String(expected.stored_eu));
  assert.ok(unit.capacity_eu > 0 && unit.charge_eu_per_tick > 0 && unit.discharge_eu_per_tick > 0);
  return {machine: saved.id, origin: {dimension: saved.origin.dimension, x: saved.origin.x,
    y: saved.origin.y, z: saved.origin.z}, saved_charge_eu: unit.saved_charge_eu,
    capacity_eu: unit.capacity_eu, charge_eu_per_tick: unit.charge_eu_per_tick,
    discharge_eu_per_tick: unit.discharge_eu_per_tick, evidence: unit.evidence};
});
const report = {pack: 'StaTech Industry 2.0.1', world_archive_sha256: createHash('sha256').update(archive).digest('hex'),
  fixture_sha256: createHash('sha256').update(await readFile(fixturePath)).digest('hex'),
  dataset_sha256: createHash('sha256').update(await readFile(datasetPath)).digest('hex'),
  machines, limitation: 'Saved charge is a starting quantity, not a sustained output rate. The planner still needs to carry imported storage into periodic power settings and the graph.'};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log('The real world archive preserved five distinct charged storage units and their exact saved EU quantities.');
