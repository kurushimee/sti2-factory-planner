import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';

const planPath = process.argv[2];
if (!planPath) throw new Error('Supply the verified portable late MI plan.');
const root = resolve(process.env.STI2_WEB_ROOT ?? 'builds/web');
const artifacts = resolve('.plans/artifacts/mi-late');
await mkdir(artifacts, {recursive: true});
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
  page = await browser.newPage({viewport: {width: 1440, height: 900}, acceptDownloads: true});
  page.setDefaultTimeout(180000);
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
  await (await chooser).setFiles(planPath);
  await frame.waitForFunction(() => window.testResult?.lines?.length > 400, null, {timeout: 120000});
  const result = await frame.evaluate(() => window.testResult);
  assert.equal(result.status, 'feasible');
  assert.equal(result.exact_production.status, 'exact');
  assert.deepEqual(result.flow_roundoff, []);
  assert.equal(result.search.method, 'catalog_seed_refinement');
  assert.ok(result.connections.length > 1300);
  assert.ok(result.lines.every(line => line.operations_per_second_exact && line.capacity_per_second_exact));
  const savedPlan = () => frame.evaluate(() => new Promise((done, reject) => {
    const opened = indexedDB.open('factory-planner', 1);
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const entry = opened.result.transaction('plans').objectStore('plans').get('autosave');
      entry.onsuccess = () => {done(entry.result); opened.result.close();};
      entry.onerror = () => reject(entry.error);
    };
  }));
  let saved;
  for (let attempt = 0; attempt < 900; attempt++) {
    saved = await savedPlan();
    if (saved?.request?.goals?.length === 1 && Object.keys(saved.positions ?? {}).length > 400) break;
    await new Promise(done => setTimeout(done, 100));
  }
  assert.equal(saved?.request?.goals?.[0]?.rate, 0.02);
  assert.ok(Object.keys(saved.positions).length > 400);
  await page.screenshot({path: `${artifacts}/browser-quantum-1440.png`});
  await page.setViewportSize({width: 1280, height: 720});
  await page.screenshot({path: `${artifacts}/browser-quantum-1280.png`});
  const pending = page.waitForEvent('download');
  await page.mouse.click(1092, 33, {delay: 100});
  const download = await pending;
  const stream = await download.createReadStream();
  const portable = JSON.parse(Buffer.concat(await stream.toArray()).toString('utf8'));
  assert.equal(portable.request.goals[0].rate, 0.02);
  assert.ok(Object.keys(portable.positions).length > 400);
  await page.reload();
  frame = page.frames().find(candidate => candidate !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  saved = await savedPlan();
  assert.equal(saved.request.goals[0].rate, 0.02);
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  console.log(`The embedded application planned, exported, and restored ${result.lines.length} exact late MI lines.`);
} catch (error) {
  await page?.screenshot({path: `${artifacts}/browser-quantum-failure.png`});
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
