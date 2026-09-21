import {readFile, writeFile, stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {readDataset} from './read_dataset.mjs';
import {withArchiveFile} from '../kernel/archive_file.js';
import {inspectWorld} from '../kernel/world.js';

const [path, datasetPath, output, referencePath = path] = process.argv.slice(2);
if (!path || !datasetPath) throw new Error('Supply a world ZIP and its dataset. An optional fourth argument provides a smaller equivalent reference ZIP.');
const dataset = await readDataset(datasetPath), before = await stat(path);
const expected = inspectWorld(new Uint8Array(await readFile(referencePath)), dataset);
const reads = [], started = performance.now(), phases = [];
const actual = withArchiveFile(path, source => inspectWorld({size: source.size, read(offset, length) {
  reads.push({offset, length});
  return source.read(offset, length);
}}, dataset, progress => phases.push(progress)));
assert.deepEqual(actual, expected);
const after = await stat(path);
assert.equal(after.size, before.size);
assert.equal(after.mtimeMs, before.mtimeMs);
const report = {archive_bytes: before.size, bytes_read: reads.reduce((sum, read) => sum + read.length, 0),
  largest_read: Math.max(...reads.map(read => read.length)), read_count: reads.length,
  elapsed_ms: performance.now() - started, machines: actual.machines.length,
  goals: actual.reconstruction?.goals.length, errors: actual.errors.length, progress_events: phases.length};
if (referencePath !== path) assert.ok(report.bytes_read < before.size / 10, 'Unrelated large archive content must not be read.');
if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
