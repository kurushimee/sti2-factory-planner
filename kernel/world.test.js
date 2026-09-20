import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync, zlibSync} from 'fflate';
import {readNbt} from './nbt.js';
import {zipEntries, readRegion} from './world.js';

test('NBT preserves signed long values and prototype-like keys', () => {
  const bytes = Uint8Array.from([10, 0, 0, 4, 0, 1, 120, 0x7f, 255, 255, 255, 255, 255, 255, 255,
    1, 0, 9, ...Buffer.from('__proto__'), 7, 0]);
  const result = readNbt(bytes).value;
  assert.equal(result.x, '9223372036854775807');
  assert.equal(result.__proto__, 7);
  assert.equal(Object.getPrototypeOf(result), null);
});

test('NBT supports Java modified UTF-8 null and surrogate pairs', () => {
  const bytes = Uint8Array.from([10, 0, 0, 8, 0, 1, 115, 0, 8, 0xc0, 0x80, 0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80, 0]);
  assert.equal(readNbt(bytes).value.s, '\0😀');
});

test('NBT rejects truncated payloads, trailing bytes and excessive lists', () => {
  assert.throws(() => readNbt(Uint8Array.from([10, 0, 0, 3])), /truncated/);
  assert.throws(() => readNbt(Uint8Array.from([10, 0, 0, 0, 0])), /follows/);
  assert.throws(() => readNbt(Uint8Array.from([10, 0, 0, 9, 0, 0, 1, 0x7f, 255, 255, 255])), /limit/);
});

test('ZIP entries are read individually and corrupt content is rejected', () => {
  const zip = zipSync({'world/hello': new TextEncoder().encode('hello')}, {level: 0});
  assert.equal(new TextDecoder().decode(zipEntries(zip)[0].read()), 'hello');
  zip[41] ^= 1;
  assert.throws(() => zipEntries(zip)[0].read(), /checksum/);
  assert.throws(() => zipEntries(zip.slice(0, 10)), /complete ZIP/);
});

test('regions decode zlib chunks and report malformed neighbors without losing valid data', () => {
  const region = new Uint8Array(16384), view = new DataView(region.buffer);
  view.setUint32(0, (2 << 8) | 1);
  view.setUint32(4, (9 << 8) | 1);
  const compressed = zlibSync(Uint8Array.from([10, 0, 0, 0]));
  view.setUint32(8192, compressed.length + 1);
  region[8196] = 2;
  region.set(compressed, 8197);
  const result = readRegion(region, {x: -1, z: 2, path: 'r.-1.2.mca'});
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].x, -32);
  assert.equal(result.chunks[0].z, 64);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /outside/);
});
