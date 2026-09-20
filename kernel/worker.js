import loadHighs from '../vendor/highs.mjs';
import {solveFactory} from './planner.js';
import {reconstructFactory} from './reconstruct.js';

let runtime;
self.onmessage = async event => {
  const {id, dataset, request} = event.data;
  try {
    if (event.data.kind === 'reconstruct_world') {
      const {world, corrections} = event.data;
      self.postMessage({id, result: {...world, corrections, reconstruction: reconstructFactory(world, dataset, corrections)}});
      return;
    }
    self.postMessage({id, phase: 'loading_solver'});
    runtime ??= loadHighs({locateFile: file => new URL(`../vendor/${file}`, import.meta.url).href});
    const highs = await runtime;
    self.postMessage({id, phase: 'solving'});
    self.postMessage({id, result: solveFactory(highs, dataset, request)});
  } catch (error) {
    self.postMessage({id, error: String(error.message ?? error)});
  }
};
