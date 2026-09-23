import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';

const archivePath = process.argv[2];
if (!archivePath) throw new Error('Supply the private charged-storage world ZIP.');
const root = resolve(process.env.STI2_WEB_ROOT ?? 'builds/web');
const artifacts = resolve('.plans/artifacts/storage-import');
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
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error' && /SCRIPT ERROR|Parse Error|ERROR:/.test(message.text())) errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
  let frame = page.frames().find(candidate => candidate !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  const savedPlan = () => frame.evaluate(() => new Promise((done, reject) => {
    const opened = indexedDB.open('factory-planner', 1);
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const entry = opened.result.transaction('plans').objectStore('plans').get('autosave');
      entry.onsuccess = () => {done(entry.result); opened.result.close();};
      entry.onerror = () => reject(entry.error);
    };
  }));
  const chooser = page.waitForEvent('filechooser');
  await page.mouse.click(1126, 40, {delay: 100});
  await (await chooser).setFiles(archivePath);
  let plan;
  for (let attempt = 0; attempt < 400; attempt++) {
    plan = await savedPlan();
    if (plan?.imported_world?.reconstruction?.storage_units?.length === 5 &&
        Object.keys(plan.positions ?? {}).filter(key => key.startsWith('planner:storage|')).length === 5) break;
    await new Promise(done => setTimeout(done, 100));
  }
  assert.equal(plan?.imported_world?.machines?.length, 5);
  assert.deepEqual(plan.imported_world.errors, []);
  assert.deepEqual(plan.imported_world.reconstruction.unresolved, []);
  assert.equal(plan.request.goals.length, 0);
  assert.equal(plan.request.periodic_storage.length, 5);
  assert.ok(Object.values(plan.request.periodic_storage_installed).every(count => count === 1));
  assert.equal(Object.keys(plan.positions).filter(key => key.startsWith('planner:storage|')).length, 5);
  await page.keyboard.press('Escape');
  await page.screenshot({path: `${artifacts}/browser-imported-graph.png`});
  const pending = page.waitForEvent('download');
  await page.mouse.click(1225, 40, {delay: 100});
  const download = await pending;
  const stream = await download.createReadStream();
  const portable = JSON.parse(Buffer.concat(await stream.toArray()).toString('utf8'));
  assert.equal(portable.imported_world.reconstruction.storage_units.length, 5);
  assert.equal(portable.request.periodic_storage.length, 5);
  await page.reload();
  frame = page.frames().find(candidate => candidate !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  plan = await savedPlan();
  assert.equal(plan.imported_world.reconstruction.storage_units.length, 5);
  assert.equal(plan.request.periodic_storage.length, 5);
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  console.log('The embedded export imported, exported, and restored five saved storage units without goals.');
} catch (error) {
  await page?.screenshot({path: `${artifacts}/browser-import-failure.png`});
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
