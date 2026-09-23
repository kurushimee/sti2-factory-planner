import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const root = resolve('builds/web');
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/embed') {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe src="http://localhost:${server.address().port}/index.html?dataset=example"></iframe>`);
    return;
  }
  const path = resolve(root, '.' + pathname);
  if (!path.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
  try {
    response.setHeader('Content-Type', ({'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm'})[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
  const frame = page.frames().find(value => value !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  await page.waitForTimeout(1000);
  await page.mouse.click(145, 729, {delay: 100});
  const saved = () => frame.evaluate(() => new Promise(resolve => {
    const open = indexedDB.open('factory-planner', 1);
    open.onsuccess = () => {
      const get = open.result.transaction('plans').objectStore('plans').get('autosave');
      get.onsuccess = () => {resolve(get.result); open.result.close();};
    };
  }));
  let before;
  for (let attempt = 0; attempt < 100; attempt++) {
    before = await saved();
    if (before?.request.goals.length) break;
    await page.waitForTimeout(100);
  }
  if (before?.request.goals.length !== 1) await page.screenshot({path: '.plans/artifacts/workspace/import-check-start.png'});
  assert.equal(before?.request.goals.length, 1);
  await frame.evaluate(() => {
    const NativeWorker = window.Worker;
    window.importCheck = {started: false, cancelled: false, error: null, delay: true};
    window.Worker = class extends NativeWorker {
      postMessage(job) {
        if (job.kind !== 'import_world') { super.postMessage(job); return; }
        window.importCheck.started = job.file instanceof File;
        this.addEventListener('message', event => { if (event.data.error) window.importCheck.error = event.data.error; });
        // Hold a real import at submission so cancellation does not depend on disk speed.
        if (window.importCheck.delay) this.pending = setTimeout(() => super.postMessage(job), 5000);
        else super.postMessage(job);
      }
      terminate() { clearTimeout(this.pending); window.importCheck.cancelled = true; super.terminate(); }
    };
  });
  const chooseBrokenZip = async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.mouse.click(1126, 40, {delay: 100});
    await (await chooser).setFiles({name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('not a ZIP archive')});
  };
  await chooseBrokenZip();
  await frame.waitForFunction(() => window.importCheck.started);
  await page.mouse.click(1310, 871, {delay: 100});
  await frame.waitForFunction(() => window.importCheck.cancelled);
  await page.waitForTimeout(5500);
  assert.equal(await frame.evaluate(() => window.importCheck.error), null);
  assert.deepEqual(await saved(), before);
  await page.screenshot({path: '.plans/artifacts/workspace/browser-import-cancelled.png'});
  await frame.evaluate(() => {window.importCheck.delay = false;});
  await chooseBrokenZip();
  await frame.waitForFunction(() => window.importCheck.error !== null);
  await page.waitForTimeout(300);
  assert.deepEqual(await saved(), before);
  await page.screenshot({path: '.plans/artifacts/workspace/browser-import-error.png'});
  await page.mouse.click(145, 729, {delay: 100});
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await saved()).request.goals[0].rate === 2) break;
    await page.waitForTimeout(100);
  }
  assert.equal((await saved()).request.goals[0].rate, 2);
  console.log('The embedded export cancels a File-backed import, preserves its plan after a malformed ZIP, and accepts another goal.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
