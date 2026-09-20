import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import loadHighs from 'highs';
import {solveFactory} from '../kernel/planner.js';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {zipSync, gzipSync} from 'fflate';
import {inspectWorld} from '../kernel/world.js';

const root = new URL('../', import.meta.url);
const dataset = {format: 1, resources: [{id: 'ore'}, {id: 'plate'}], recipes: [{
  id: 'smelt', primary: 'plate', inputs: [{resource: 'ore', amount: 1}], outputs: [{resource: 'plate', amount: 2}],
  configurations: [{id: 'furnace', machine: 'furnace', operations_per_second: 3}],
}]};
const request = {goals: [{resource: 'plate', rate: 14}], external: [{resource: 'ore'}]};
const expected = solveFactory(await loadHighs(), dataset, request);
const bundle = await build({entryPoints: ['kernel/world-worker.js'], bundle: true, write: false, format: 'esm', platform: 'browser'});
const [worldPath, machinesPath] = process.argv.slice(2);
const worldBytes = worldPath ? new Uint8Array(await readFile(worldPath)) : zipSync({'test/level.dat': gzipSync(Uint8Array.from([10, 0, 0, 0]))});
const worldDataset = machinesPath ? JSON.parse(await readFile(machinesPath, 'utf8')) : {machines: []};
const expectedWorld = inspectWorld(worldBytes, worldDataset);
const server = createServer(async (incoming, response) => {
  try {
    const path = new URL(incoming.url, 'http://localhost').pathname;
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Planner kernel verification</title><p>Local computation test.</p>');
      return;
    }
    if (path === '/embed') {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<!doctype html><title>Embedded kernel verification</title><iframe src="http://localhost:${server.address().port}/"></iframe>`);
      return;
    }
    if (path === '/kernel/world-worker.js') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].contents); return;
    }
    if (path === '/fixture.zip') {
      response.setHeader('Content-Type', 'application/zip'); response.end(worldBytes); return;
    }
    const files = {
      '/kernel/worker.js': 'kernel/worker.js', '/kernel/planner.js': 'kernel/planner.js',
      '/kernel/flows.js': 'kernel/flows.js',
      '/kernel/goals.js': 'kernel/goals.js',
      '/kernel/startup.js': 'kernel/startup.js',
      '/kernel/capacity.js': 'kernel/capacity.js',
      '/kernel/catalog.js': 'kernel/catalog.js',
      '/kernel/configuration.js': 'kernel/configuration.js',
      '/kernel/reconstruct.js': 'kernel/reconstruct.js',
      '/kernel/boiler.js': 'kernel/boiler.js',
      '/vendor/highs.mjs': 'node_modules/highs/build/highs.mjs', '/vendor/highs.wasm': 'node_modules/highs/build/highs.wasm',
    };
    if (!files[path]) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
    response.end(await readFile(new URL(files[path], root)));
  } catch (error) {
    response.writeHead(500); response.end(String(error));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
  const frame = page.frames().find(item => item !== page.mainFrame());
  await frame.waitForLoadState();
  const actual = await frame.evaluate(async ({dataset, request}) => {
    const worker = new Worker('/kernel/worker.js', {type: 'module'});
    const phases = [];
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker timed out.')), 15000);
      worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
      worker.onmessage = event => {
        if (event.data.phase) phases.push(event.data.phase);
        if (event.data.error) { clearTimeout(timer); reject(new Error(event.data.error)); }
        if (event.data.result) { clearTimeout(timer); resolve(event.data.result); }
      };
      worker.postMessage({id: 1, dataset, request});
    });
    worker.terminate();
    return {result, phases, isolated: self.crossOriginIsolated};
  }, {dataset, request});
  assert.deepEqual(actual.result, expected);
  assert.deepEqual(actual.phases, ['loading_solver', 'solving']);
  assert.equal(actual.isolated, false);
  assert.deepEqual(errors, []);
  const imported = await frame.evaluate(async dataset => {
    const bytes = await (await fetch('/fixture.zip')).arrayBuffer();
    const worker = new Worker('/kernel/world-worker.js', {type: 'module'});
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('World import timed out.')), 20000);
        worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
        worker.onmessage = event => {
          if (event.data.error) { clearTimeout(timer); reject(new Error(event.data.error)); }
          if (event.data.result) { clearTimeout(timer); resolve(event.data.result); }
        };
        worker.postMessage({id: 2, dataset, bytes}, [bytes]);
      });
    } finally { worker.terminate(); }
  }, worldDataset);
  assert.deepEqual(JSON.parse(JSON.stringify(imported)), JSON.parse(JSON.stringify(expectedWorld)));
  console.log('The embedded browser Worker matches Node exactly without cross-origin isolation.');
  console.log(`The browser imported ${imported.machines.length} machines with the same result as Node.`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
