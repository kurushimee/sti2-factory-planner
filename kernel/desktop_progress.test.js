import test from 'node:test';
import assert from 'node:assert/strict';
import {createProgressReporter} from './desktop_progress.js';

test('transient progress-file locks do not abort a calculation and the next event replaces the snapshot', () => {
  for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
    const files = new Map();
    let locked = true;
    const report = createProgressReporter('result.json', 7, {
      writeFileSync(path, text) {files.set(path, text);},
      renameSync(source, destination) {
        if (locked) throw Object.assign(new Error('The reader holds the previous snapshot.'), {code});
        files.set(destination, files.get(source)); files.delete(source);
      },
    });
    assert.equal(report({phase: 'production_routes', attempt: 1}), false);
    locked = false;
    assert.equal(report({phase: 'production_routes', attempt: 2}), true);
    assert.deepEqual(JSON.parse(files.get('result.json.progress')), {id: 7, phase: 'production_routes', attempt: 2});
    assert.equal(files.has('result.json.progress.pending'), false);
  }
});

test('progress reporting retains errors that are not transient reader locks', () => {
  const report = createProgressReporter('result.json', 1, {
    writeFileSync() {throw Object.assign(new Error('No disk space remains.'), {code: 'ENOSPC'});},
  });
  assert.throws(() => report({phase: 'solving'}), /disk space/);
});
