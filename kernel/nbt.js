/** Read Java Edition's big-endian NBT without losing signed 64-bit values. */
export function readNbt(bytes, options = {}) {
  const limits = {depth: 128, entries: 2_000_000, stringBytes: 65535, ...options};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let offset = 0;
  let entries = 0;
  function take(length) {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) throw new Error('The NBT data is truncated.');
    const start = offset;
    offset += length;
    return start;
  }
  const u8 = () => view.getUint8(take(1));
  const i32 = () => view.getInt32(take(4));
  function string() {
    const length = view.getUint16(take(2));
    if (length > limits.stringBytes) throw new Error('An NBT string exceeds the import limit.');
    const start = take(length);
    // NBT uses Java modified UTF-8, including encoded nulls and surrogate code units.
    const source = bytes.subarray(start, start + length);
    const units = [];
    for (let i = 0; i < source.length;) {
      const first = source[i++];
      if (first < 0x80) units.push(first);
      else if ((first & 0xe0) === 0xc0) {
        const second = source[i++];
        if ((second & 0xc0) !== 0x80) throw new Error('Invalid NBT string encoding.');
        units.push(((first & 31) << 6) | (second & 63));
      } else if ((first & 0xf0) === 0xe0) {
        const second = source[i++], third = source[i++];
        if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80) throw new Error('Invalid NBT string encoding.');
        units.push(((first & 15) << 12) | ((second & 63) << 6) | (third & 63));
      } else {
        return decoder.decode(source);
      }
    }
    return String.fromCharCode(...units);
  }
  function length() {
    const count = i32();
    if (count < 0 || count > limits.entries - entries) throw new Error('An NBT collection exceeds the import limit.');
    entries += count;
    return count;
  }
  function payload(type, depth) {
    if (depth > limits.depth) throw new Error('The NBT nesting exceeds the import limit.');
    switch (type) {
      case 1: return view.getInt8(take(1));
      case 2: return view.getInt16(take(2));
      case 3: return i32();
      case 4: return view.getBigInt64(take(8)).toString();
      case 5: return view.getFloat32(take(4));
      case 6: return view.getFloat64(take(8));
      case 7: { const count = length(); return bytes.slice(take(count), offset); }
      case 8: return string();
      case 9: {
        const child = u8(), count = length();
        if (child === 0 && count !== 0) throw new Error('An NBT list has an invalid element type.');
        return Array.from({length: count}, () => payload(child, depth + 1));
      }
      case 10: {
        const result = Object.create(null);
        while (true) {
          const child = u8();
          if (!child) return result;
          if (++entries > limits.entries) throw new Error('The NBT entry count exceeds the import limit.');
          const name = string();
          if (Object.hasOwn(result, name)) throw new Error('An NBT compound contains a duplicate key.');
          result[name] = payload(child, depth + 1);
        }
      }
      case 11: return Array.from({length: length()}, i32);
      case 12: return Array.from({length: length()}, () => view.getBigInt64(take(8)).toString());
      default: throw new Error(`Unsupported NBT tag type ${type}.`);
    }
  }
  const type = u8();
  if (type !== 10) throw new Error('A Minecraft NBT root must be a compound.');
  const name = string();
  const value = payload(type, 0);
  if (offset !== bytes.length) throw new Error('Unexpected data follows the NBT root.');
  return {name, value};
}
