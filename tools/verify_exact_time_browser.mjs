import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const root = resolve(process.env.STI2_WEB_ROOT ?? 'builds/web');
const artifacts = resolve('.plans/artifacts/exact-time');
await mkdir(artifacts, {recursive: true});
const dataset = {format: 1, identity: 'exact-time:1', name: 'Exact time check',
  resources: [{id: 'ore'}, {id: 'part'}],
  recipes: [{id: 'make', name: 'Make a part', primary: 'part', inputs: [{resource: 'ore', amount: 1}],
    outputs: [{resource: 'part', amount: 1}],
    configurations: [{id: 'bench', machine: 'Workbench', operations_per_second: 2}]}]};
const plan = {format: 'factory-plan', version: 1, dataset_identity: dataset.identity, dataset,
  request: {goals: [{kind: 'quantity', recipe: 'make', resource: 'part', rate: 2,
    quantity: '1000000000000000000000000000001'}], external: [{resource: 'ore'}]},
  positions: {}, groups: {}};
const server = createServer(async (incoming, outgoing) => {
  const pathname = new URL(incoming.url, 'http://localhost').pathname;
  if (pathname === '/embed') {
    outgoing.setHeader('Content-Type', 'text/html');
    outgoing.end(`<!doctype html><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe src="http://localhost:${server.address().port}/index.html?dataset=example"></iframe>`);
    return;
  }
  const path = resolve(root, '.' + pathname);
  if (!path.startsWith(root + sep)) {outgoing.writeHead(403); outgoing.end(); return;}
  try {
    outgoing.setHeader('Content-Type', {'.html': 'text/html', '.js': 'text/javascript',
      '.mjs': 'text/javascript', '.wasm': 'application/wasm'}[extname(path)] ?? 'application/octet-stream');
    outgoing.end(await readFile(path));
  } catch {outgoing.writeHead(404); outgoing.end();}
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser, page;
try {
  browser = await chromium.launch({headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  page = await browser.newPage({viewport: {width: 1440, height: 900}});
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error' && /SCRIPT ERROR|Parse Error|ERROR:/.test(message.text())) errors.push(message.text());
  });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          if (event.data.result) window.exactTimeResult = event.data.result;
          if (event.data.error) window.exactTimeError = event.data.error;
        });
      }
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
  const frame = page.frames().find(candidate => candidate !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  const chooser = page.waitForEvent('filechooser');
  await page.mouse.click(1126, 40, {delay: 100});
  await (await chooser).setFiles({name: 'exact-time.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(plan))});
  await frame.waitForFunction(() => window.exactTimeResult?.targets?.[0]?.time_display || window.exactTimeError,
    null, {timeout: 30000});
  assert.equal(await frame.evaluate(() => window.exactTimeError), undefined);
  const target = (await frame.evaluate(() => window.exactTimeResult)).targets[0];
  assert.equal(target.time_display, '1,000,000,000,000,000,000,000,000,000,001/2 seconds');
  assert.deepEqual(target.steady_production_seconds_exact,
    {numerator: '1000000000000000000000000000001', denominator: '2'});
  assert.equal(target.steady_production_seconds, null);
  await page.mouse.click(1265, 773, {delay: 100});
  await page.waitForTimeout(500);
  await page.screenshot({path: `${artifacts}/browser-exact-time.png`});
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  console.log('The embedded browser application retains the exact finite-goal ratio and opens its goal editor.');
} catch (error) {
  await page?.screenshot({path: `${artifacts}/browser-exact-time-failure.png`});
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
