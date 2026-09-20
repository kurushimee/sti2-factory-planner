import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeLz4Stream, xxhash32} from './lz4.js';

// These streams were written by the pack's lz4-java 1.8.0 LZ4BlockOutputStream.
const raw = Buffer.from('TFo0QmxvY2sWBQAAAAUAAADjv0EKaGVsbG9MWjRCbG9jaxYAAAAAAAAAAAAAAAA=', 'base64');
const compressed = Buffer.from('TFo0QmxvY2smDQAAAEIAAABkepoHP2FiYwMAJ1BiY2FiY0xaNEJsb2NrFgAAAAAAAAAAAAAAAA==', 'base64');

test('LZ4 reads raw, compressed and multiple Java blocks with matching checksums', () => {
  assert.equal(xxhash32(new Uint8Array(), 0), 0x02cc5d05);
  assert.equal(new TextDecoder().decode(decodeLz4Stream(raw, 100)), 'hello');
  assert.equal(new TextDecoder().decode(decodeLz4Stream(compressed, 100)), 'abc'.repeat(22));
  const joined = Buffer.concat([raw.subarray(0, -21), compressed]);
  assert.equal(new TextDecoder().decode(decodeLz4Stream(joined, 100)), 'hello' + 'abc'.repeat(22));
});

test('LZ4 rejects corruption, truncation, invalid matches and oversized output', () => {
  for (let length = 0; length < compressed.length; length++) assert.throws(() => decodeLz4Stream(compressed.subarray(0, length), 100));
  const checksum = Buffer.from(raw); checksum[17] ^= 1;
  assert.throws(() => decodeLz4Stream(checksum, 100), /checksum/);
  const offset = Buffer.from(compressed); offset[25] = 0;
  assert.throws(() => decodeLz4Stream(offset, 100), /match/);
  const method = Buffer.from(raw); method[8] = 0x36;
  assert.throws(() => decodeLz4Stream(method, 100), /method/);
  assert.throws(() => decodeLz4Stream(compressed, 65), /limit/);
  assert.throws(() => decodeLz4Stream(Buffer.concat([raw, Buffer.from([0])]), 100), /terminator/);
});
