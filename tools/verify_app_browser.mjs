import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const root = resolve('builds/web');
const [worldPath, machineCapturePath, catalogPath, fixtureKind] = process.argv.slice(2);
const structureFixture = fixtureKind === 'structure';
const extendedFixture = fixtureKind === 'extended' || structureFixture;
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
  await page.mouse.click(145, 729, {delay: 100});
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
  if (plan?.request.goals[0]?.rate !== 1) {
    await page.screenshot({path: `${artifacts}/initial-failure.png`});
    console.log(errors);
  }
  assert.equal(plan?.request.goals[0]?.rate, 1);
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
    for (let attempt = 0; attempt < 200; attempt++) {
      const current = await savedPlan();
      if (predicate(current)) return current;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('The expected plan update did not reach browser persistence.');
  };
  const changed = structuredClone(plan);
  changed.request.goals[0].rate = 2;
  if (machineCapturePath && !catalogPath) throw new Error('Application world tests need a complete player catalog as the third argument. Use verify_kernel_browser.mjs for raw captures.');
  await importFile({name: 'changed-plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(changed))});
  plan = await waitPlan(value => value?.request.goals[0]?.rate === 2);
  assert.deepEqual(plan.groups, changed.groups);
  await page.mouse.click(1320, 40);
  await waitPlan(value => value?.request.goals[0]?.rate === 1);
  await page.mouse.click(1390, 40);
  plan = await waitPlan(value => value?.request.goals[0]?.rate === 2);
  await page.mouse.click(532, 92, {delay: 100});
  await new Promise(resolve => setTimeout(resolve, 200));
  await page.mouse.click(955, 182, {delay: 100});
  await page.keyboard.press('Control+a');
  await page.keyboard.type('25', {delay: 100});
  await page.keyboard.press('Tab');
  await page.screenshot({path: `${artifacts}/browser-factory-settings.png`});
  await page.mouse.click(550, 779, {delay: 100});
  plan = await waitPlan(value => value?.request.reserve_fraction === 0.25);
  await page.mouse.click(1320, 40, {delay: 100});
  plan = await waitPlan(value => !value?.request.reserve_fraction);
  await page.screenshot({path: `${artifacts}/before-invalid-import.png`});
  await page.mouse.click(1270, 773, {delay: 100});
  await new Promise(resolve => setTimeout(resolve, 250));
  await page.mouse.click(450, 245, {delay: 100});
  await new Promise(resolve => setTimeout(resolve, 150));
  await page.screenshot({path: `${artifacts}/goal-type-popup.png`});
  await page.mouse.click(420, 306, {delay: 100});
  await new Promise(resolve => setTimeout(resolve, 150));
  await page.mouse.click(420, 542, {delay: 100});
  await page.keyboard.press('Control+a', {delay: 100});
  await page.keyboard.type('3', {delay: 100});
  await page.keyboard.press('Tab', {delay: 100});
  await new Promise(resolve => setTimeout(resolve, 900));
  await page.screenshot({path: `${artifacts}/browser-goal-editor.png`});
  await page.mouse.click(560, 770, {delay: 100});
  plan = await waitPlan(value => value?.request.goals[0]?.kind === 'capacity' && value.request.goals[0].machines === 3);
  assert.equal(plan.request.goals[0].configuration, 'drill');
  await page.mouse.click(1320, 40, {delay: 100});
  plan = await waitPlan(value => value?.request.goals[0]?.rate === 2);
  await page.mouse.click(1270, 773, {delay: 100});
  await new Promise(resolve => setTimeout(resolve, 250));
  await page.mouse.click(450, 245, {delay: 100});
  await page.mouse.click(420, 338, {delay: 100});
  await page.mouse.click(420, 468, {delay: 100});
  await page.keyboard.press('Control+a');
  await page.keyboard.type('1000000000000000000000000000001', {delay: 20});
  await page.keyboard.press('Tab');
  await new Promise(resolve => setTimeout(resolve, 900));
  await page.screenshot({path: `${artifacts}/browser-large-quantity.png`});
  await page.mouse.click(560, 770, {delay: 100});
  plan = await waitPlan(value => value?.request.goals[0]?.quantity === '1000000000000000000000000000001');
  await page.mouse.click(1320, 40, {delay: 100});
  plan = await waitPlan(value => value?.request.goals[0]?.kind !== 'quantity' && value?.request.goals[0]?.rate === 2);
  await importFile({name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{not valid JSON')});
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual(await savedPlan(), plan);
  if (catalogPath) {
    const dataset = JSON.parse(await readFile(catalogPath, 'utf8'));
    const catalogPlan = {format: 'factory-plan', version: 1, dataset_identity: dataset.identity, dataset,
      request: {goals: [], available_machines: ['modern_industrialization:electric_macerator', 'modern_industrialization:replicator', 'ae2:molecular_assembler', ...(structureFixture ? ['modern_industrialization:electric_blast_furnace'] : [])],
        replication: extendedFixture,
        external: ['item:spectrum:copper_cluster', 'energy:eu', 'fluid:modern_industrialization:uu_matter', 'item:minecraft:oak_planks', ...(structureFixture ? ['item:modern_industrialization:uncooked_steel_dust'] : [])].map(resource => ({resource}))}, positions: {}, groups: {}};
    await importFile({name: 'statech-plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(catalogPlan))});
    await waitPlan(value => value?.dataset_identity === dataset.identity);
    await page.mouse.click(1320, 40, {delay: 100});
    await waitPlan(value => value?.dataset_identity === 'example:1');
    await page.mouse.click(1390, 40, {delay: 100});
    await waitPlan(value => value?.dataset_identity === dataset.identity);
  }
  if (worldPath) {
    await importFile(worldPath);
    plan = await waitPlan(value => value?.imported_world?.machines?.length === (structureFixture ? 7 : extendedFixture ? 6 : 4));
    assert.equal(plan.imported_world.providers.length, structureFixture ? 3 : 2);
    assert.deepEqual(plan.imported_world.errors, []);
    if (catalogPath) {
      assert.equal(plan.request.goals[0].kind, 'capacity');
      assert.equal(plan.request.goals[0].machines, 1);
      assert.equal(plan.imported_world.reconstruction.unresolved.length, 3);
      if (extendedFixture) {
        assert.equal(plan.request.goals.length, structureFixture ? 4 : 3);
        assert.deepEqual(plan.request.obtained_resources, ['item:minecraft:iron_ingot']);
        assert.equal(plan.request.ingredients['minecraft:crafting_shaped|minecraft:stick#0'], 'item:minecraft:oak_planks');
        if (structureFixture) assert.equal(plan.imported_world.machines.find(machine => machine.origin.x === 64).structure.status, 'matching_saved_geometry');
      }
    }
    await page.keyboard.press('Escape');
    if (catalogPath && !extendedFixture) {
      await page.mouse.click(1010, 40, {delay: 100});
      await page.mouse.click(370, 267, {delay: 100});
      await page.mouse.click(930, 655, {delay: 100});
      await page.mouse.click(550, 750, {delay: 100});
      plan = await waitPlan(value => value?.request.goals.length === 0 && value.imported_world?.corrections?.['minecraft:overworld|0|100|0']?.goal === false);
      assert.equal(plan.imported_world.reconstruction.unresolved.length, 3);
      await page.keyboard.press('Escape');
    }
    await page.mouse.click(1010, 40, {delay: 100});
    await new Promise(resolve => setTimeout(resolve, 150));
    await page.screenshot({path: `${artifacts}/world-review.png`});
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
  }
  await page.mouse.click(1200, 871, {delay: 100});
  plan = await waitPlan(value => value?.preferences?.sound === true);
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
