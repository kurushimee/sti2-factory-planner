import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readDataset} from './read_dataset.mjs';
import {endgameRequest} from './endgame_case.mjs';

const root = resolve('builds/web'), artifacts = resolve('.plans/artifacts/certus');
await mkdir(artifacts, {recursive: true});
const dataset = await readDataset('data/statech-2.0.1.json.gz');
const request = endgameRequest(dataset, process.argv[2]);
if (process.argv.includes('--material')) {
  request.time_limit_ms = 180000;
  request.construction = {external: [{resource: 'energy:eu', cost: 0}], work: 0.001};
}
const input = resolve(artifacts, 'endgame-import.json');
await writeFile(input, JSON.stringify({format: 'factory-plan', version: 1, dataset_identity: dataset.identity,
  dataset, request, positions: {}, groups: {}}));
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/embed') {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe src="http://localhost:${server.address().port}/index.html?dataset=example"></iframe>`);
    return;
  }
  const path = resolve(root, '.' + pathname);
  if (!path.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
  try {
    response.setHeader('Content-Type', {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm'}[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, acceptDownloads: true});
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          const result = event.data.result;
          if (result) window.calculationCheck = {status: result.status, lines: result.lines?.length,
            optimal: result.optimal, optimization: result.optimization, search: result.search};
          if (event.data.error) window.calculationFailure = event.data.error;
        });
      }
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error' && /SCRIPT ERROR|Parse Error|ERROR:/.test(message.text())) errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
  let frame = page.frames().find(value => value !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  const chooserPromise = page.waitForEvent('filechooser');
  await page.mouse.click(1124, 40, {delay: 100});
  await (await chooserPromise).setFiles(input);
  try {
    await frame.waitForFunction(() => window.calculationCheck || window.calculationFailure, null, {timeout: request.time_limit_ms + 60000});
  } catch (error) {
    await page.screenshot({path: `${artifacts}/endgame-browser-failure.png`});
    console.log(JSON.stringify({errors, state: await frame.evaluate(() => ({result: window.calculationCheck, error: window.calculationFailure}))}));
    throw error;
  }
  const calculation = await frame.evaluate(() => window.calculationCheck);
  console.log(JSON.stringify({calculation, failure: await frame.evaluate(() => window.calculationFailure), errors}));
  assert.ok(calculation?.lines > 400);
  assert.equal(calculation.status, 'feasible');
  assert.equal(calculation.optimal, false);
  assert.ok(calculation.optimization.relative_gap >= 0);
  const ready = () => new Promise(resolve => {
    const open = indexedDB.open('factory-planner', 1);
    open.onsuccess = () => {
      const get = open.result.transaction('plans').objectStore('plans').get('autosave');
      get.onsuccess = () => { resolve(Object.keys(get.result?.positions ?? {}).length > 400); open.result.close(); };
    };
  });
  await frame.waitForFunction(ready, null, {timeout: 60000});
  await page.mouse.click(950, 92, {delay: 100});
  await page.waitForTimeout(300);
  await page.screenshot({path: `${artifacts}/endgame-browser-details.png`});
  const pending = page.waitForEvent('download');
  await page.mouse.click(1225, 40, {delay: 100});
  const download = await pending;
  const output = `${artifacts}/endgame-export.json`;
  await download.saveAs(output);
  const plan = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(plan.request, request);
  assert.equal(Object.keys(plan.positions).length, calculation.lines);
  assert.equal(plan.dataset_identity, dataset.identity);
  await page.reload();
  frame = page.frames().find(value => value !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  await frame.waitForFunction(() => window.calculationCheck?.lines > 400, null, {timeout: 180000});
  await frame.waitForFunction(ready, null, {timeout: 120000});
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  console.log(`The embedded export calculated, rendered, exported, and persisted ${calculation.lines} endgame allocations with an unproven-cost report.`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
