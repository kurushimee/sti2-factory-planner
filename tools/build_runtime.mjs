import {build} from 'esbuild';
import {mkdir, copyFile, writeFile} from 'node:fs/promises';

const destination = process.argv[2] ?? 'builds/runtime';
if (destination.replaceAll('\\', '/').startsWith('builds/')) {
  await mkdir('builds', {recursive: true});
  await writeFile('builds/.gdignore', '');
}
await mkdir(`${destination}/kernel`, {recursive: true});
await mkdir(`${destination}/vendor`, {recursive: true});
await build({entryPoints: ['kernel/layout-worker.js'], outfile: `${destination}/kernel/layout-worker.js`,
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022'});
await build({entryPoints: ['kernel/world-worker.js'], outfile: `${destination}/kernel/world-worker.js`,
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022'});
await build({entryPoints: ['kernel/worker.js'], outfile: `${destination}/kernel/worker.js`,
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', external: ['../vendor/highs.mjs']});
for (const name of ['highs.mjs', 'highs.wasm']) await copyFile(`node_modules/highs/build/${name}`, `${destination}/vendor/${name}`);
console.log(`Prepared browser computation files in ${destination}.`);
