import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {inspectWorld} from '../kernel/world.js';
import {readDataset} from './read_dataset.mjs';

const [archivePath, datasetPath, reportPath] = process.argv.slice(2);
if (!archivePath || !datasetPath || !reportPath) {
  throw new Error('Provide the private reactor world ZIP, bundled dataset, and nuclear evidence report.');
}
const [archive, dataset, report] = await Promise.all([
  readFile(archivePath), readDataset(datasetPath), readFile(reportPath, 'utf8').then(JSON.parse)
]);
assert.equal(createHash('sha256').update(archive).digest('hex'), report.private_world_archive_sha256);
const world = inspectWorld(new Uint8Array(archive), dataset);
assert.deepEqual(world.errors, []);
const reactors = world.machines.filter(machine => machine.id === 'modern_industrialization:nuclear_reactor');
assert.equal(reactors.length, 1);
const reactor = reactors[0];
assert.deepEqual([reactor.origin.dimension, reactor.origin.x, reactor.origin.y, reactor.origin.z],
  ['minecraft:overworld', 832, 160, 0]);
assert.equal(reactor.shape, 0);
assert.equal(reactor.structure.status, 'matching_saved_geometry');
assert.deepEqual(reactor.structure.problems, []);
assert.deepEqual(reactor.structure.hatches.map(hatch => [hatch.x, hatch.y, hatch.z]).sort(), [
  [831, 163, 2], [832, 163, 1], [832, 163, 2], [832, 163, 3], [833, 163, 2]
]);
assert.match(world.reconstruction.unresolved.find(entry =>
  entry.machine_id === reactor.id && entry.origin.x === 832)?.reason || '',
/No unique recipe assignment/);
console.log('The saved formed reactor has five matched hatches and remains visibly unresolved without a supported operating route.');
