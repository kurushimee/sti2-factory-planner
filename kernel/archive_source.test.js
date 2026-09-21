import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync, gzipSync} from 'fflate';
import {mkdtempSync, writeFileSync, unlinkSync, rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {archiveSource} from './archive_source.js';
import {withArchiveFile} from './archive_file.js';
import {inspectWorld, zipEntries, readRegion} from './world.js';

const minimalWorld = () => zipSync({'world/level.dat': gzipSync(Uint8Array.from([10, 0, 0, 0]))});

test('a world archive beyond 4 GiB needs only its directory and requested file ranges', () => {
  const original = minimalWorld(), input = new DataView(original.buffer), end = original.length - 22;
  const central = input.getUint32(end + 16, true), directorySize = input.getUint32(end + 12, true);
  const offset = 5 * 1024 ** 3, tail = new Uint8Array(directorySize + 98), view = new DataView(tail.buffer);
  tail.set(original.subarray(central, end));
  const record = directorySize, locator = record + 56, final = locator + 20;
  view.setUint32(record, 0x06064b50, true); view.setBigUint64(record + 4, 44n, true);
  view.setBigUint64(record + 24, 1n, true); view.setBigUint64(record + 32, 1n, true);
  view.setBigUint64(record + 40, BigInt(directorySize), true); view.setBigUint64(record + 48, BigInt(offset), true);
  view.setUint32(locator, 0x07064b50, true); view.setBigUint64(locator + 8, BigInt(offset + record), true);
  view.setUint32(locator + 16, 1, true);
  tail.set(original.subarray(end), final);
  view.setUint16(final + 8, 65535, true); view.setUint16(final + 10, 65535, true);
  view.setUint32(final + 12, 0xffffffff, true); view.setUint32(final + 16, 0xffffffff, true);
  const segments = [[0, original.subarray(0, central)], [offset, tail]], reads = [];
  const source = {size: offset + tail.length, read(position, length) {
    assert.ok(length <= 65544);
    reads.push({position, length});
    const result = new Uint8Array(length);
    for (const [start, bytes] of segments) {
      const first = Math.max(position, start), last = Math.min(position + length, start + bytes.length);
      if (first < last) result.set(bytes.subarray(first - start, last - start), first - position);
    }
    return result;
  }};
  assert.deepEqual(inspectWorld(source, {machines: []}), inspectWorld(original, {machines: []}));
  assert.ok(reads.reduce((sum, read) => sum + read.length, 0) < 200000);
  assert.ok(reads.every(read => read.position < 65544 || read.position >= offset - 65544));
});

test('searching the longest ZIP comment uses cached windows rather than repeated file reads', () => {
  const original = minimalWorld(), bytes = new Uint8Array(original.length + 65535);
  bytes.set(original);
  new DataView(bytes.buffer).setUint16(original.length - 2, 65535, true);
  let reads = 0;
  const entries = zipEntries({size: bytes.length, read(offset, length) {reads++; return bytes.subarray(offset, offset + length);}});
  assert.equal(entries.length, 1);
  assert.ok(reads < 8);
});

test('range readers reject invalid bounds and incomplete reads', () => {
  const source = archiveSource(new Uint8Array(8));
  for (const [offset, length] of [[-1, 1], [0, 9], [8, 1], [0.5, 1], [0, Infinity]]) assert.throws(() => source.read(offset, length), /range/);
  assert.throws(() => source.view.getUint32(6, true), /truncated/);
  assert.throws(() => archiveSource({size: 8, read: () => new Uint8Array(1)}).read(0, 2), /completely/);
});

test('desktop range imports close their file after success and failure', () => {
  const directory = mkdtempSync(join(process.platform === 'win32' ? 'F:/sti2-work' : tmpdir(), 'archive-test-'));
  const path = join(directory, 'world.zip'), bytes = minimalWorld();
  writeFileSync(path, bytes);
  try {
    assert.deepEqual(withArchiveFile(path, source => inspectWorld(source, {machines: []})), inspectWorld(bytes, {machines: []}));
    assert.throws(() => withArchiveFile(path, () => {throw new Error('Interrupted check.');}), /Interrupted/);
  } finally {
    unlinkSync(path);
    rmdirSync(directory);
  }
});

test('region scanning consumes chunks without retaining their decoded terrain', () => {
  const bytes = new Uint8Array(16384), view = new DataView(bytes.buffer);
  for (let index = 0; index < 2; index++) {
    const sector = index + 2, start = sector * 4096;
    view.setUint32(index * 4, sector << 8 | 1);
    view.setUint32(start, 5);
    bytes.set([3, 10, 0, 0, 0], start + 4);
  }
  view.setUint32(8, 99 << 8 | 1);
  const consumed = [];
  const result = readRegion(bytes, {x: 2, z: -1}, undefined, null, chunk => consumed.push([chunk.x, chunk.z]));
  assert.deepEqual(consumed, [[64, -32], [65, -32]]);
  assert.deepEqual(result.chunks, []);
  assert.equal(result.errors.length, 1);
});
