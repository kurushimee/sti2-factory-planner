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
  const dataset = JSON.parse(await readFile('data/example.json', 'utf8'));
  const plan = {format: 'factory-plan', version: 1, dataset_identity: dataset.identity, dataset,
    request: {goals: [{resource: 'motor', rate: 2}], overhead_eu_per_tick: 5, reserve_fraction: 0.1}, positions: {}, groups: {}};
  const chooser = page.waitForEvent('filechooser');
  await page.mouse.click(1126, 40, {delay: 100});
  await (await chooser).setFiles({name: 'power-plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan))});
  await frame.waitForFunction(() => window.testResult?.status === 'optimal');
  const power = await frame.evaluate(() => window.testResult.power);
  assert(Math.abs(power.net_generation_eu_per_tick - 57) < 1e-7);
  assert(Math.abs(power.generation_related_consumption_eu_per_tick - 57 / 99) < 1e-7);
  assert.equal(power.other_production_consumption_eu_per_tick, 52);
  await page.mouse.click(930, 92, {delay: 100});
  await page.waitForTimeout(250);
  await page.screenshot({path: `${artifacts}/browser-power.png`});
  await page.mouse.move(1260, 680);
  await page.mouse.wheel(0, 650);
  await page.waitForTimeout(250);
  await page.screenshot({path: `${artifacts}/browser-power-notes.png`});
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  console.log('The embedded browser solves fuel feedback and displays the power breakdown.');
} catch (error) {
  await page?.screenshot({path: `${artifacts}/browser-power-failure.png`});
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
