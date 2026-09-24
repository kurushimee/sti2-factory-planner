import {arrangeGraph} from './graph_layout.js';

self.onmessage = async ({data}) => {
  try { self.postMessage({id: data.id, result: await arrangeGraph(data)}); }
  catch (error) { self.postMessage({id: data.id, error: String(error.message ?? error)}); }
};
