import {inspectWorld} from './world.js';

self.onmessage = event => {
  const {id, bytes, dataset} = event.data;
  try {
    const result = inspectWorld(new Uint8Array(bytes), dataset, progress => self.postMessage({id, ...progress}));
    self.postMessage({id, result});
  } catch (error) {
    self.postMessage({id, error: String(error.message ?? error)});
  }
};
