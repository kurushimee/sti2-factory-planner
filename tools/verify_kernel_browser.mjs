import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import loadHighs from 'highs';
import {solveFactory} from '../kernel/planner.js';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {zipSync, gzipSync} from 'fflate';
import {inspectWorld} from '../kernel/world.js';
import {readDataset} from './read_dataset.mjs';
import {constructionCase, verifyConstructionCase} from './construction_catalog_case.mjs';

const root = new URL('../', import.meta.url);
const dataset = {format: 1, resources: ['ore', 'plate', 'fuel', 'steam'].map(id => ({id})), recipes: [{
  id: 'smelt', primary: 'plate', inputs: [{resource: 'ore', amount: 1}, {resource: 'steam', amount: 10}], outputs: [{resource: 'plate', amount: 2}],
  configurations: [{id: 'furnace', machine: 'furnace', operations_per_second: 3}],
}, {
  id: 'boil', primary: 'steam', inputs: [], outputs: [{resource: 'steam', amount: 1}],
  configurations: [{id: 'boiler', machine: 'boiler', operations_per_second: 100,
    operating_points: [{operations_per_second: 0, inputs: [{resource: 'fuel', amount: 8}]},
      {operations_per_second: 100, inputs: [{resource: 'fuel', amount: 10}]}]}],
}]};
const request = {goals: [{resource: 'plate', rate: 14}], external: [{resource: 'ore'}, {resource: 'fuel'}]};
const expected = solveFactory(await loadHighs(), dataset, request);
const bundle = await build({entryPoints: ['kernel/world-worker.js'], bundle: true, write: false, format: 'esm', platform: 'browser'});
const [worldPath, machinesPath] = process.argv.slice(2);
const worldBytes = worldPath && worldPath !== '-' ? new Uint8Array(await readFile(worldPath)) : zipSync({'test/level.dat': gzipSync(Uint8Array.from([10, 0, 0, 0]))});
const worldDataset = machinesPath ? await readDataset(machinesPath) : {machines: []};
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
      '/kernel/structure_bill.js': 'kernel/structure_bill.js',
      '/kernel/construction.js': 'kernel/construction.js',
      '/kernel/flows.js': 'kernel/flows.js',
      '/kernel/goals.js': 'kernel/goals.js',
      '/kernel/startup.js': 'kernel/startup.js',
      '/kernel/capacity.js': 'kernel/capacity.js',
      '/kernel/catalog.js': 'kernel/catalog.js',
      '/kernel/configuration.js': 'kernel/configuration.js',
      '/kernel/reconstruct.js': 'kernel/reconstruct.js',
      '/kernel/boiler.js': 'kernel/boiler.js',
      '/kernel/preview.js': 'kernel/preview.js',
      '/kernel/validation.js': 'kernel/validation.js',
      '/kernel/quantity.js': 'kernel/quantity.js',
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
  const solveInBrowser = (dataset, request) => frame.evaluate(async ({dataset, request}) => {
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
  const actual = await solveInBrowser(dataset, request);
  assert.deepEqual(actual.result, expected);
  assert.deepEqual(actual.phases, ['loading_solver', 'solving']);
  assert.equal(actual.isolated, false);
  assert.deepEqual(errors, []);
  if (worldDataset.identity === 'statech-industry-2:2.0.1') {
    const fixture = constructionCase(worldDataset);
    const result = await solveInBrowser(fixture.dataset, fixture.request);
    verifyConstructionCase(result.result, fixture);
    assert.deepEqual(result.result, solveFactory(await loadHighs(), fixture.dataset, fixture.request));
    console.log('Captured upgrade construction costs match Node in the browser Worker.');
  }
  const boilerId = 'boiling|modern_industrialization:high_pressure_large_steam_boiler|fluid|400|heavy_water';
  if (worldDataset.recipes?.some(recipe => recipe.id === boilerId)) {
    const resource = 'fluid:modern_industrialization:high_pressure_heavy_water_steam';
    const boilerRequest = {goals: [{recipe: boilerId, resource, rate: 2560}], routes: {[resource]: boilerId},
      available_machines: ['modern_industrialization:high_pressure_large_steam_boiler'],
      external: [{resource: 'fluid:modern_industrialization:high_pressure_heavy_water'}, {resource: 'fluid:modern_industrialization:diesel'}]};
    const boiler = await solveInBrowser(worldDataset, boilerRequest);
    assert.deepEqual(boiler.result, solveFactory(await loadHighs(), worldDataset, boilerRequest));
    console.log('The full-catalog high-pressure boiler calculation matches Node in the browser Worker.');
  }
  const pulse = worldDataset.recipes?.find(recipe => recipe.source_id === 'yet_another_industrialization:pulse_detonation_generator/nuke/64');
  if (pulse?.primary === 'energy:eu') {
    const request = {goals: [{recipe: pulse.id, resource: 'energy:eu', rate: 40960000}],
      routes: {'energy:eu': pulse.id}, available_machines: ['yet_another_industrialization:pulse_detonation_generator'],
      external: pulse.inputs.map(flow => ({resource: flow.resource}))};
    const result = await solveInBrowser(worldDataset, request);
    assert.deepEqual(result.result, solveFactory(await loadHighs(), worldDataset, request));
    console.log('The 24.576-billion-EU pulse recipe matches Node in the browser Worker.');
  }
  const steel = worldDataset.recipes?.find(recipe => recipe.primary === 'item:modern_industrialization:steel_ingot' && recipe.process?.type === 'modern_industrialization:blast_furnace');
  if (steel) {
    const request = {goals: [{recipe: steel.id, resource: steel.primary, rate: 1}], available_machines: ['modern_industrialization:electric_blast_furnace'],
      external: [{resource: 'energy:eu'}, ...steel.inputs.map(flow => ({resource: flow.resource ?? flow.choices[0]}))]};
    const result = await solveInBrowser(worldDataset, request);
    assert.equal(result.result.lines[0].configuration_details.structure.status, 'sized');
    assert.deepEqual(result.result, solveFactory(await loadHighs(), worldDataset, request));
    console.log('The complete blast-furnace bill matches Node in the browser Worker.');
  }
  const irradiation = worldDataset.recipes?.find(recipe => recipe.id === 'irradiate|item:modern_industrialization:uranium_fuel_rod|modern_industrialization:beryllium_block');
  if (irradiation) {
    const request = {goals: [{recipe: irradiation.id, resource: irradiation.primary, rate: 0.02}],
      available_machines: ['yet_another_industrialization:nuclear_rod_irradiator'],
      external: [{resource: 'energy:eu'}, {resource: 'item:modern_industrialization:uranium_fuel_rod'}, {resource: 'item:modern_industrialization:beryllium_block'}]};
    const result = await solveInBrowser(worldDataset, request);
    assert.deepEqual(result.result, solveFactory(await loadHighs(), worldDataset, request));
    console.log('The eight-hatch irradiation calculation matches Node in the browser Worker.');
  }
  const waste = worldDataset.recipes?.find(recipe => recipe.id === 'waste_collection|extended_industrialization:electric_waste_collector');
  if (waste) {
    const request = {goals: [{recipe: waste.id, resource: waste.primary, rate: 2000 / 15}],
      available_machines: ['extended_industrialization:electric_waste_collector'], external: [{resource: 'energy:eu'}]};
    const result = await solveInBrowser(worldDataset, request);
    assert.deepEqual(result.result, solveFactory(await loadHighs(), worldDataset, request));
    console.log('Waste collection and its retained live animal match Node in the browser Worker.');
  }
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
