import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

const bridge = await readFile('web/bridge.js', 'utf8');
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>Storage check</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({content: bridge});
  const result = await page.evaluate(async () => {
    const open = indexedDB.open('factory-planner', 1);
    const db = await new Promise((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    const read = key => new Promise((resolve, reject) => {
      const request = db.transaction('plans').objectStore('plans').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const plan = {dataset_identity: 'same-name', dataset_ref: 'first', request: {goals: [{rate: 1 / 3600}]}};
    await plannerBridge.save(plan, {identity: 'same-name', marker: 1});
    await read('autosave');
    await plannerBridge.save({...plan, dataset_ref: 'second'}, {identity: 'same-name', marker: 2});
    const second = await read('autosave');
    await plannerBridge.save({...plan, positions: {node: [10, 20]}}, null);
    const restoredFirst = await read('autosave');
    await plannerBridge.save({...plan, dataset_ref: 'missing'}, null);
    const afterFailure = await read('autosave');
    const error = await new Promise(resolve => {
      const poll = () => { const value = plannerBridge.pollFile(); if (value) resolve(JSON.parse(value)); else setTimeout(poll, 10); };
      poll();
    });
    await plannerBridge.restore();
    const restored = await new Promise(resolve => {
      const poll = () => { const value = plannerBridge.pollFile(); if (value) resolve(JSON.parse(value)); else setTimeout(poll, 10); };
      poll();
    });
    return {second, restoredFirst, afterFailure, error, restored,
      firstDataset: await read('dataset:first'), secondDataset: await read('dataset:second')};
  });
  assert.equal(result.second.dataset_ref, 'second');
  assert.equal(result.restoredFirst.dataset, undefined);
  assert.equal(result.restoredFirst.request.goals[0].rate, 1 / 3600);
  assert.equal(result.firstDataset.marker, 1);
  assert.equal(result.secondDataset.marker, 2);
  assert.deepEqual(result.afterFailure, result.restoredFirst);
  assert.equal(result.error.kind, 'error');
  assert.equal(result.restored.kind, 'json');
  assert.equal(result.restored.value.dataset.marker, 1);
  console.log('Dataset revisions remain separate, lightweight saves restore exact rates, and a missing cache cannot replace the recoverable plan.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
