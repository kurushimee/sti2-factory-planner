import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const root = resolve(process.env.STI2_WEB_ROOT ?? 'builds/web');
const artifacts = resolve('.plans/artifacts/preview-review');
await mkdir(artifacts, {recursive: true});
const goalRecipe = 'minecraft:crafting_shaped|modern_industrialization:electric_age/circuit/craft/processing_unit_asbl';
const server = createServer(async (incoming, outgoing) => {
  const pathname = new URL(incoming.url, 'http://localhost').pathname;
  if (pathname === '/embed') {
    outgoing.setHeader('Content-Type', 'text/html');
    outgoing.end(`<!doctype html><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe src="http://localhost:${server.address().port}/index.html"></iframe>`);
    return;
  }
  const path = resolve(root, '.' + pathname);
  if (!path.startsWith(root + sep)) { outgoing.writeHead(403); outgoing.end(); return; }
  try {
    outgoing.setHeader('Content-Type', {'.html': 'text/html', '.js': 'text/javascript',
      '.mjs': 'text/javascript', '.wasm': 'application/wasm'}[extname(path)] ?? 'application/octet-stream');
    outgoing.end(await readFile(path));
  } catch { outgoing.writeHead(404); outgoing.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error' && /SCRIPT ERROR|Parse Error|ERROR:/.test(message.text())) {
      errors.push(message.text());
    }
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
  const frame = page.frames().find(candidate => candidate !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  await page.mouse.click(110, 132);
  await page.keyboard.type('processing unit');
  await page.waitForTimeout(1000);
  await page.mouse.click(110, 682);
  await page.keyboard.press('Control+A');
  await page.waitForTimeout(300);
  await page.keyboard.type('0.2', {delay: 150});
  await page.keyboard.press('Tab');
  await page.screenshot({path: `${artifacts}/browser-rate-input.png`});
  await page.mouse.click(86, 729);
  await frame.waitForFunction(recipe => window.testResult?.status === 'feasible' &&
    window.testResult.lines.length > 150 && window.testResult.lines.some(line => line.recipe === recipe),
  goalRecipe, {timeout: 120000});
  const result = await frame.evaluate(() => window.testResult);
  assert.equal(result.exact_production.status, 'exact');
  assert.ok(result.connections.length > 500);
  assert.ok(result.lines.every(line => !line.recipe.includes('matter_fabricator')));
  await page.screenshot({path: `${artifacts}/browser-processing-unit.png`});
  const savedRequest = async () => frame.evaluate(() => new Promise((done, reject) => {
    const opened = indexedDB.open('factory-planner', 1);
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const read = opened.result.transaction('plans').objectStore('plans').get('autosave');
      read.onsuccess = () => { done(read.result?.request); opened.result.close(); };
      read.onerror = () => reject(read.error);
    };
  }));
  assert.equal((await savedRequest()).goals[0].rate, 0.2);
  await page.mouse.click(1038, 40);
  await page.screenshot({path: `${artifacts}/browser-reset-state.png`});
  await frame.waitForFunction(async () => {
    const opened = indexedDB.open('factory-planner', 1);
    return new Promise(done => {
      opened.onsuccess = () => {
        const read = opened.result.transaction('plans').objectStore('plans').get('autosave');
        read.onsuccess = () => { done(read.result?.request?.goals?.length === 0); opened.result.close(); };
      };
    });
  }, null, {timeout: 60000});
  assert.deepEqual((await savedRequest()).goals, []);
  await page.screenshot({path: `${artifacts}/browser-new-plan.png`});
  await frame.evaluate(() => { window.testResult = null; });
  await page.mouse.click(1315, 40);
  await frame.waitForFunction(() => window.testResult?.lines?.length > 150,
    null, {timeout: 120000});
  await frame.waitForFunction(async () => {
    const opened = indexedDB.open('factory-planner', 1);
    return new Promise(done => {
      opened.onsuccess = () => {
        const read = opened.result.transaction('plans').objectStore('plans').get('autosave');
        read.onsuccess = () => { done(read.result?.request?.goals?.[0]?.rate === 0.2); opened.result.close(); };
      };
    });
  }, null, {timeout: 60000});
  assert.equal((await savedRequest()).goals[0].recipe, goalRecipe);
  assert.deepEqual(errors, []);
  console.log('The embedded browser build planned Processing Unit, reset, and restored the goal with Undo.');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
