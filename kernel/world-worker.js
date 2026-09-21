import {inspectWorld} from './world.js';

self.onmessage = event => {
  const {id, bytes, file, dataset} = event.data;
  try {
    const reader = file ? new FileReaderSync() : null;
    const source = file ? {size: file.size,
      read: (offset, length) => new Uint8Array(reader.readAsArrayBuffer(file.slice(offset, offset + length)))} : new Uint8Array(bytes);
    const result = inspectWorld(source, dataset, progress => self.postMessage({id, ...progress}));
    self.postMessage({id, result});
  } catch (error) {
    self.postMessage({id, error: String(error.message ?? error)});
  }
};
