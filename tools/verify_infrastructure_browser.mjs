import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readDataset} from './read_dataset.mjs';

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
  const dataset = await readDataset('data/statech-2.0.1.json.gz');
  const plan = {format: 'factory-plan', version: 1, dataset_identity: dataset.identity, dataset,
    request: {goals: [], available_machines: [], external: [{resource: 'energy:eu'}], overhead_eu_per_tick: 5}, positions: {}, groups: {}};
  const chooser = page.waitForEvent('filechooser');
  await page.mouse.click(1126, 40, {delay: 100});
  await (await chooser).setFiles({name: 'power-plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan))});
  await frame.waitForFunction(() => window.testResult?.status === 'optimal');
  await page.mouse.click(532, 92, {delay: 100});
  await page.waitForTimeout(250);
  await page.mouse.click(525, 165, {delay: 100});
  await page.waitForTimeout(200);
  await page.screenshot({path: `${artifacts}/browser-infrastructure-menu.png`});
  await page.mouse.click(350, 365, {delay: 100});
  await page.waitForTimeout(250);
  await page.screenshot({path: `${artifacts}/browser-infrastructure-category.png`});
  await page.mouse.click(250, 332, {delay: 100});
  await page.mouse.click(400, 645, {delay: 100});
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+a', {delay: 70});
  await page.keyboard.type('2', {delay: 70});
  await page.keyboard.press('Tab', {delay: 70});
  await page.mouse.click(400, 735, {delay: 100});
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+a', {delay: 70});
  await page.keyboard.type('1000', {delay: 70});
  await page.keyboard.press('Tab', {delay: 70});
  await page.screenshot({path: `${artifacts}/browser-infrastructure-settings.png`});
  await page.mouse.click(550, 780, {delay: 100});
  await frame.waitForFunction(() => window.testResult?.power?.infrastructure?.total_eu_per_tick === 133, null, {timeout: 30000});
  const power = await frame.evaluate(() => window.testResult.power);
  assert.equal(power.external_eu_per_tick, 133);
  assert.equal(power.infrastructure.entries[0].structure.build_requirements.find(value => value.resource === 'item:modern_industrialization:lv_energy_input_hatch').amount, 5);
  await page.mouse.click(930, 92, {delay: 100});
  await page.mouse.move(1260, 680);
  await page.mouse.wheel(0, 480);
  await page.waitForTimeout(250);
  await page.screenshot({path: `${artifacts}/browser-infrastructure-power.png`});
  const pending = page.waitForEvent('download');
  await page.mouse.click(1210, 40, {delay: 100});
  const savedPath = `${artifacts}/infrastructure-browser-plan.json`;
  await (await pending).saveAs(savedPath);
  const saved = JSON.parse(await readFile(savedPath, 'utf8'));
  assert.deepEqual(saved.request.infrastructure, [{machine: 'extended_industrialization:tesla_tower', variant: '0', count: 2,
    energy_hatch: 'modern_industrialization:lv_energy_input_hatch', transmit_eu_per_tick: 1000}]);
  await page.reload();
  frame = page.frames().find(value => value !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  await page.waitForTimeout(1500);
  const restoredDownload = page.waitForEvent('download');
  await page.mouse.click(1210, 40, {delay: 100});
  const restoredPath = `${artifacts}/infrastructure-browser-restored.json`;
  await (await restoredDownload).saveAs(restoredPath);
  assert.deepEqual(JSON.parse(await readFile(restoredPath, 'utf8')).request.infrastructure, saved.request.infrastructure);
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  console.log('The embedded browser edits Tesla counts, calculates drain, and restores the exported infrastructure plan.');
} catch (error) {
  await page?.screenshot({path: `${artifacts}/browser-infrastructure-failure.png`});
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
