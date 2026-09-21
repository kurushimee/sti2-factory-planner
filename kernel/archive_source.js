const WINDOW = 65536;

// The same range reader works with memory, a desktop descriptor, or a worker-owned File.
export function archiveSource(input) {
  const source = input instanceof Uint8Array ? {size: input.length, read: (offset, length) => input.subarray(offset, offset + length)} : input;
  if (!source || !Number.isSafeInteger(source.size) || source.size < 0 || typeof source.read !== 'function') {
    throw new Error('The archive needs a valid file size and range reader.');
  }
  const read = (offset, length) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > source.size - length) {
      throw new Error('An archive range lies outside the file.');
    }
    const result = source.read(offset, length);
    if (!(result instanceof Uint8Array) || result.length !== length) throw new Error('An archive range could not be read completely.');
    return result;
  };
  let start = -1, window = new Uint8Array();
  let windowView = new DataView(window.buffer);
  const field = (offset, width, method, littleEndian) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.size - width) throw new Error('An archive field is truncated.');
    if (offset < start || offset + width > start + window.length) {
      start = Math.floor(offset / WINDOW) * WINDOW;
      window = read(start, Math.min(WINDOW + 8, source.size - start));
      windowView = new DataView(window.buffer, window.byteOffset, window.byteLength);
    }
    return windowView[method](offset - start, littleEndian);
  };
  return {size: source.size, read, view: {
    getUint16: (offset, littleEndian) => field(offset, 2, 'getUint16', littleEndian),
    getUint32: (offset, littleEndian) => field(offset, 4, 'getUint32', littleEndian),
    getBigUint64: (offset, littleEndian) => field(offset, 8, 'getBigUint64', littleEndian),
  }};
}
