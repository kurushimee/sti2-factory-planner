import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const root = resolve('builds/web'), artifacts = resolve('.plans/artifacts/workspace');
const manifest = JSON.parse(await readFile('data/provenance/distribution-manifest.json', 'utf8'));
await mkdir(artifacts, {recursive: true});
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/embed') {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe src="http://localhost:${server.address().port}/index.html"></iframe>`);
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
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error' && /SCRIPT ERROR|Parse Error|ERROR:/.test(message.text())) errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
  let frame = page.frames().find(value => value !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  await page.mouse.click(980, 870, {delay: 100});
  await page.waitForTimeout(300);
  await page.screenshot({path: `${artifacts}/browser-bundled-about.png`});
  await page.keyboard.press('Escape');
  const pending = page.waitForEvent('download');
  await page.mouse.click(1225, 40, {delay: 100});
  const download = await pending;
  const planPath = `${artifacts}/bundled-browser-plan.json`;
  await download.saveAs(planPath);
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  assert.equal(plan.dataset_identity, 'statech-industry-2:2.0.1');
  assert.equal(plan.dataset.recipes.length, manifest.recipes);
  assert.equal(plan.dataset.resources.length, manifest.resources);
  assert.equal(plan.dataset.complete, false);
  assert.equal(plan.request.goals.length, 0);
  await page.mouse.click(230, 818, {delay: 100});
  await frame.waitForFunction(() => new Promise(resolve => {
    const open = indexedDB.open('factory-planner', 1);
    open.onsuccess = () => {
      const get = open.result.transaction('plans').objectStore('plans').get('autosave');
      get.onsuccess = () => { resolve(get.result?.dataset_identity === 'statech-industry-2:2.0.1'); open.result.close(); };
    };
  }), null, {timeout: 60000});
  await page.reload();
  frame = page.frames().find(value => value !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  await page.waitForTimeout(1000);
  await page.screenshot({path: `${artifacts}/browser-bundled-restored.png`});
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  console.log('The embedded export opened, exported, and persisted its bundled StaTech catalog without a player-supplied dataset.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
