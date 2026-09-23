import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function bridgeWithPicker() {
  const inputs = [];
  const context = {window: {}, indexedDB: {open: () => ({})},
    document: {createElement: () => {
      const input = {click() {}};
      inputs.push(input);
      return input;
    }}};
  runInNewContext(readFileSync(new URL('../web/bridge.js', import.meta.url), 'utf8'), context);
  return {bridge: context.window.plannerBridge, inputs};
}

test('browser plan imports preserve a large Unicode file across bounded chunks', async () => {
  const {bridge, inputs} = bridgeWithPicker();
  const content = `${'a'.repeat(262143)}😀é${'b'.repeat(300000)}`;
  bridge.chooseFile();
  inputs[0].files = [{name: 'portable.json', text: async () => content}];
  await inputs[0].onchange();
  const notice = JSON.parse(bridge.pollFile());
  assert.equal(notice.kind, 'json_stream');
  assert.equal(notice.characters, content.length);
  const parts = [];
  let previous = 0;
  for (let response; (response = bridge.readFileChunk());) {
    const part = JSON.parse(response);
    assert.ok(part.characters > previous);
    assert.ok(part.characters - previous <= 262145);
    previous = part.characters;
    parts.push(part.chunk);
    if (part.done) break;
  }
  assert.equal(previous, content.length);
  assert.equal(parts.join(''), content);
  assert.equal(bridge.readFileChunk(), '');
});

test('cancelling a browser file import discards its pending text', async () => {
  const {bridge, inputs} = bridgeWithPicker();
  bridge.chooseFile();
  inputs[0].files = [{name: 'first.json', text: async () => 'first'}];
  await inputs[0].onchange();
  assert.equal(JSON.parse(bridge.pollFile()).kind, 'json_stream');
  bridge.cancelFileImport();
  assert.equal(bridge.readFileChunk(), '');
  bridge.chooseFile();
  inputs[1].files = [{name: 'second.json', text: async () => 'second'}];
  await inputs[1].onchange();
  assert.equal(JSON.parse(bridge.pollFile()).kind, 'json_stream');
  assert.equal(JSON.parse(bridge.readFileChunk()).chunk, 'second');
});
