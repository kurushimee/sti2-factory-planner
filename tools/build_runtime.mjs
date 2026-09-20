import {build} from 'esbuild';
import {mkdir, copyFile} from 'node:fs/promises';

const destination = process.argv[2] ?? 'builds/runtime';
await mkdir(`${destination}/kernel`, {recursive: true});
await mkdir(`${destination}/vendor`, {recursive: true});
await build({entryPoints: ['kernel/world-worker.js'], outfile: `${destination}/kernel/world-worker.js`,
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022'});
for (const name of ['worker.js', 'planner.js', 'flows.js']) await copyFile(`kernel/${name}`, `${destination}/kernel/${name}`);
for (const name of ['highs.mjs', 'highs.wasm']) await copyFile(`node_modules/highs/build/${name}`, `${destination}/vendor/${name}`);
console.log(`Prepared browser computation files in ${destination}.`);
