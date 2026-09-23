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
const machines = fixture.map(expected => {
  const matches = world.machines.filter(machine => machine.id === expected.machine &&
    machine.origin.dimension === 'minecraft:overworld' && machine.origin.x === expected.x &&
    machine.origin.y === expected.y && machine.origin.z === expected.z);
  assert.equal(matches.length, 1, `The saved storage unit is missing: ${expected.machine}.`);
  const saved = matches[0];
  assert.equal(BigInt(saved.facts.storedEu), BigInt(expected.stored_eu));
  return {machine: saved.id, origin: {dimension: saved.origin.dimension, x: saved.origin.x,
    y: saved.origin.y, z: saved.origin.z}, saved_charge_eu: saved.facts.storedEu,
  evidence: 'saved_storedEu'};
});
const report = {pack: 'StaTech Industry 2.0.1', world_archive_sha256: createHash('sha256').update(archive).digest('hex'),
  fixture_sha256: createHash('sha256').update(await readFile(fixturePath)).digest('hex'),
  dataset_sha256: createHash('sha256').update(await readFile(datasetPath)).digest('hex'),
  machines, limitation: 'Saved charge is a quantity, not a sustained output rate. The current planner still asks for recipe assignments on these recognized storage units; issue #41 tracks their dedicated import.'};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log('The real world archive preserved five distinct charged storage units and their exact saved EU quantities.');
