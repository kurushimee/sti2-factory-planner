const P1 = 0x9e3779b1, P2 = 0x85ebca77, P3 = 0xc2b2ae3d, P4 = 0x27d4eb2f, P5 = 0x165667b1;
const rotate = (value, bits) => (value << bits) | (value >>> (32 - bits));
const round = (value, input) => Math.imul(rotate(value + Math.imul(input, P2), 13), P1);

export function xxhash32(bytes, seed = 0x9747b28c) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 0, hash;
  if (bytes.length >= 16) {
    let a = seed + P1 + P2, b = seed + P2, c = seed, d = seed - P1;
    while (cursor <= bytes.length - 16) {
      a = round(a, view.getUint32(cursor, true)); b = round(b, view.getUint32(cursor + 4, true));
      c = round(c, view.getUint32(cursor + 8, true)); d = round(d, view.getUint32(cursor + 12, true));
      cursor += 16;
    }
    hash = rotate(a, 1) + rotate(b, 7) + rotate(c, 12) + rotate(d, 18);
  } else hash = seed + P5;
  hash += bytes.length;
  while (cursor + 4 <= bytes.length) {
    hash = Math.imul(rotate(hash + Math.imul(view.getUint32(cursor, true), P3), 17), P4);
    cursor += 4;
  }
  while (cursor < bytes.length) hash = Math.imul(rotate(hash + Math.imul(bytes[cursor++], P5), 11), P1);
  hash ^= hash >>> 15; hash = Math.imul(hash, P2);
  hash ^= hash >>> 13; hash = Math.imul(hash, P3);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function decodeBlock(input, size) {
  const output = new Uint8Array(size);
  let cursor = 0, written = 0;
  const length = base => {
    if (base !== 15) return base;
    let value = base, extension;
    do {
      if (cursor >= input.length) throw new Error('An LZ4 length is truncated.');
      extension = input[cursor++]; value += extension;
      if (value > size) throw new Error('An LZ4 length exceeds its block.');
    } while (extension === 255);
    return value;
  };
  while (cursor < input.length) {
    const token = input[cursor++], literals = length(token >>> 4);
    if (cursor + literals > input.length || written + literals > size) throw new Error('LZ4 literals exceed their block.');
    output.set(input.subarray(cursor, cursor + literals), written);
    cursor += literals; written += literals;
    if (cursor === input.length) break;
    if (cursor + 2 > input.length) throw new Error('An LZ4 match offset is truncated.');
    const offset = input[cursor] | (input[cursor + 1] << 8); cursor += 2;
    const count = length(token & 15) + 4;
    if (!offset || offset > written || written + count > size) throw new Error('An LZ4 match exceeds its block.');
    for (let i = 0; i < count; i++) { output[written] = output[written - offset]; written++; }
  }
  if (written !== size) throw new Error('An LZ4 block has an incorrect expanded size.');
  return output;
}

// Minecraft uses lz4-java's block stream, whose header and checksum differ from an LZ4 frame.
export function decodeLz4Stream(bytes, limit) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = [76, 90, 52, 66, 108, 111, 99, 107], parts = [];
  let cursor = 0, total = 0;
  while (true) {
    if (cursor + 21 > bytes.length) throw new Error('An LZ4 stream header is truncated.');
    if (magic.some((value, index) => bytes[cursor + index] !== value)) throw new Error('An LZ4 stream has an invalid signature.');
    const token = bytes[cursor + 8], method = token & 240;
    const compressed = view.getUint32(cursor + 9, true), size = view.getUint32(cursor + 13, true);
    const checksum = view.getUint32(cursor + 17, true);
    cursor += 21;
    if (![16, 32].includes(method) || size > 2 ** ((token & 15) + 10) || (method === 16 && compressed !== size)) throw new Error('An LZ4 stream has invalid block sizes or method.');
    if (!size && !compressed) {
      if (checksum || cursor !== bytes.length) throw new Error('An LZ4 stream has an invalid terminator.');
      break;
    }
    if (!size || !compressed || cursor + compressed > bytes.length) throw new Error('An LZ4 stream block is truncated.');
    total += size;
    if (total > limit) throw new Error('The expanded LZ4 data exceeds the import limit.');
    const payload = bytes.subarray(cursor, cursor + compressed);
    const part = method === 16 ? payload : decodeBlock(payload, size);
    if ((xxhash32(part) & 0x0fffffff) !== checksum) throw new Error('An LZ4 block failed its checksum.');
    parts.push(part); cursor += compressed;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
