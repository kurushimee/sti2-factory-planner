import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const root = resolve(process.env.STI2_WEB_ROOT ?? 'builds/web');
const artifacts = resolve('.plans/artifacts/workspace');
await mkdir(artifacts, {recursive: true});
const dataset = JSON.parse(gunzipSync(await readFile('data/statech-2.0.1.json.gz')));
const panel = 'extended_industrialization:lv_solar_panel';
const storage = 'modern_industrialization:lv_storage_unit';
const solarRecipe = dataset.recipes.find(recipe => recipe.type === 'planner:solar_generation' &&
  recipe.configurations[0].machine === panel && recipe.id.endsWith('|dry'));
assert.ok(solarRecipe);
const request = {
  goals: [{recipe: solarRecipe.id, resource: 'energy:eu', rate: 280}],
  available_machines: [panel, storage],
  periodic_storage: [storage],
  periodic_storage_limits: {[storage]: 1},
  external: [{resource: 'item:extended_industrialization:lv_photovoltaic_cell'}],
};
const plan = {format: 'factory-plan', version: 1, dataset_identity: dataset.identity,
  dataset, request, positions: {}, groups: {}};
await writeFile(`${artifacts}/solar-plan.json`, JSON.stringify(plan));
const server = createServer(async (incoming, outgoing) => {
  const pathname = new URL(incoming.url, 'http://localhost').pathname;
  if (pathname === '/embed') {
    outgoing.setHeader('Content-Type', 'text/html');
    outgoing.end(`<!doctype html><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe src="http://localhost:${server.address().port}/index.html"></iframe>`);
    return;
  }
  const path = resolve(root, '.' + pathname);
  if (!path.startsWith(root + sep)) { outgoing.writeHead(403); outgoing.end(); return; }
  try {
    outgoing.setHeader('Content-Type', {'.html': 'text/html', '.js': 'text/javascript',
      '.mjs': 'text/javascript', '.wasm': 'application/wasm'}[extname(path)] ?? 'application/octet-stream');
    outgoing.end(await readFile(path));
  } catch { outgoing.writeHead(404); outgoing.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser, page;
try {
  browser = await chromium.launch({headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  page = await browser.newPage({viewport: {width: 1440, height: 900}, acceptDownloads: true});
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error' && /SCRIPT ERROR|Parse Error|ERROR:/.test(message.text())) {
      errors.push(message.text());
    }
  });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          if (event.data.result) window.testResult = event.data.result;
        });
      }
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
  let frame = page.frames().find(candidate => candidate !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  await frame.evaluate(() => {
    const read = window.plannerBridge.readFileChunk;
    window.plannerBridge.readFileChunk = function () {
      const response = read.call(this);
      if (response) window.testImportedCharacters = JSON.parse(response).characters;
      return response;
    };
  });
  let chooser = page.waitForEvent('filechooser');
  await page.mouse.click(1126, 40, {delay: 100});
  await (await chooser).setFiles({name: 'solar-plan.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(plan))});
  await frame.waitForFunction(() => window.testImportedCharacters > 0, null, {timeout: 60000});
  await page.screenshot({path: `${artifacts}/browser-solar-import-progress.png`});
  await page.mouse.click(1340, 870, {delay: 100});
  await page.waitForTimeout(500);
  assert.equal(await frame.evaluate(() => window.testResult), undefined);
  await page.screenshot({path: `${artifacts}/browser-solar-import-cancelled.png`});
  chooser = page.waitForEvent('filechooser');
  await page.mouse.click(1126, 40, {delay: 100});
  await (await chooser).setFiles({name: 'solar-plan.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(plan))});
  await frame.waitForFunction(() => window.testResult?.periodic_power?.storage?.[0]?.machines === 1,
    null, {timeout: 120000});
  let result = await frame.evaluate(() => window.testResult);
  assert.equal(result.status, 'optimal');
  assert.equal(result.lines.find(line => line.machine === panel)?.machines, 1);
  assert.equal(result.periodic_power.event_buffer_eu, 64);
  assert.ok(result.periodic_power.storage[0].initial_charge_eu >= 64);
  await page.screenshot({path: `${artifacts}/browser-solar-graph.png`});
  await page.mouse.click(930, 92, {delay: 100});
  await page.waitForTimeout(300);
  await page.screenshot({path: `${artifacts}/browser-solar-power.png`});
  await frame.waitForFunction(() => new Promise(done => {
    const opened = indexedDB.open('factory-planner', 1);
    opened.onsuccess = () => {
      const saved = opened.result.transaction('plans').objectStore('plans').get('autosave');
      saved.onsuccess = () => {
        done(saved.result?.request.periodic_storage?.[0] ===
          'modern_industrialization:lv_storage_unit');
        opened.result.close();
      };
    };
  }), null, {timeout: 60000});
  const pendingDownload = page.waitForEvent('download');
  await page.mouse.click(1225, 40, {delay: 100});
  const download = await pendingDownload;
  const portable = JSON.parse(Buffer.concat(await (await download.createReadStream()).toArray()).toString('utf8'));
  assert.deepEqual(portable.request.periodic_storage, [storage]);
  assert.equal(portable.request.periodic_storage_limits[storage], 1);
  await page.reload();
  frame = page.frames().find(candidate => candidate !== page.mainFrame());
  await frame.waitForFunction(() => window.testResult?.periodic_power?.storage?.[0]?.machines === 1,
    null, {timeout: 120000});
  result = await frame.evaluate(() => window.testResult);
  assert.equal(result.status, 'optimal');
  assert.equal(result.periodic_power.event_buffer_eu, 64);
  const example = JSON.parse(await readFile('data/example.json', 'utf8'));
  const examplePlan = {format: 'factory-plan', version: 1, dataset_identity: example.identity,
    dataset: example, request: {goals: []}, positions: {}, groups: {}};
  chooser = page.waitForEvent('filechooser');
  await page.mouse.click(1126, 40, {delay: 100});
  await (await chooser).setFiles({name: 'example-plan.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(examplePlan))});
  await frame.waitForFunction(() => new Promise(done => {
    const opened = indexedDB.open('factory-planner', 1);
    opened.onsuccess = () => {
      const saved = opened.result.transaction('plans').objectStore('plans').get('autosave');
      saved.onsuccess = () => {
        done(saved.result?.dataset_identity === 'example:1');
        opened.result.close();
      };
    };
  }), null, {timeout: 60000});
  const exampleDownload = page.waitForEvent('download');
  await page.mouse.click(1225, 40, {delay: 100});
  const exampleStream = await (await exampleDownload).createReadStream();
  const changed = JSON.parse(Buffer.concat(await exampleStream.toArray()).toString('utf8'));
  assert.equal(changed.dataset_identity, example.identity);
  assert.deepEqual(changed.dataset, example);
  const hosted = await browser.newPage({viewport: {width: 1440, height: 900}});
  await hosted.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          if (event.data.result) window.testResult = event.data.result;
        });
      }
    };
  });
  await hosted.goto(`http://localhost:${server.address().port}/index.html`);
  await hosted.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  const hostedChooser = hosted.waitForEvent('filechooser');
  await hosted.mouse.click(1126, 40, {delay: 100});
  await (await hostedChooser).setFiles({name: 'solar-plan.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(plan))});
  await hosted.waitForFunction(() => window.testResult?.periodic_power?.storage?.[0]?.machines === 1,
    null, {timeout: 120000});
  await hosted.screenshot({path: `${artifacts}/browser-solar-hosted.png`});
  await hosted.close();
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  console.log('Hosted and embedded exports imported a full catalog; cancellation, restoration, and another dataset passed.');
} catch (error) {
  await page?.screenshot({path: `${artifacts}/browser-solar-failure.png`});
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
