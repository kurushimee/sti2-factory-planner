import {createServer} from 'node:http';
import {writeFile, stat} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readDataset} from './read_dataset.mjs';
import {withArchiveFile} from '../kernel/archive_file.js';
import {inspectWorld} from '../kernel/world.js';

const [path, datasetPath, reportPath, referencePath = path] = process.argv.slice(2);
const dataset = await readDataset(datasetPath);
const expected = withArchiveFile(referencePath, source => inspectWorld(source, dataset));
const bundle = await build({entryPoints: ['kernel/world-worker.js'], bundle: true, write: false, format: 'esm', platform: 'browser'});
const instrumentation = `
const NativeReader = self.FileReaderSync;
const stats = {bytes: 0, largest: 0, reads: 0};
self.FileReaderSync = class extends NativeReader {
  readAsArrayBuffer(blob) {stats.bytes += blob.size; stats.largest = Math.max(stats.largest, blob.size); stats.reads++; return super.readAsArrayBuffer(blob);}
};
const post = self.postMessage.bind(self);
self.postMessage = message => post(message.result ? {...message, read_stats: stats} : message);
`;
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  response.setHeader('Content-Type', pathname === '/worker.js' ? 'text/javascript' : 'text/html');
  if (pathname === '/worker.js') response.end(instrumentation + bundle.outputFiles[0].text);
  else if (pathname === '/embed') response.end(`<iframe src="http://localhost:${server.address().port}/"></iframe>`);
  else response.end('<!doctype html><title>World range reader check</title><input type="file">');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
  const frame = page.frames().find(value => value !== page.mainFrame());
  await frame.locator('input').setInputFiles(path);
  const started = performance.now();
  const actual = await frame.evaluate(dataset => new Promise((resolve, reject) => {
    const worker = new Worker('/worker.js', {type: 'module'});
    const timer = setTimeout(() => {worker.terminate(); reject(new Error('File-backed world import timed out.'));}, 45000);
    worker.onerror = event => {clearTimeout(timer); worker.terminate(); reject(new Error(event.message));};
    worker.onmessage = event => {
      if (event.data.error || event.data.result) {
        clearTimeout(timer); worker.terminate();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data);
      }
    };
    worker.postMessage({id: 1, file: document.querySelector('input').files[0], dataset});
  }), dataset);
  assert.deepEqual(JSON.parse(JSON.stringify(actual.result)), JSON.parse(JSON.stringify(expected)));
  assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
  const size = (await stat(path)).size;
  if (referencePath !== path) assert.ok(actual.read_stats.bytes < size / 10);
  const report = {...actual.read_stats, archive_bytes: size, elapsed_ms: performance.now() - started,
    machines: actual.result.machines.length, goals: actual.result.reconstruction?.goals.length, errors: actual.result.errors.length};
  if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
