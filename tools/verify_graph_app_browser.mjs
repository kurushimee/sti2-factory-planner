import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';

const planPath = process.argv[2];
if (!planPath) throw new Error('Supply a portable graph plan.');
const importedPlan = JSON.parse(await readFile(planPath, 'utf8'));
importedPlan.positions = {}; importedPlan.groups = {}; importedPlan.graph_routes = [];
delete importedPlan.view;
const expectedGoal = importedPlan.request.goals[0];
const root = resolve(process.env.STI2_WEB_ROOT ?? 'builds/web');
const artifacts = resolve('.plans/artifacts/graph-arrangement');
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
    if (message.type() === 'error' && /SCRIPT ERROR|Parse Error|ERROR:/.test(message.text())) { errors.push(message.text()); console.log(message.text()); }
  });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          if (event.data.error) { window.workerError = event.data.error; console.error(event.data.error); }
          if (event.data.result?.lines) window.testResult = event.data.result;
          if (event.data.result?.routes) { window.layoutResult = event.data.result; window.layoutRuns = (window.layoutRuns ?? 0) + 1; }
        });
      }
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
  let frame = page.frames().find(candidate => candidate !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  console.log('Browser loaded.');
  await page.screenshot({path: `${artifacts}/browser-loaded.png`});
  const chooser = page.waitForEvent('filechooser');
  await page.mouse.click(1126, 40, {delay: 100});
  await (await chooser).setFiles({name: 'mi-goal-plan.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(importedPlan))});
  console.log('Plan selected.');
  await frame.waitForFunction(() => window.testResult?.lines?.length > 100, null, {timeout: 120000});
  console.log('Production solved.');
  const result = await frame.evaluate(() => window.testResult);
  assert.equal(result.status, 'feasible');
  assert.equal(result.exact_production.status, 'exact');
  assert.deepEqual(result.flow_roundoff, []);
  assert.ok(result.connections.length > result.lines.length);
  await frame.waitForFunction(() => window.workerError || window.layoutResult?.routes?.length > 100, null, {timeout: 180000});
  assert.equal(await frame.evaluate(() => window.workerError), undefined);
  console.log('Layout worker finished.');
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
    if (saved?.request?.goals?.length === 1 && saved.graph_routes?.length > 100) break;
    await new Promise(done => setTimeout(done, 100));
  }
  assert.deepEqual(saved?.request?.goals?.[0], expectedGoal);
  assert.ok(saved.graph_routes.length > result.connections.length);
  console.log('Geometry saved.');
  const before = saved;
  await page.mouse.click(330, 91, {delay: 100});
  console.log('Arrange requested.');
  await frame.waitForFunction(() => window.layoutRuns >= 2, null, {timeout: 180000});
  for (let attempt = 0; attempt < 100; attempt++) {
    saved = await savedPlan();
    if (JSON.stringify(saved.graph_routes) === JSON.stringify((await frame.evaluate(() => window.layoutResult)).routes)) break;
    await new Promise(done => setTimeout(done, 100));
  }
  assert.equal(saved.graph_routes.length, before.graph_routes.length);
  assert.deepEqual(saved.request, before.request);
  await page.screenshot({path: `${artifacts}/browser-arranged-1440.png`});
  await page.mouse.click(835, 91, {delay: 100});
  await page.waitForTimeout(250);
  await page.mouse.click(265, 825, {delay: 100});
  await page.waitForTimeout(250);
  await page.screenshot({path: `${artifacts}/browser-chain-1440.png`});
  await page.setViewportSize({width: 1280, height: 720});
  await page.screenshot({path: `${artifacts}/browser-arranged-1280.png`});
  const pending = page.waitForEvent('download');
  await page.mouse.click(1092, 33, {delay: 100});
  const download = await pending;
  const stream = await download.createReadStream();
  const portable = JSON.parse(Buffer.concat(await stream.toArray()).toString('utf8'));
  assert.deepEqual(portable.request.goals[0], expectedGoal);
  assert.equal(portable.graph_routes.length, saved.graph_routes.length);
  await writeFile(`${artifacts}/browser-plan.json`, JSON.stringify(portable));
  await page.reload();
  frame = page.frames().find(candidate => candidate !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  saved = await savedPlan();
  assert.deepEqual(saved.request.goals[0], expectedGoal);
  assert.deepEqual(saved.graph_routes, portable.graph_routes);
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  console.log(`The embedded application arranged ${result.lines.length} exact production lines and retained ${portable.graph_routes.length} routed flows through export and reload.`);
} catch (error) {
  await page?.screenshot({path: `${artifacts}/browser-graph-failure.png`});
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
