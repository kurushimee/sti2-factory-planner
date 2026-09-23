import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const root = resolve('builds/web'), artifacts = resolve('.plans/artifacts/precision');
await mkdir(artifacts, {recursive: true});
const dataset = {format: 1, identity: 'precision:1', name: 'Precision check',
  resources: [{id: 'ore', name: 'Ore'}, {id: 'part', name: 'Part'}], recipes: [{id: 'make', name: 'Make a part', primary: 'part',
    inputs: [{resource: 'ore', amount: 1}], outputs: [{resource: 'part', amount: 1}],
    configurations: [{id: 'bench', machine: 'Workbench', operations_per_second: 1}]}]};
const plan = rate => ({format: 'factory-plan', version: 1, dataset_identity: dataset.identity, dataset,
  request: {goals: [{recipe: 'make', resource: 'part', rate}], external: [{resource: 'ore'}]}, positions: {}, groups: {}});
for (const [name, rate] of [['tiny', 1e-12], ['unresolved', 1e-30]]) await writeFile(`${artifacts}/${name}.json`, JSON.stringify(plan(rate)));
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/embed') {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe src="http://localhost:${server.address().port}/index.html?dataset=example"></iframe>`);
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
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, acceptDownloads: true});
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          if (event.data.result) window.precisionResult = event.data.result;
          if (event.data.error) window.precisionError = event.data.error;
        });
      }
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {if (message.type() === 'error' && /SCRIPT ERROR|Parse Error|ERROR:/.test(message.text())) errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
  const frame = page.frames().find(value => value !== page.mainFrame());
  await frame.waitForFunction(() => !document.getElementById('status'), null, {timeout: 60000});
  const importPlan = async name => {
    await frame.evaluate(() => {delete window.precisionResult; delete window.precisionError;});
    const chooser = page.waitForEvent('filechooser');
    await page.mouse.click(1124, 40, {delay: 100});
    await (await chooser).setFiles(`${artifacts}/${name}.json`);
    await frame.waitForFunction(() => window.precisionResult || window.precisionError, null, {timeout: 20000});
    assert.equal(await frame.evaluate(() => window.precisionError), undefined);
    return frame.evaluate(() => window.precisionResult);
  };
  const solved = await importPlan('tiny');
  assert.equal(solved.lines[0].machines, 1);
  assert.equal(solved.lines[0].operations_per_second, 1e-12);
  await page.waitForTimeout(500);
  await page.mouse.click(950, 92, {delay: 100});
  await page.screenshot({path: `${artifacts}/tiny-browser.png`});
  const failed = await importPlan('unresolved');
  assert.equal(failed.status, 'numerical_error');
  assert.equal(failed.lines, undefined);
  await page.waitForTimeout(300);
  await page.screenshot({path: `${artifacts}/failure-browser.png`});
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const download = page.waitForEvent('download');
  await page.mouse.click(1225, 40, {delay: 100});
  await (await download).saveAs(`${artifacts}/after-failure.json`);
  const exported = JSON.parse(await readFile(`${artifacts}/after-failure.json`, 'utf8'));
  assert.ok(Object.keys(exported.positions).some(key => key.startsWith('make|')));
  await frame.evaluate(() => {delete window.precisionResult;});
  await page.mouse.click(1320, 40, {delay: 100});
  await frame.waitForFunction(() => window.precisionResult?.lines?.[0]?.machines === 1, null, {timeout: 20000});
  assert.deepEqual(errors, []);
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  console.log('The exported embedded application preserves a tiny goal, reports unresolved precision, retains the graph, and restores the working plan with Undo.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
