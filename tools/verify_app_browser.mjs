import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const root = resolve(process.env.STI2_WEB_ROOT ?? 'builds/web');
const [worldPath, machineCapturePath, catalogPath, fixtureKind] = process.argv.slice(2);
const arrayFixture = fixtureKind === 'arrays';
const teslaFixture = fixtureKind === 'tesla' || arrayFixture;
const irradiationFixture = fixtureKind === 'irradiation' || teslaFixture;
const structureFixture = fixtureKind === 'structure' || irradiationFixture;
const extendedFixture = fixtureKind === 'extended' || structureFixture;
const artifacts = resolve('.plans/artifacts/workspace');
await mkdir(artifacts, {recursive: true});
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/embed') {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe allow="autoplay; fullscreen" src="http://localhost:${server.address().port}/index.html?dataset=example"></iframe>`);
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
  await page.mouse.click(85, 729, {delay: 100});
  const savedRecord = async (key, compact = false) => frame.evaluate(({key, compact}) => new Promise((resolve, reject) => {
    const open = indexedDB.open('factory-planner', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const get = open.result.transaction('plans').objectStore('plans').get(key);
      get.onsuccess = () => {
        const result = get.result;
        if (!compact && result?.dataset_ref && !result.dataset) {
          const cached = open.result.transaction('plans').objectStore('plans').get(`dataset:${result.dataset_ref}`);
          cached.onsuccess = () => { result.dataset = cached.result; delete result.dataset_ref; resolve(result); open.result.close(); };
          cached.onerror = () => reject(cached.error);
          return;
        }
        if (compact && result) delete result.dataset;
        resolve(result); open.result.close();
      };
      get.onerror = () => reject(get.error);
    };
  }), {key, compact});
  const savedPlan = async (compact = false) => {
    const plan = await savedRecord('autosave', compact);
    const view = await savedRecord('workspace-view', true);
    if (plan && view?.dataset_identity === plan.dataset_identity) plan.view = view.view;
    return plan;
  };
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
  await new Promise(resolve => setTimeout(resolve, 800));
  await page.mouse.click(425, 92, {delay: 100});
  await new Promise(resolve => setTimeout(resolve, 200));
  const grouped = await savedPlan();
  assert.equal(Object.keys(grouped.groups).length, 1);
  const groupId = Object.keys(grouped.groups)[0];
  assert.ok(groupId);
  const screenPoint = (x, y, view) => [290 + x * view.zoom - view.scroll[0], 119 + y * view.zoom - view.scroll[1]];
  const groupRect = grouped.groups[groupId].rect;
  const titlePoint = screenPoint(groupRect[0] + groupRect[2] / 2, groupRect[1] + 16, grouped.view);
  await page.screenshot({path: `${artifacts}/browser-group.png`});
  await page.mouse.move(...titlePoint);
  await page.mouse.down();
  await page.mouse.move(titlePoint[0] + 40, titlePoint[1] - 40, {steps: 8});
  await page.mouse.up();
  await new Promise(resolve => setTimeout(resolve, 200));
  plan = await savedPlan();
  await page.screenshot({path: `${artifacts}/browser-group-after-drag.png`});
  assert.notDeepEqual(plan.groups[groupId].rect, grouped.groups[groupId].rect);
  assert.notDeepEqual(plan.positions['mine_ore|drill'], grouped.positions['mine_ore|drill']);
  const beforeResize = plan;
  await page.mouse.click(382, 145);
  await page.mouse.click(382, 145);
  await new Promise(resolve => setTimeout(resolve, 1000));
  await page.screenshot({path: `${artifacts}/browser-group-zoom.png`});
  const zoomed = await savedPlan();
  const rect = plan.groups[groupId].rect;
  const corner = screenPoint(rect[0] + rect[2] - 3, rect[1] + rect[3] - 3, zoomed.view);
  assert.ok(corner[0] > 290 && corner[0] < 1100 && corner[1] > 119 && corner[1] < 798);
  await page.mouse.move(...corner);
  await page.mouse.down();
  await page.mouse.move(corner[0] - 70, corner[1] - 45, {steps: 8});
  await page.mouse.up();
  await new Promise(resolve => setTimeout(resolve, 200));
  plan = await savedPlan();
  assert.notDeepEqual(plan.groups[groupId].rect, beforeResize.groups[groupId].rect);
  assert.deepEqual(plan.positions, beforeResize.positions);
  await page.mouse.click(1270, 773, {delay: 100});
  await new Promise(resolve => setTimeout(resolve, 150));
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Ore supply');
  await page.keyboard.press('Enter');
  await new Promise(resolve => setTimeout(resolve, 200));
  plan = await savedPlan();
  assert.equal(plan.groups[groupId].title, 'Ore supply');
  await page.mouse.click(425, 92);
  await new Promise(resolve => setTimeout(resolve, 200));
  plan = await savedPlan();
  assert.equal(Object.keys(plan.groups).length, 2);
  const orePosition = plan.positions['mine_ore|drill'];
  await page.mouse.click(...screenPoint(orePosition[0] + 120, orePosition[1] + 16, plan.view), {delay: 100});
  const importFile = async payload => {
    if (payload.buffer?.length > 50 * 1024 * 1024) {
      const path = `${artifacts}/large-import.json`;
      await writeFile(path, payload.buffer);
      payload = path;
    }
    const chooser = page.waitForEvent('filechooser');
    await page.mouse.click(1126, 40, {delay: 100});
    await (await chooser).setFiles(payload);
  };
  const waitPlan = async predicate => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const current = await savedPlan(true);
      if (predicate(current)) return savedPlan();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await page.screenshot({path: `${artifacts}/persistence-failure.png`});
    throw new Error(`The expected plan update did not reach browser persistence: ${predicate}`);
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
  await page.mouse.click(480, 120, {delay: 100});
  await new Promise(resolve => setTimeout(resolve, 150));
  await page.screenshot({path: `${artifacts}/browser-progression-menu.png`});
  await page.keyboard.press('ArrowDown', {delay: 100});
  await page.keyboard.press('ArrowDown', {delay: 100});
  await page.keyboard.press('ArrowDown', {delay: 100});
  await page.keyboard.press('Enter', {delay: 100});
  await new Promise(resolve => setTimeout(resolve, 150));
  await page.mouse.click(813, 120, {delay: 100});
  await page.mouse.click(955, 405, {delay: 100});
  await page.keyboard.press('Control+a');
  await page.keyboard.type('2', {delay: 100});
  await page.keyboard.press('Tab');
  await page.screenshot({path: `${artifacts}/browser-factory-settings.png`});
  await page.mouse.click(550, 779, {delay: 100});
  plan = await waitPlan(value => value?.request.weights?.machines === 2);
  assert.equal(plan.request.reserve_fraction, 0);
  assert.equal(plan.request.progression_preset, 'example:all');
  await page.mouse.click(1320, 40, {delay: 100});
  plan = await waitPlan(value => value?.request.weights?.machines !== 2);
  assert.equal(plan.request.progression_preset, undefined);
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
      request: {goals: [], available_machines: ['modern_industrialization:electric_macerator', 'modern_industrialization:replicator', 'ae2:molecular_assembler', ...(structureFixture ? ['modern_industrialization:electric_blast_furnace'] : []), ...(irradiationFixture ? ['yet_another_industrialization:nuclear_rod_irradiator'] : [])],
        replication: extendedFixture,
        external: [...(arrayFixture ? ['fluid:modern_industrialization:crude_oil'] : []), 'item:spectrum:copper_cluster', 'energy:eu', 'fluid:modern_industrialization:uu_matter', 'item:minecraft:oak_planks', ...(structureFixture ? ['item:modern_industrialization:uncooked_steel_dust'] : []), ...(irradiationFixture ? ['item:modern_industrialization:uranium_fuel_rod', 'item:modern_industrialization:beryllium_block'] : [])].map(resource => ({resource}))}, positions: {}, groups: {}};
    await importFile({name: 'statech-plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(catalogPlan))});
    await waitPlan(value => value?.dataset_identity === dataset.identity);
    await page.mouse.click(1320, 40, {delay: 100});
    await waitPlan(value => value?.dataset_identity === 'example:1');
    await page.mouse.click(1390, 40, {delay: 100});
    await waitPlan(value => value?.dataset_identity === dataset.identity);
  }
  if (worldPath) {
    await importFile(worldPath);
    plan = await waitPlan(value => value?.imported_world?.machines?.length === (arrayFixture ? 12 : teslaFixture ? 10 : irradiationFixture ? 9 : structureFixture ? 7 : extendedFixture ? 6 : 4));
    assert.equal(plan.imported_world.providers.length, structureFixture ? 3 : 2);
    assert.deepEqual(plan.imported_world.errors, []);
    if (teslaFixture) {
      assert.equal(plan.request.infrastructure.length, 1);
      assert.equal(plan.request.infrastructure[0].energy_hatch, 'modern_industrialization:lv_energy_input_hatch');
      assert.equal(plan.request.infrastructure[0].imported_hatches.length, 7);
      assert.equal(plan.request.infrastructure[0].transmit_eu_per_tick, 1536);
    }
    if (catalogPath) {
      assert.equal(plan.request.goals[0].kind, 'capacity');
      assert.equal(plan.request.goals[0].machines, 1);
      assert.equal(plan.imported_world.reconstruction.unresolved.length, irradiationFixture ? 4 : 3);
      if (extendedFixture) {
        assert.equal(plan.request.goals.length, arrayFixture ? 7 : irradiationFixture ? 5 : structureFixture ? 4 : 3);
        if (arrayFixture) {
          plan = await waitPlan(value => value?.request.goals.every(goal => Object.hasOwn(value.positions, `${goal.recipe}|${goal.configuration}`)));
          for (const x of [320, 384]) {
            const assigned = plan.imported_world.reconstruction.assignments.find(value => value.origin.x === x);
            assert.equal(assigned.setup.contained_count, 8);
            assert.equal(assigned.setup.upgrade_count, 4);
            assert(plan.request.goals.some(value => value.configuration === assigned.configuration.id));
          }
        }
        if (irradiationFixture) {
          const goal = plan.request.goals.find(value => value.recipe.startsWith('irradiate|'));
          assert.equal(goal.machines, 1);
          assert.match(goal.configuration, /hatches:8$/);
        }
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
  if (catalogPath) {
    await page.mouse.click(532, 92, {delay: 100});
    await new Promise(resolve => setTimeout(resolve, 200));
    await page.mouse.click(480, 165, {delay: 100});
    await new Promise(resolve => setTimeout(resolve, 150));
    for (let index = 0; index < 6; index++) await page.keyboard.press('ArrowDown', {delay: 100});
    await page.keyboard.press('Enter', {delay: 100});
    await page.mouse.click(420, 210, {delay: 100});
    await page.keyboard.type('bronze');
    await new Promise(resolve => setTimeout(resolve, 150));
    await page.mouse.click(250, 330, {delay: 100});
    await page.screenshot({path: `${artifacts}/browser-hatch-settings.png`});
    await page.mouse.click(550, 779, {delay: 100});
    plan = await waitPlan(value => Array.isArray(value?.request.available_parts));
    assert.equal(plan.request.available_parts.includes('modern_industrialization:bronze_item_input_hatch'), false);
    assert.equal(plan.request.available_parts.includes('modern_industrialization:steel_item_input_hatch'), true);
    await page.mouse.click(1320, 40, {delay: 100});
    await waitPlan(value => !value?.request.available_parts);
  }
  const previousView = await savedRecord('workspace-view');
  const planBeforeView = await savedRecord('autosave');
  await page.mouse.move(810, 425);
  await page.mouse.down({button: 'middle'});
  await page.mouse.move(925, 460, {steps: 8});
  await page.mouse.up({button: 'middle'});
  await page.mouse.click(482, 147, {delay: 100});
  await new Promise(resolve => setTimeout(resolve, 750));
  const viewRecord = await savedRecord('workspace-view');
  assert.notDeepEqual(viewRecord.view.scroll, previousView.view.scroll);
  assert.notEqual(viewRecord.view.zoom, previousView.view.zoom);
  assert.deepEqual(await savedRecord('autosave'), planBeforeView);
  await page.mouse.click(1200, 871, {delay: 100});
  plan = await waitPlan(value => value?.preferences?.sound === true);
  assert.deepEqual(plan.view, viewRecord.view);
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
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.deepEqual((await savedRecord('workspace-view')).view, viewRecord.view);
  await page.screenshot({path: `${artifacts}/browser-view-restored.png`});
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  console.log('The embedded Godot export passed goals, group movement and resizing, plan import, undo/redo, malformed-file recovery, download, and IndexedDB reload.');
  if (worldPath) console.log('The exported application also imported the real world ZIP through the browser file chooser.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
