import {Inflate, Unzlib, Gunzip} from 'fflate';
import {readNbt} from './nbt.js';
import {reconstructFactory} from './reconstruct.js';
import {blockStateAt, readProviders, readRequester, inferProviderAssignments} from './ae2.js';

const MAX_ENTRY = 256 * 1024 * 1024;
const MAX_CHUNK = 32 * 1024 * 1024;

function decompress(bytes, Constructor, limit = MAX_CHUNK) {
  const parts = [];
  let size = 0;
  const stream = new Constructor(part => {
    size += part.length;
    if (size > limit) throw new Error('The expanded data exceeds the import limit.');
    parts.push(part);
  });
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    stream.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function boundedInflate(bytes, size) {
  if (size > MAX_ENTRY) throw new Error('An archive entry exceeds the 256 MiB import limit.');
  const result = decompress(bytes, Inflate, size);
  if (result.length !== size) throw new Error('An archive entry has an incorrect expanded size.');
  return result;
}

const crcTable = Uint32Array.from({length: 256}, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
  }
  if (end < Math.max(0, bytes.length - 65557)) throw new Error('The file is not a complete ZIP archive.');
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('Split ZIP archives are not supported.');
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  if (count === 65535 || cursor === 0xffffffff) throw new Error('ZIP64 archives need to be repacked below 4 GiB for this importer.');
  const entries = [];
  const names = new Set();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('The ZIP directory is malformed.');
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
    const expectedCrc = view.getUint32(cursor + 16, true);
    const compressed = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    if (cursor + 46 + nameLength + extraLength + commentLength > end) throw new Error('The ZIP filename or extra data is truncated.');
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)).replaceAll('\\', '/');
    if (names.has(name)) throw new Error(`Duplicate archive path: ${name}.`);
    names.add(name);
    entries.push({name, size, read() {
      if (flags & 1) throw new Error('Encrypted world archives are not supported.');
      if (size > MAX_ENTRY) throw new Error(`The archive entry ${name} exceeds the import limit.`);
      if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new Error('A ZIP entry header is malformed.');
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      if (start + compressed > bytes.length) throw new Error('A ZIP entry is truncated.');
      const payload = bytes.subarray(start, start + compressed);
      let result;
      if (method === 8) result = boundedInflate(payload, size);
      else if (method === 0 && compressed === size) result = payload;
      else throw new Error(`Unsupported ZIP compression method ${method}.`);
      if (crc32(result) !== expectedCrc) throw new Error(`The archive entry ${name} failed its checksum.`);
      return result;
    }});
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readRegion(bytes, origin, external = () => null) {
  if (bytes.length < 8192 || bytes.length % 4096) throw new Error('A region file has an invalid sector length.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [], errors = [];
  const occupied = new Set([0, 1]);
  for (let index = 0; index < 1024; index++) {
    const location = view.getUint32(index * 4), sector = location >>> 8, sectors = location & 255;
    if (!location) continue;
    try {
      if (sector < 2 || !sectors || (sector + sectors) * 4096 > bytes.length) throw new Error('The chunk points outside its region file.');
      for (let s = sector; s < sector + sectors; s++) {
        if (occupied.has(s)) throw new Error('Two chunks overlap in the region file.');
        occupied.add(s);
      }
      const start = sector * 4096, length = view.getUint32(start), compression = view.getUint8(start + 4);
      if (length < 1 || length + 4 > sectors * 4096) throw new Error('The chunk length exceeds its allocated sectors.');
      const x = origin.x * 32 + index % 32, z = origin.z * 32 + Math.floor(index / 32);
      const payload = compression & 128 ? external(x, z) : bytes.subarray(start + 5, start + 4 + length);
      if (!payload) throw new Error('The chunk requires a missing external .mcc file.');
      let expanded;
      switch (compression & 127) {
        case 1: expanded = decompress(payload, Gunzip); break;
        case 2: expanded = decompress(payload, Unzlib); break;
        case 3: expanded = payload; break;
        default: throw new Error(`Unsupported region compression ${compression & 127}.`);
      }
      if (expanded.length > MAX_CHUNK) throw new Error('The expanded chunk exceeds the import limit.');
      chunks.push({x, z, data: readNbt(expanded).value});
    } catch (error) { errors.push({region: origin.path, chunk_index: index, message: error.message}); }
  }
  return {chunks, errors};
}

export function inspectWorld(bytes, dataset, progress = () => {}) {
  const entries = zipEntries(bytes), byName = new Map(entries.map(entry => [entry.name, entry]));
  const worlds = entries.filter(entry => /(^|\/)level\.dat$/.test(entry.name));
  if (worlds.length !== 1) throw new Error(worlds.length ? 'The archive contains multiple worlds. Import one world at a time.' : 'The archive contains no level.dat world file.');
  const root = worlds[0].name.slice(0, -9);
  const level = readNbt(decompress(worlds[0].read(), Gunzip)).value;
  const machines = new Map((dataset.machines ?? []).map(machine => [machine.id, machine]));
  const regions = entries.filter(entry => entry.name.startsWith(root) && /(^|\/)region\/r\.-?\d+\.-?\d+\.mca$/.test(entry.name));
  const result = {format: 1, world_name: level.Data?.LevelName ?? 'Imported world', data_version: level.Data?.DataVersion,
    machines: [], parts: [], requesters: [], providers: [], unsupported: [], errors: [], evidence: 'Saved configuration; no observed production rate.'};
  for (const [index, region] of regions.entries()) {
    progress({phase: 'reading_regions', completed: index, total: regions.length});
    const match = region.name.match(/r\.(-?\d+)\.(-?\d+)\.mca$/);
    const relative = region.name.slice(root.length);
    const prefix = relative.slice(0, relative.indexOf('region/'));
    const dimension = prefix === '' ? 'minecraft:overworld' : prefix === 'DIM-1/' ? 'minecraft:the_nether' : prefix === 'DIM1/' ? 'minecraft:the_end' : prefix.replace(/^dimensions\//, '').replace(/\/$/, '').replace('/', ':');
    try {
      const parsed = readRegion(region.read(), {x: Number(match[1]), z: Number(match[2]), path: region.name},
        (x, z) => byName.get(region.name.replace(/r\.[^/]+$/, `c.${x}.${z}.mcc`))?.read());
      result.errors.push(...parsed.errors);
      for (const chunk of parsed.chunks) {
        for (const block of chunk.data.block_entities ?? chunk.data.Level?.TileEntities ?? []) {
          const origin = {dimension, x: block.x, y: block.y, z: block.z, region: region.name};
          const providers = readProviders(block, origin, blockStateAt(chunk.data, block.x, block.y, block.z));
          result.providers.push(...providers);
          const requester = readRequester(block, origin);
          if (requester) result.requesters.push(requester);
          if (machines.has(block.id)) {
            const machine = machines.get(block.id);
            if (machine.role === 'multiblock_part') {
              result.parts.push({id: block.id, origin, hatch_type: machine.hatch_type, facts: block});
              continue;
            }
            result.machines.push({id: block.id, origin, recipe_id: block.activeRecipe ?? null,
              recipe_type: machines.get(block.machinesStack?.id)?.recipe_type ?? machine.recipe_type ?? null, upgrades: block.upgradesItemStack ?? {},
              contained_machine: block.machinesStack ?? null, shape: block.activeShape ?? null,
              casing: block.casing ?? {}, facts: block, assignment_evidence: block.activeRecipe ? 'saved_active_recipe' : 'unassigned'});
          } else if (!providers.length && !requester && !block.id?.startsWith('minecraft:')) {
            result.unsupported.push({id: block.id, origin, reason: 'No block entity adapter is registered.', facts: block});
          }
        }
      }
    } catch (error) { result.errors.push({region: region.name, message: error.message}); }
  }
  progress({phase: 'reading_regions', completed: regions.length, total: regions.length});
  inferProviderAssignments(result, dataset.recipes);
  if (dataset.format === 1) result.reconstruction = reconstructFactory(result, dataset);
  return result;
}
