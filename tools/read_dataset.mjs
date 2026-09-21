import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';

export async function readDataset(path) {
  const bytes = await readFile(path);
  return JSON.parse((String(path).endsWith('.gz') ? gunzipSync(bytes, {maxOutputLength: 128 * 1024 * 1024}) : bytes).toString('utf8'));
}
