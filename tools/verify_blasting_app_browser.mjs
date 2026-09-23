import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';
import {readDataset} from './read_dataset.mjs';

const archivePath = process.argv[2];
if (!archivePath) throw new Error('Supply the private saved blast-furnace world ZIP.');
const root = resolve(process.env.STI2_WEB_ROOT ?? 'builds/web');
const artifacts = resolve('.plans/artifacts/blasting-import');
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
    const types = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.pck': 'application/octet-stream'};
    response.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
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
  page.on('console', message => {
    if (message.type() === 'error' && /SCRIPT ERROR|Parse Error|Invalid/.test(message.text())) {
      errors.push(message.text());
    }
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
  let frame = page.frames().find(value => value !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  const savedPlan = () => frame.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('factory-planner', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const get = open.result.transaction('plans').objectStore('plans').get('autosave');
      get.onsuccess = () => {resolve(get.result); open.result.close();};
      get.onerror = () => reject(get.error);
    };
  }));
  const dataset = await readDataset('data/statech-2.0.1.json.gz');
  const request = {goals: [], replication: false, available_machines: ['minecraft:blast_furnace'],
    external: ['item:spectrum:pure_iron', 'item:minecraft:coal', 'item:minecraft:lava_bucket'].map(resource => ({resource}))};
  let chooser = page.waitForEvent('filechooser');
  await page.mouse.click(1126, 40, {delay: 100});
  await (await chooser).setFiles({name: 'blast-furnace-plan.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({format: 'factory-plan', version: 1, dataset_identity: dataset.identity,
      dataset, request, positions: {}, groups: {}}))});
  for (let attempt = 0; attempt < 300; attempt++) {
    if ((await savedPlan())?.request?.external?.length === 3) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await savedPlan()).request.external.length, 3);
  chooser = page.waitForEvent('filechooser');
  await page.mouse.click(1126, 40, {delay: 100});
  await (await chooser).setFiles(archivePath);
  let plan;
  for (let attempt = 0; attempt < 300; attempt++) {
    plan = await savedPlan();
    if (plan?.imported_world?.machines?.length === 4) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(plan?.imported_world?.machines?.length, 4);
  assert.equal(plan.imported_world.reconstruction.goals.length, 2);
  assert.equal(plan.imported_world.reconstruction.unresolved.length, 2);
  assert.deepEqual(plan.imported_world.errors, []);
  assert.ok(plan.request.goals.every(goal => goal.kind === 'capacity' && goal.machines === 1));
  assert.ok(plan.imported_world.machines.find(value => value.origin.x === 600).recipe_id.endsWith('fuel:minecraft:coal'));
  assert.ok(plan.imported_world.machines.find(value => value.origin.x === 604).recipe_id.endsWith('fuel:minecraft:lava_bucket'));
  assert.equal(plan.imported_world.machines.find(value => value.origin.x === 612).recipe_candidates.length, 2);
  for (let attempt = 0; attempt < 300; attempt++) {
    plan = await savedPlan();
    if (Object.keys(plan?.positions ?? {}).length >= 2) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(Object.keys(plan.positions).length >= 2, 'The imported goals need a recalculated graph.');
  await page.keyboard.press('Escape');
  await page.mouse.click(1010, 40, {delay: 100});
  await new Promise(resolve => setTimeout(resolve, 300));
  await page.screenshot({path: `${artifacts}/browser-review.png`});
  await page.keyboard.press('Escape');
  await page.reload();
  frame = page.frames().find(value => value !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  assert.equal((await savedPlan()).imported_world.machines.length, 4);
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  console.log('The embedded browser export recalculated the real blast-furnace ZIP and restored its two capacity goals and two corrections.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
