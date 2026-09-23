import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';

const [archive, fixturePath] = process.argv.slice(2);
if (!archive || !fixturePath) throw new Error('Supply the controlled world ZIP and runtime rotation fixture report.');
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'));
const root = resolve('builds/web');
const artifacts = resolve('.plans/artifacts/world-import');
await mkdir(artifacts, {recursive: true});
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/embed') {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<html><body style="margin:0"><iframe style="border:0;width:100vw;height:100vh" src="http://localhost:${server.address().port}/index.html"></iframe></body></html>`);
    return;
  }
  const path = resolve(root, '.' + pathname);
  if (!path.startsWith(root + sep)) {response.writeHead(403); response.end(); return;}
  try {
    response.setHeader('Content-Type', {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm'}[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch {response.writeHead(404); response.end();}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
  const frame = page.frames().find(value => value !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  const chooser = page.waitForEvent('filechooser');
  await page.mouse.click(1124, 40, {delay: 100});
  await (await chooser).setFiles(archive);
  const saved = async () => frame.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('factory-planner', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const get = open.result.transaction('plans').objectStore('plans').get('autosave');
      get.onsuccess = () => {resolve(get.result); open.result.close();};
      get.onerror = () => reject(get.error);
    };
  }));
  const deadline = Date.now() + 120000;
  let plan;
  while (Date.now() < deadline) {
    plan = await saved();
    if ((plan?.imported_world?.machines?.length ?? 0) >= 14) break;
    await page.waitForTimeout(250);
  }
  if (!plan?.imported_world) {
    await page.screenshot({path: `${artifacts}/rotated-browser-failure.png`});
    throw new Error(`The browser did not save the imported world. ${errors.join('; ')}`);
  }
  assert.deepEqual(plan.imported_world.errors, []);
  for (const fixture of fixtures) {
    const machine = plan.imported_world.machines.find(value => value.id === fixture.machine &&
      value.origin.x === fixture.x && value.origin.y === fixture.y && value.origin.z === fixture.z);
    assert.ok(machine);
    assert.equal(machine.facts.facingDirection, fixture.facing_direction);
    assert.equal(machine.structure.status, 'matching_saved_geometry');
  }
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  await page.screenshot({path: `${artifacts}/rotated-browser-import.png`});
  assert.deepEqual(errors, []);
  console.log('The embedded browser application imported and saved four rotated quarries with matching geometry.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
