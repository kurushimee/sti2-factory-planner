import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const root = resolve(process.env.STI2_WEB_ROOT ?? 'builds/web');
const artifacts = resolve('.plans/artifacts/mi-core');
await mkdir(artifacts, {recursive: true});
const dataset = JSON.parse(gunzipSync(await readFile('data/statech-2.0.1.json.gz')));
const stage = dataset.progression[2];
const goalRecipe = 'modern_industrialization:compressor|modern_industrialization:materials/iron/compressor/main';
const alternative = 'modern_industrialization:furnace|minecraft:/iron_ingot_from_smelting_raw_iron_exported_mi_furnace';
assert.ok(dataset.recipes.some(recipe => recipe.id === goalRecipe));
assert.ok(dataset.recipes.some(recipe => recipe.id === alternative));
const plan = {format: 'factory-plan', version: 1, dataset_identity: dataset.identity,
  dataset, request: {goals: [], replication: false,
    available_machines: stage.available_machines, available_upgrades: stage.available_upgrades,
    external: [{resource: 'energy:eu', cost: 0}]}, positions: {}, groups: {}};

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
let browser;
try {
  browser = await chromium.launch({headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
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
  const frame = page.frames().find(candidate => candidate !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  await page.waitForTimeout(1200);
  await page.screenshot({path: `${artifacts}/browser-mi-ready.png`});
  await page.mouse.click(120, 132);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('materials/iron/compressor/main');
  await page.waitForTimeout(250);
  await page.mouse.click(85, 728);
  await frame.waitForFunction(recipe => window.testResult?.lines?.length > 10 &&
    window.testResult.lines.some(line => line.recipe === recipe), goalRecipe,
  {timeout: 120000});
  const fresh = await frame.evaluate(() => window.testResult);
  assert.ok(['optimal', 'feasible'].includes(fresh.status));
  assert.ok(fresh.external.some(flow => flow.resource === 'energy:eu'));
  assert.equal(fresh.lines.some(line => line.outputs.some(flow => flow.resource === 'energy:eu')), false);
  await page.screenshot({path: `${artifacts}/browser-mi-fresh-goal.png`});
  const chooser = page.waitForEvent('filechooser');
  await page.mouse.click(1126, 40);
  await (await chooser).setFiles({name: 'mi-core-plan.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(plan))});
  await frame.waitForFunction(() => window.testResult?.status === 'optimal' &&
    window.testResult?.lines?.length === 0, null, {timeout: 120000});
  await page.mouse.click(120, 132);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('materials/iron/compressor/main');
  await page.waitForTimeout(250);
  await page.mouse.click(85, 728);
  await frame.waitForFunction(recipe => window.testResult?.lines?.length > 10 &&
    window.testResult.lines.some(line => line.recipe === recipe), goalRecipe,
  {timeout: 120000});
  let result = await frame.evaluate(() => window.testResult);
  assert.ok(['optimal', 'feasible'].includes(result.status));
  assert.ok(result.lines.some(line => line.recipe.includes('quarry')));
  await page.screenshot({path: `${artifacts}/browser-mi-goal.png`});
  await page.mouse.click(120, 132);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('iron_ingot_from_smelting_raw_iron');
  await page.waitForTimeout(250);
  await page.mouse.click(205, 728);
  await frame.waitForFunction(recipe => window.testResult?.lines?.some(line => line.recipe === recipe),
    alternative, {timeout: 120000});
  result = await frame.evaluate(() => window.testResult);
  assert.ok(['optimal', 'feasible'].includes(result.status));
  const savedRequest = async () => frame.evaluate(() => new Promise((done, reject) => {
    const opened = indexedDB.open('factory-planner', 1);
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const read = opened.result.transaction('plans').objectStore('plans').get('autosave');
      read.onsuccess = () => { done(read.result?.request); opened.result.close(); };
      read.onerror = () => reject(read.error);
    };
  }));
  let request = await savedRequest();
  assert.equal(request.goals.length, 1);
  assert.equal(request.routes['item:minecraft:iron_ingot'], alternative);
  await page.screenshot({path: `${artifacts}/browser-mi-route.png`});
  await page.mouse.click(205, 728);
  await frame.waitForFunction(async () => {
    const opened = indexedDB.open('factory-planner', 1);
    return new Promise(done => {
      opened.onsuccess = () => {
        const read = opened.result.transaction('plans').objectStore('plans').get('autosave');
        read.onsuccess = () => { done(!read.result?.request.routes?.['item:minecraft:iron_ingot']); opened.result.close(); };
      };
    });
  }, null, {timeout: 120000});
  request = await savedRequest();
  assert.equal(request.goals.length, 1);
  await page.mouse.click(1310, 40);
  await frame.waitForFunction(async recipe => {
    const opened = indexedDB.open('factory-planner', 1);
    return new Promise(done => {
      opened.onsuccess = () => {
        const read = opened.result.transaction('plans').objectStore('plans').get('autosave');
        read.onsuccess = () => { done(read.result?.request.routes?.['item:minecraft:iron_ingot'] === recipe); opened.result.close(); };
      };
    });
  }, alternative, {timeout: 120000});
  assert.deepEqual(errors, []);
  console.log('The embedded web app planned a full MI material chain and restored a route choice with Undo.');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
