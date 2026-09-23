import {openSync, closeSync, fstatSync, readSync} from 'node:fs';

export function withArchiveFile(path, callback) {
  const descriptor = openSync(path, 'r');
  try {
    const size = fstatSync(descriptor).size;
    return callback({size, read(offset, length) {
      const bytes = new Uint8Array(length);
      let completed = 0;
      while (completed < length) {
        const count = readSync(descriptor, bytes, completed, length - completed, offset + completed);
        if (!count) throw new Error('The world archive changed or could not be read completely.');
        completed += count;
      }
      return bytes;
    }});
  } finally {
    closeSync(descriptor);
  }
}
