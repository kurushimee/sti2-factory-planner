import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const root = resolve('builds/web');
const [worldPath, machineCapturePath] = process.argv.slice(2);
const artifacts = resolve('.plans/artifacts/workspace');
await mkdir(artifacts, {recursive: true});
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/embed') {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe allow="autoplay; fullscreen" src="http://localhost:${server.address().port}/index.html"></iframe>`);
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
    if (/file chooser|user activation|picker/i.test(message.text())) console.log(message.text());
    if (message.type() === 'error' && /SCRIPT ERROR|Parse Error|Invalid/.test(message.text())) errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
  let frame = page.frames().find(frame => frame !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  await page.mouse.click(145, 729);
  const savedPlan = async () => frame.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('factory-planner', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const get = open.result.transaction('plans').objectStore('plans').get('autosave');
      get.onsuccess = () => { resolve(get.result); open.result.close(); };
      get.onerror = () => reject(get.error);
    };
  }));
  await page.waitForFunction(() => true);
  let plan;
  for (let attempt = 0; attempt < 100; attempt++) {
    plan = await savedPlan();
    if (plan?.request.goals.length) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(plan?.request.goals[0].rate, 1);
  await page.mouse.click(425, 92);
  await new Promise(resolve => setTimeout(resolve, 200));
  const grouped = await savedPlan();
  assert.equal(Object.keys(grouped.groups).length, 1);
  await page.screenshot({path: `${artifacts}/browser-group.png`});
  await page.mouse.move(635, 185);
  await page.mouse.down();
  await page.mouse.move(675, 225, {steps: 8});
  await page.mouse.up();
  await new Promise(resolve => setTimeout(resolve, 200));
  plan = await savedPlan();
  const groupId = Object.keys(plan.groups)[0];
  assert.notDeepEqual(plan.groups[groupId].rect, grouped.groups[groupId].rect);
  assert.notDeepEqual(plan.positions['mine_ore|drill'], grouped.positions['mine_ore|drill']);
  const beforeResize = plan;
  const rect = plan.groups[groupId].rect;
  await page.mouse.move(290 + rect[0] + rect[2] - 3, 119 + rect[1] + rect[3] - 3);
  await page.mouse.down();
  await page.mouse.move(290 + rect[0] + rect[2] - 100, 119 + rect[1] + rect[3] - 70, {steps: 8});
  await page.mouse.up();
  await new Promise(resolve => setTimeout(resolve, 200));
  plan = await savedPlan();
  assert.notDeepEqual(plan.groups[groupId].rect, beforeResize.groups[groupId].rect);
  assert.deepEqual(plan.positions, beforeResize.positions);
  const importFile = async payload => {
    const chooser = page.waitForEvent('filechooser');
    await page.mouse.click(1126, 40, {delay: 100});
    await (await chooser).setFiles(payload);
  };
  const waitPlan = async predicate => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = await savedPlan();
      if (predicate(current)) return current;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('The expected plan update did not reach browser persistence.');
  };
  const changed = structuredClone(plan);
  changed.request.goals[0].rate = 2;
  if (machineCapturePath) changed.dataset.machines = JSON.parse(await readFile(machineCapturePath, 'utf8')).machines;
  await importFile({name: 'changed-plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(changed))});
  plan = await waitPlan(value => value?.request.goals[0]?.rate === 2);
  assert.deepEqual(plan.groups, changed.groups);
  await page.mouse.click(1320, 40);
  await waitPlan(value => value?.request.goals[0]?.rate === 1);
  await page.mouse.click(1390, 40);
  plan = await waitPlan(value => value?.request.goals[0]?.rate === 2);
  await page.screenshot({path: `${artifacts}/before-invalid-import.png`});
  await importFile({name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{not valid JSON')});
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual(await savedPlan(), plan);
  if (worldPath) {
    await importFile(worldPath);
    plan = await waitPlan(value => value?.imported_world?.machines?.length === 4);
    assert.equal(plan.imported_world.providers.length, 2);
    assert.deepEqual(plan.imported_world.errors, []);
    await page.keyboard.press('Escape');
  }
  await page.screenshot({path: `${artifacts}/browser.png`});
  const downloadEvent = page.waitForEvent('download');
  await page.mouse.click(1225, 40);
  const download = await downloadEvent;
  const path = `${artifacts}/browser-plan.json`;
  await download.saveAs(path);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), plan);
  await page.reload();
  frame = page.frames().find(frame => frame !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  assert.deepEqual(await savedPlan(), plan);
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  console.log('The embedded Godot export passed goals, group movement and resizing, plan import, undo/redo, malformed-file recovery, download, and IndexedDB reload.');
  if (worldPath) console.log('The exported application also imported the real world ZIP through the browser file chooser.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}


