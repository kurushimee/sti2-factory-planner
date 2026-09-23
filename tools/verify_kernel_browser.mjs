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
import {constructionCase, verifyConstructionCase, finiteHammerCase, verifyFiniteHammerCase} from './construction_catalog_case.mjs';
import {endgameRequest, verifyEndgame} from './endgame_case.mjs';
import {compileConstructionOrder, solveConstructionOrder} from '../kernel/construction_order.js';

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
      '/kernel/solver.js': 'kernel/solver.js', '/kernel/seed.js': 'kernel/seed.js',
      '/kernel/route_ownership.js': 'kernel/route_ownership.js',
      '/kernel/structure_bill.js': 'kernel/structure_bill.js',
      '/kernel/construction.js': 'kernel/construction.js',
      '/kernel/construction_order.js': 'kernel/construction_order.js',
      '/kernel/material_refinement.js': 'kernel/material_refinement.js',
      '/kernel/numerics.js': 'kernel/numerics.js',
      '/kernel/recipe_preferences.js': 'kernel/recipe_preferences.js',
      '/kernel/flows.js': 'kernel/flows.js',
      '/kernel/power.js': 'kernel/power.js',
      '/kernel/infrastructure.js': 'kernel/infrastructure.js',
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
  const largeFlow = await frame.evaluate(async () => {
    const moduleUrl = new URL('/kernel/flows.js', location.href).href;
    const source = `import {allocateFlows} from ${JSON.stringify(moduleUrl)};
      const lines = Array.from({length: 10000}, (_, index) => ({recipe: 'small' + index, configuration: 'fixed',
        inputs: [{resource: 'energy:eu', rate: 0.1}], outputs: []}));
      lines.push({recipe: 'last', configuration: 'fixed', inputs: [{resource: 'energy:eu', rate: 1e9 - 1000}], outputs: []});
      const result = allocateFlows(lines, [{resource: 'energy:eu', rate: 1e9}], new Map());
      postMessage({connections: result.connections.length, last: result.connections.at(-1).rate,
        retained: result.retained, roundoff: result.flow_roundoff});`;
    const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
    const worker = new Worker(url, {type: 'module'});
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Large flow check timed out.')), 15000);
        worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
        worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
      });
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
  });
  assert.deepEqual(largeFlow, {connections: 10001, last: 1e9 - 1000, retained: [], roundoff: []});
  const solveInBrowser = (dataset, request) => frame.evaluate(async ({dataset, request}) => {
    const worker = new Worker('/kernel/worker.js', {type: 'module'});
    const phases = [];
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker timed out.')), (request.time_limit_ms ?? 15000) + 30000);
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
  const tinyData = {format: 1, resources: [{id: 'ore'}, {id: 'part'}], recipes: [{id: 'tiny', primary: 'part',
    inputs: [{resource: 'ore', amount: 1}], outputs: [{resource: 'part', amount: 1}],
    configurations: [{id: 'bench', machine: 'bench', operations_per_second: 1}]}]};
  for (const rate of [1e-12, 1e-30]) {
    const selection = {goals: [{resource: 'part', rate}], external: [{resource: 'ore'}]};
    const expectedTiny = solveFactory(await loadHighs(), tinyData, selection);
    const tiny = await solveInBrowser(tinyData, selection);
    assert.deepEqual(tiny.result, expectedTiny);
    if (rate === 1e-12) assert.equal(tiny.result.lines[0].machines, 1);
    else assert.equal(tiny.result.status, 'numerical_error');
  }
  console.log('Tiny positive rates and explicit precision failures match Node in the browser Worker.');
  const orderInput = {lines: dataset.recipes.flatMap(recipe => recipe.configurations.map(configuration => ({recipe, configuration}))),
    resources: dataset.resources, request: {construction: {external: [{resource: 'ore'}, {resource: 'fuel'}]}},
    requirements: [{resource: 'plate', amount: 14}]};
  const expectedOrder = solveConstructionOrder(await loadHighs(), compileConstructionOrder(orderInput.lines, orderInput.resources, orderInput.request, orderInput.requirements));
  const orderInBrowser = input => frame.evaluate(async input => {
    const moduleUrl = new URL('/kernel/construction_order.js', location.href).href;
    const solverUrl = new URL('/vendor/highs.mjs', location.href).href;
    const wasmUrl = new URL('/vendor/highs.wasm', location.href).href;
    const source = `import loadHighs from ${JSON.stringify(solverUrl)};
      import {compileConstructionOrder,solveConstructionOrder} from ${JSON.stringify(moduleUrl)};
      self.onmessage = async ({data}) => {
        const highs = await loadHighs({locateFile: () => ${JSON.stringify(wasmUrl)}});
        postMessage(solveConstructionOrder(highs, compileConstructionOrder(data.lines,data.resources,data.request,data.requirements)));
      };`;
    const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
    const worker = new Worker(url, {type: 'module'});
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Construction order check timed out.')), 15000);
        worker.onmessage = event => {clearTimeout(timer); resolve(event.data);};
        worker.onerror = event => {clearTimeout(timer); reject(new Error(event.message));};
        worker.postMessage(input);
      });
    } finally {worker.terminate(); URL.revokeObjectURL(url);}
  }, input);
  const actualOrder = await orderInBrowser(orderInput);
  assert.deepEqual(actualOrder, expectedOrder);
  console.log('Fixed construction quantities and their marginal costs match Node in the browser Worker.');
  const competingOrder = {resources: dataset.resources, requirements: [{resource: 'plate', amount: 2}],
    lines: ['fuel', 'ore'].map(resource => ({recipe: {id: resource, inputs: [{resource, amount: 1}], outputs: [{resource: 'plate', amount: 1}]},
      configuration: {id: resource, operations_per_second: 1}})),
    request: {construction: {external: [{resource: 'fuel', cost: 0, quantity: 1}, {resource: 'ore'}]}}};
  const expectedCompeting = solveConstructionOrder(await loadHighs(), compileConstructionOrder(competingOrder.lines, competingOrder.resources, competingOrder.request, competingOrder.requirements));
  assert.equal(expectedCompeting.status, 'feasible');
  assert.deepEqual(await orderInBrowser(competingOrder), expectedCompeting);
  console.log('Construction route repair and its cost bound match Node in the browser Worker.');
  if (worldDataset.identity === 'statech-industry-2:2.0.1') {
    const fixture = constructionCase(worldDataset);
    const result = await solveInBrowser(fixture.dataset, fixture.request);
    verifyConstructionCase(result.result, fixture);
    assert.deepEqual(result.result, solveFactory(await loadHighs(), fixture.dataset, fixture.request));
    console.log('Captured upgrade construction costs match Node in the browser Worker.');
    const finite = finiteHammerCase(worldDataset);
    const finiteResult = await solveInBrowser(finite.dataset, finite.request);
    verifyFiniteHammerCase(finiteResult.result, finite);
    assert.deepEqual(finiteResult.result, solveFactory(await loadHighs(), finite.dataset, finite.request));
    console.log('Finite construction uses two real iron hammers for 35 plates in both runtimes.');
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
  for (const recipe of worldDataset.recipes?.filter(value => value.type === 'planner:certus_growth') ?? []) {
    const request = {goals: [{recipe: recipe.id, resource: recipe.primary, rate: recipe.outputs[0].amount / 6}],
      available_machines: ['planner:certus_farm'], external: [{resource: 'energy:eu'}],
      replication: false, obtained_resources: recipe.requires_obtained};
    const result = await solveInBrowser(worldDataset, request);
    assert.equal(result.result.lines[0].machines, 2);
    assert.equal(result.result.startup.resources.find(value => value.resource === 'site:flawless_budding_quartz').reusable_stock, 2);
    assert.deepEqual(result.result, solveFactory(await loadHighs(), worldDataset, request));
  }
  if (worldDataset.recipes?.some(value => value.type === 'planner:certus_growth')) console.log('Both certus farms and retained startup stocks match Node in the browser Worker.');
  if (waste) {
    const request = {goals: [{recipe: waste.id, resource: waste.primary, rate: 2000 / 15}],
      available_machines: ['extended_industrialization:electric_waste_collector'], external: [{resource: 'energy:eu'}]};
    const result = await solveInBrowser(worldDataset, request);
    assert.deepEqual(result.result, solveFactory(await loadHighs(), worldDataset, request));
    console.log('Waste collection and its retained live animal match Node in the browser Worker.');
  }
  if (worldDataset.machines?.some(machine => machine.infrastructure?.length)) {
    const request = {goals: [], available_machines: [], external: [{resource: 'energy:eu'}],
      infrastructure: [{machine: 'extended_industrialization:tesla_tower', variant: '4', count: 2,
        energy_hatch: 'modern_industrialization:superconductor_energy_input_hatch', transmit_eu_per_tick: 6144000000}], overhead_eu_per_tick: 5};
    const result = await solveInBrowser(worldDataset, request);
    assert.equal(result.result.power.external_eu_per_tick, 32773);
    assert.equal(result.result.power.infrastructure.entries[0].structure.status, 'sized');
    assert.deepEqual(result.result, solveFactory(await loadHighs(), worldDataset, request));
    request.construction = {round_batches: true, external: result.result.power.infrastructure.entries[0].structure.build_requirements.map(value => ({resource: value.resource, cost: 1}))};
    const built = await solveInBrowser(worldDataset, request);
    assert.equal(built.result.construction.material_cost, 426);
    assert.deepEqual(built.result, solveFactory(await loadHighs(), worldDataset, request));
    console.log('Tesla infrastructure and its loaded limits match Node in the browser Worker.');
  }
  if (worldDataset.route_preferences?.length) {
    const recipe = worldDataset.recipes.find(value => value.id.endsWith('casing/craft/steel_plated_bricks'));
    const selection = {goals: [{resource: recipe.primary, rate: 1}],
      available_machines: ['ae2:molecular_assembler', 'modern_industrialization:assembler'],
      external: [...recipe.inputs.map(flow => ({resource: flow.resource})), {resource: 'energy:eu'}]};
    const preferred = solveFactory(await loadHighs(), worldDataset, selection);
    const actual = await solveInBrowser(worldDataset, selection);
    assert.ok(preferred.lines.some(line => line.recipe === recipe.id && line.route_preference));
    assert.deepEqual(actual.result, preferred);
    console.log('The released equal-material crafting preference matches Node in the browser Worker.');
  }
  if (process.argv.includes('--endgame')) {
    const request = endgameRequest(worldDataset);
    if (process.env.STI2_ENDGAME_BUDGET_MS) {
      const budget = Number(process.env.STI2_ENDGAME_BUDGET_MS);
      if (!Number.isSafeInteger(budget) || budget < 120000 || budget > 600000) {
        throw new Error('The endgame check budget must be 120–600 seconds.');
      }
      request.time_limit_ms = budget;
    }
    const expected = solveFactory(await loadHighs(), worldDataset, request);
    console.log(`Node endgame check: ${expected.status}, ${expected.search?.elapsed_ms ?? 'unknown'} ms, ${request.time_limit_ms} ms budget.`);
    verifyEndgame(worldDataset, request, expected);
    const actual = await solveInBrowser(worldDataset, request);
    verifyEndgame(worldDataset, request, actual.result);
    delete expected.search?.elapsed_ms;
    delete actual.result.search?.elapsed_ms;
    assert.deepEqual(actual.result, expected);
    console.log(`The replicatorless creative-storage plan matches Node in the browser Worker: ${expected.lines.length} allocations, ${expected.status}.`);
  }
  if (process.argv.includes('--blasting')) {
    const recipe = worldDataset.recipes.find(value => value.source_id === 'spectrum:blasting/pure_resources/iron' &&
      value.inputs[1]?.resource === 'item:minecraft:lava_bucket');
    assert.ok(recipe);
    const request = {goals: [{recipe: recipe.id, resource: 'item:minecraft:iron_ingot', rate: 1}],
      available_machines: ['minecraft:blast_furnace'],
      external: [{resource: 'item:spectrum:pure_iron'}, {resource: 'item:minecraft:lava_bucket'}]};
    const expected = solveFactory(await loadHighs(), worldDataset, request);
    const actual = await solveInBrowser(worldDataset, request);
    assert.equal(expected.status, 'optimal');
    assert.equal(expected.lines[0].machines, 5);
    delete expected.search?.elapsed_ms;
    delete actual.result.search?.elapsed_ms;
    assert.deepEqual(actual.result, expected);
    console.log('The loaded blast-furnace plan and whole-fuel startup stock match Node in the browser Worker.');
  }
  if (process.argv.includes('--material')) {
    const request = {...endgameRequest(worldDataset), time_limit_ms: 180000,
      construction: {external: [{resource: 'energy:eu', cost: 0}], work: 0.001}};
    const expected = solveFactory(await loadHighs(), worldDataset, request);
    verifyEndgame(worldDataset, request, expected);
    const actual = await solveInBrowser(worldDataset, request);
    verifyEndgame(worldDataset, request, actual.result);
    delete expected.search?.elapsed_ms;
    delete actual.result.search?.elapsed_ms;
    assert.equal(actual.result.search.method, 'material_cost_refinement');
    assert.ok(actual.phases.includes('construction_verification'));
    assert.deepEqual(actual.result, expected);
    console.log(`The complete material-cost plan matches Node in the browser Worker: ${expected.lines.length} allocations.`);
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
