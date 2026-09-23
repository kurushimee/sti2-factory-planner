import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const root = resolve(process.env.STI2_WEB_ROOT ?? 'builds/web');
const artifacts = resolve('.plans/artifacts/workspace');
await mkdir(artifacts, {recursive: true});
const dataset = JSON.parse(gunzipSync(await readFile('data/statech-2.0.1.json.gz')));
const farm = dataset.recipes.find(recipe => recipe.source_id === 'spectrum:crystallarieum/minecraft/iron'
  && recipe.id.endsWith('|additive:0'));
assert.ok(farm);
const plan = {
  format: 'factory-plan', version: 1, dataset_identity: dataset.identity, dataset,
  request: {
    goals: [{recipe: farm.id, resource: farm.primary, rate: 0.125}],
    replication: false,
    available_machines: ['spectrum:crystallarieum_turtle_farm', 'spectrum:color_picker'],
    external: [
      {resource: 'item:minecraft:raw_iron'},
      {resource: 'item:minecraft:iron_nugget'},
      {resource: 'item:minecraft:brown_dye'},
    ],
  },
  positions: {}, groups: {},
};
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
  const chooser = page.waitForEvent('filechooser');
  await page.mouse.click(1126, 40, {delay: 100});
  await (await chooser).setFiles({name: 'spectrum-growth-plan.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(plan))});
  await frame.waitForFunction(recipe => window.testResult?.lines?.some(line => line.recipe === recipe),
    farm.id, {timeout: 120000});
  let result = await frame.evaluate(() => window.testResult);
  assert.equal(result.status, 'optimal');
  assert.equal(result.lines.find(line => line.recipe === farm.id)?.machines, 1);
  assert.equal(result.lines.find(line => line.machine === 'spectrum:color_picker')?.machines, 1);
  await page.screenshot({path: `${artifacts}/browser-spectrum-growth.png`});
  await frame.waitForFunction(() => new Promise(done => {
    const opened = indexedDB.open('factory-planner', 1);
    opened.onsuccess = () => {
      const saved = opened.result.transaction('plans').objectStore('plans').get('autosave');
      saved.onsuccess = () => {
        done(saved.result?.request.goals?.[0]?.recipe?.includes('crystallarieum/minecraft/iron'));
        opened.result.close();
      };
    };
  }), null, {timeout: 60000});
  const pendingDownload = page.waitForEvent('download');
  await page.mouse.click(1225, 40, {delay: 100});
  const download = await pendingDownload;
  const portable = JSON.parse(Buffer.concat(await (await download.createReadStream()).toArray()).toString('utf8'));
  assert.equal(portable.request.goals[0].recipe, farm.id);
  assert.equal(portable.dataset.recipes.length, dataset.recipes.length);
  await page.reload();
  frame = page.frames().find(candidate => candidate !== page.mainFrame());
  await frame.waitForFunction(recipe => window.testResult?.lines?.some(line => line.recipe === recipe),
    farm.id, {timeout: 120000});
  result = await frame.evaluate(() => window.testResult);
  assert.equal(result.status, 'optimal');
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  console.log('The embedded browser export planned, saved, exported, and restored the Spectrum turtle farm.');
} catch (error) {
  await page?.screenshot({path: `${artifacts}/browser-spectrum-growth-failure.png`});
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
