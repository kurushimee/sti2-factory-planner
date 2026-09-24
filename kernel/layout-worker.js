import {arrangeGraph} from './graph_layout.js';

self.onmessage = async ({data}) => {
  try {
    const result = await arrangeGraph(data, {
      workerFactory: () => new Worker(new URL('../vendor/elk-worker.min.js', import.meta.url)),
    });
    self.postMessage({id: data.id, result});
  }
  catch (error) { self.postMessage({id: data.id, error: String(error.message ?? error)}); }
};
