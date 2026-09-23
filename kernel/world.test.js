import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync, zlibSync, gzipSync} from 'fflate';
import {readNbt} from './nbt.js';
import {zipEntries, readRegion, inspectWorld} from './world.js';

test('empty regions contain no chunks while partial headers remain errors', () => {
  assert.deepEqual(readRegion(new Uint8Array(), {x: 1, z: 0}), {chunks: [], errors: []});
  for (const length of [1, 4096, 8191, 8193]) assert.throws(() => readRegion(new Uint8Array(length), {x: 1, z: 0}), /sector length/);
});

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

test('a malformed block entity does not discard other machines in its chunk', () => {
  const string = value => { const bytes = Buffer.from(value); return [bytes.length >> 8, bytes.length & 255, ...bytes]; };
  const tagString = (name, value) => [8, ...string(name), ...string(value)];
  const block = (id, x, extra = []) => [
    ...tagString('id', id), 3, ...string('x'), 0, 0, 0, x,
    3, ...string('y'), 0, 0, 0, 100, 3, ...string('z'), 0, 0, 0, 0, ...extra, 0,
  ];
  const nbt = Uint8Array.from([10, 0, 0, 9, ...string('block_entities'), 10, 0, 0, 0, 2,
    ...block('ae2:pattern_provider', 0, tagString('patterns', 'invalid inventory')),
    ...block('test:machine', 2), 0]);
  const region = new Uint8Array(12288), view = new DataView(region.buffer);
  view.setUint32(0, (2 << 8) | 1); view.setUint32(8192, nbt.length + 1);
  region[8196] = 3; region.set(nbt, 8197);
  const archive = zipSync({'world/level.dat': gzipSync(Uint8Array.from([10, 0, 0, 0])), 'world/region/r.0.0.mca': region});
  const result = inspectWorld(archive, {machines: [{id: 'test:machine'}]});
  assert.equal(result.machines.length, 1);
  assert.equal(result.machines[0].origin.x, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].id, 'ae2:pattern_provider');
  assert.equal(result.errors[0].origin.x, 0);
});

function zip64Fixture() {
  const original = zipSync({'world/hello': new TextEncoder().encode('hello')}, {level: 0});
  const view = new DataView(original.buffer);
  const end = original.length - 22, central = view.getUint32(end + 16, true);
  const nameLength = view.getUint16(central + 28, true);
  const header = original.slice(central, end), headerView = new DataView(header.buffer);
  const compressed = headerView.getUint32(20, true), size = headerView.getUint32(24, true);
  headerView.setUint16(6, 45, true);
  headerView.setUint16(30, 28, true);
  for (const offset of [20, 24, 42]) headerView.setUint32(offset, 0xffffffff, true);
  const extra = new Uint8Array(28), extraView = new DataView(extra.buffer);
  extraView.setUint16(0, 1, true); extraView.setUint16(2, 24, true);
  extraView.setBigUint64(4, BigInt(size), true); extraView.setBigUint64(12, BigInt(compressed), true); extraView.setBigUint64(20, 0n, true);
  const directorySize = header.length + extra.length, record = central + directorySize;
  const result = new Uint8Array(record + 56 + 20 + 22), output = new DataView(result.buffer);
  result.set(original.subarray(0, central)); result.set(header, central); result.set(extra, central + 46 + nameLength);
  output.setUint32(record, 0x06064b50, true); output.setBigUint64(record + 4, 44n, true);
  output.setUint16(record + 12, 45, true); output.setUint16(record + 14, 45, true);
  output.setBigUint64(record + 24, 1n, true); output.setBigUint64(record + 32, 1n, true);
  output.setBigUint64(record + 40, BigInt(directorySize), true); output.setBigUint64(record + 48, BigInt(central), true);
  const locator = record + 56;
  output.setUint32(locator, 0x07064b50, true); output.setBigUint64(locator + 8, BigInt(record), true); output.setUint32(locator + 16, 1, true);
  const final = locator + 20;
  result.set(original.subarray(end), final);
  output.setUint16(final + 8, 65535, true); output.setUint16(final + 10, 65535, true);
  output.setUint32(final + 12, 0xffffffff, true); output.setUint32(final + 16, 0xffffffff, true);
  return {result, extra: central + 46 + nameLength, locator, record};
}

test('ZIP64 directories and extended entry fields retain checksums and enforce bounded addresses', () => {
  const {result, extra, locator, record} = zip64Fixture();
  const entry = zipEntries(result)[0];
  assert.equal(entry.name, 'world/hello');
  assert.equal(new TextDecoder().decode(entry.read()), 'hello');
  for (const offset of [extra + 20, locator + 8, record + 48]) {
    const invalid = result.slice();
    new DataView(invalid.buffer).setBigUint64(offset, 9007199254740992n, true);
    assert.throws(() => zipEntries(invalid), /numeric range/);
  }
  const missing = result.slice();
  new DataView(missing.buffer).setUint16(extra, 2, true);
  assert.throws(() => zipEntries(missing), /missing its extended/);
  const truncated = result.slice();
  new DataView(truncated.buffer).setUint16(extra + 2, 2, true);
  assert.throws(() => zipEntries(truncated), /truncated/);
});
