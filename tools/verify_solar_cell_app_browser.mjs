import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';
import {readDataset} from './read_dataset.mjs';

const root = resolve(process.env.STI2_WEB_ROOT ?? 'builds/web');
const artifacts = resolve('.plans/artifacts/solar-cell');
await mkdir(artifacts, {recursive: true});
const dataset = await readDataset('data/statech-2.0.1.json.gz');
const panel = 'extended_industrialization:lv_solar_panel';
const cell = 'item:extended_industrialization:lv_photovoltaic_cell';
const water = 'fluid:extended_industrialization:distilled_water';
const route = `planner:solar|${panel}|water`;
const origin = {dimension: 'minecraft:overworld', x: 400, y: 250, z: 0};
const key = 'minecraft:overworld|400|250|0';
const supplies = [{resource: cell}, {resource: water}];
const world = {machines: [{id: panel, origin, recipe_id: null,
  facts: {items: [], fluids: [{key: {id: water.slice(6)}, amount: '9'}]}}],
  providers: [], unsupported: [], errors: [], reconstruction: {goals: [], solar_panels: [],
    solar_candidates: [{machine: key, machine_id: panel, origin, enabled: true,
      route_candidates: [route.replace('|water', '|dry'), route], expected_cell: cell,
      saved_cell: null, saved_fluid: {resource: water, amount_mb: '9'},
      assumption: 'A matching replacement cell needs continuous supply; saved water is only stock.'}],
    unresolved: [{machine: key, reason: 'No matching photovoltaic cell is saved in this panel.'}]}};
const plan = {format: 'factory-plan', version: 1, dataset_identity: dataset.identity, dataset,
  request: {goals: [], available_machines: [panel], external: supplies, time_limit_ms: 30000},
  imported_world: world, positions: {}, groups: {}};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/embed') {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe src="http://localhost:${server.address().port}/index.html"></iframe>`);
    return;
  }
  const path = resolve(root, '.' + pathname);
  if (!path.startsWith(root + sep)) {response.writeHead(403); response.end(); return;}
  try {
    response.setHeader('Content-Type', {'.html': 'text/html', '.js': 'text/javascript',
      '.mjs': 'text/javascript', '.wasm': 'application/wasm'}[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch {response.writeHead(404); response.end();}
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser, page;
try {
  browser = await chromium.launch({headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  page = await browser.newPage({viewport: {width: 1280, height: 720}, acceptDownloads: true});
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error' && /SCRIPT ERROR|Parse Error|ERROR:/.test(message.text())) errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
  let frame = page.frames().find(candidate => candidate !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  const savedPlan = () => frame.evaluate(() => new Promise((done, reject) => {
    const opened = indexedDB.open('factory-planner', 1);
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const entry = opened.result.transaction('plans').objectStore('plans').get('autosave');
      entry.onsuccess = () => {done(entry.result); opened.result.close();};
      entry.onerror = () => reject(entry.error);
    };
  }));
  const chooser = page.waitForEvent('filechooser');
  await page.mouse.click(1030, 32, {delay: 100});
  await (await chooser).setFiles({name: 'missing-cell-plan.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(plan))});
  let imported;
  for (let attempt = 0; attempt < 600; attempt++) {
    imported = await savedPlan();
    if (imported?.imported_world?.machines?.length === 1) break;
    await new Promise(done => setTimeout(done, 100));
  }
  assert.equal(imported?.imported_world?.reconstruction?.solar_panels?.length, 0);
  await page.mouse.click(940, 32, {delay: 100});
  await page.screenshot({path: `${artifacts}/browser-missing-cell-review.png`});
  await page.mouse.click(1000, 548, {delay: 100});
  await page.mouse.click(510, 608, {delay: 100});
  let saved;
  for (let attempt = 0; attempt < 600; attempt++) {
    saved = await savedPlan();
    if (saved?.imported_world?.reconstruction?.solar_panels?.length === 1 &&
        Object.keys(saved.positions ?? {}).some(position => position.startsWith(route))) break;
    await new Promise(done => setTimeout(done, 100));
  }
  assert.equal(saved.imported_world.corrections[key].solar_cell_confirmed, true);
  assert.deepEqual(saved.imported_world.reconstruction.unresolved, []);
  assert.equal(saved.imported_world.reconstruction.solar_panels[0].saved_cell, null);
  assert.equal(saved.imported_world.reconstruction.solar_panels[0].cell_evidence, 'player_supply_confirmation');
  assert.deepEqual(saved.request.external, supplies);
  assert.equal(saved.request.installed[route], 1);
  await page.keyboard.press('Escape');
  await page.screenshot({path: `${artifacts}/browser-confirmed-panel.png`});
  const pending = page.waitForEvent('download');
  await page.mouse.click(1110, 32, {delay: 100});
  const download = await pending;
  const portable = JSON.parse(Buffer.concat(await (await download.createReadStream()).toArray()).toString('utf8'));
  assert.equal(portable.imported_world.corrections[key].solar_cell_confirmed, true);
  assert.equal(portable.imported_world.reconstruction.solar_panels[0].saved_cell, null);
  await writeFile(`${artifacts}/confirmed-plan.json`, JSON.stringify(portable));
  await page.reload();
  frame = page.frames().find(candidate => candidate !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  saved = await savedPlan();
  assert.equal(saved.imported_world.corrections[key].solar_cell_confirmed, true);
  assert.equal(saved.request.installed[route], 1);
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  console.log('The embedded export confirmed, planned, exported, and restored a missing-cell solar panel.');
} catch (error) {
  await page?.screenshot({path: `${artifacts}/browser-cell-failure.png`});
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
