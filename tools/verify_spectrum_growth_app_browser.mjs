import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const root = resolve(process.env.STI2_WEB_ROOT ?? 'builds/web');
const artifacts = resolve('.plans/artifacts/workspace');
await mkdir(artifacts, {recursive: true});
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
let browser, page;
try {
  browser = await chromium.launch({headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  page = await browser.newPage({viewport: {width: 1440, height: 900}});
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
          if (event.data.error) window.testError = event.data.error;
        });
      }
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
  const frame = page.frames().find(candidate => candidate !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  await page.mouse.click(130, 141);
  await page.keyboard.type('Grow Pure Iron with Iron Nugget');
  await page.mouse.click(130, 183);
  await page.screenshot({path: `${artifacts}/browser-spectrum-growth-unavailable.png`});
  await page.mouse.click(130, 727);
  await frame.waitForFunction(() => window.testError?.includes('no source-derived cycle time'),
    null, {timeout: 30000});
  assert.match(await frame.evaluate(() => window.testError), /Goal recipe is unavailable/);
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  console.log('The embedded browser export rejects the unsupported Spectrum farm with its exact-capacity reason.');
} catch (error) {
  await page?.screenshot({path: `${artifacts}/browser-spectrum-growth-failure.png`});
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
