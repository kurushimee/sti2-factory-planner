import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const root = resolve('builds/web'), artifacts = resolve('.plans/artifacts/workspace');
await mkdir(artifacts, {recursive: true});
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
let browser, page;
try {
  browser = await chromium.launch({headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  page = await browser.newPage({viewport: {width: 1440, height: 900}, acceptDownloads: true});
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error' && /SCRIPT ERROR|Parse Error|ERROR:/.test(message.text())) errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
  let frame = page.frames().find(value => value !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  await frame.evaluate(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => { if (event.data.result) window.testResult = event.data.result; });
      }
    };
  });
  const dataset = JSON.parse(await readFile('data/construction-example.json', 'utf8'));
  const plan = {format: 'factory-plan', version: 1, dataset_identity: dataset.identity, dataset,
    request: {goals: [{recipe: 'production', resource: 'product', rate: 1}], external: [{resource: 'ore'}]}, positions: {}, groups: {}};
  const chooser = page.waitForEvent('filechooser');
  await page.mouse.click(1126, 40, {delay: 100});
  await (await chooser).setFiles({name: 'construction-plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan))});
  await frame.waitForFunction(() => window.testResult?.lines?.[0]?.recipe === 'production');
  await page.mouse.click(532, 92, {delay: 100});
  await page.waitForTimeout(200);
  await page.mouse.click(525, 120, {delay: 100});
  await page.waitForTimeout(200);
  await page.screenshot({path: `${artifacts}/browser-construction-menu.png`});
  await page.mouse.click(355, 295, {delay: 100});
  await page.waitForTimeout(200);
  await page.mouse.click(380, 166);
  await page.keyboard.type('ore');
  await page.mouse.click(250, 330, {delay: 100});
  await page.mouse.click(460, 210, {delay: 100});
  const fill = async (x, y, value) => {
    await page.mouse.click(x, y, {delay: 100});
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+a', {delay: 70});
    await page.keyboard.type(value, {delay: 70});
    await page.keyboard.press('Tab', {delay: 70});
  };
  await fill(770, 210, '2.5');
  await page.mouse.click(500, 690, {delay: 100});
  await fill(365, 735, '6');
  await fill(670, 735, '2');
  await page.screenshot({path: `${artifacts}/browser-construction-settings.png`});
  await page.mouse.click(550, 780, {delay: 100});
  await frame.waitForFunction(() => window.testResult?.construction?.material_cost === 12, null, {timeout: 15000});
  assert.equal(await frame.evaluate(() => window.testResult.external[0].rate), 1);
  await page.mouse.move(1270, 620);
  await page.mouse.wheel(0, 440);
  await page.waitForTimeout(300);
  await page.screenshot({path: `${artifacts}/browser-construction-inspector.png`});
  await page.mouse.click(1308, 40, {delay: 100});
  await frame.waitForFunction(() => window.testResult?.status === 'optimal' && !window.testResult.construction);
  await page.mouse.click(1380, 40, {delay: 100});
  await frame.waitForFunction(() => window.testResult?.construction?.material_cost === 12);
  const pending = page.waitForEvent('download');
  await page.mouse.click(1210, 40, {delay: 100});
  const download = await pending;
  const savedPath = `${artifacts}/construction-browser-plan.json`;
  await download.saveAs(savedPath);
  const saved = JSON.parse(await readFile(savedPath, 'utf8'));
  assert.deepEqual(saved.request.construction.external, [{resource: 'ore', quantity: 6, cost: 2}]);
  assert.equal(saved.request.construction.weight, 2.5);
  assert.deepEqual(saved.request.external, [{resource: 'ore'}]);
  await page.reload();
  frame = page.frames().find(value => value !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  await page.waitForTimeout(500);
  const restoredDownload = page.waitForEvent('download');
  await page.mouse.click(1210, 40, {delay: 100});
  const restoredPath = `${artifacts}/construction-browser-restored.json`;
  await (await restoredDownload).saveAs(restoredPath);
  const restored = JSON.parse(await readFile(restoredPath, 'utf8'));
  assert.deepEqual(restored.request.construction, saved.request.construction);
  assert.equal(restored.dataset_identity, dataset.identity);
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  console.log('The embedded application edited construction quantities, recalculated, undid, redid, exported, and restored the plan.');
} catch (error) {
  await page?.screenshot({path: `${artifacts}/browser-construction-failure.png`});
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
