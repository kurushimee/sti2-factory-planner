import {isDeepStrictEqual} from 'node:util';
import assert from 'node:assert/strict';
import {readDataset} from './read_dataset.mjs';

const [source, restored] = process.argv.slice(2);
if (!source || !restored) throw new Error('Supply the original dataset and the Godot round-trip JSON.');
assert.ok(isDeepStrictEqual(await readDataset(source), await readDataset(restored)),
  'The Godot round trip must preserve every dataset value exactly.');
console.log('Every bundled dataset value survives the Godot JSON round trip exactly.');
