import {build} from 'esbuild';
import {mkdir, copyFile, cp, writeFile, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

if (process.platform !== 'win32') throw new Error('Build the Windows runtime package on Windows with the pinned Node version.');
const destination = process.argv[2] ?? 'builds/windows';
if (destination.replaceAll('\\', '/').startsWith('builds/')) {
  await mkdir('builds', {recursive: true});
  await writeFile('builds/.gdignore', '');
}
await mkdir(`${destination}/runtime`, {recursive: true});
await mkdir(`${destination}/kernel`, {recursive: true});
await mkdir(`${destination}/licenses`, {recursive: true});
await copyFile(process.execPath, `${destination}/runtime/node.exe`);
await build({entryPoints: ['kernel/desktop.js'], outfile: `${destination}/kernel/desktop.js`,
  bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['highs']});
await cp('node_modules/highs', `${destination}/node_modules/highs`, {recursive: true});
await writeFile(`${destination}/package.json`, JSON.stringify({private: true, type: 'module'}));
await copyFile('node_modules/fflate/LICENSE', `${destination}/licenses/fflate.txt`);
await copyFile('node_modules/highs/LICENSE', `${destination}/licenses/highs-js.txt`);
await copyFile('ui/fonts/OFL.txt', `${destination}/licenses/Inter.txt`);
const nodeLicense = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
if (!nodeLicense.ok) throw new Error('Could not obtain the license for the bundled Node version.');
await writeFile(`${destination}/licenses/Node.txt`, await nodeLicense.text());
const manifest = {node: process.version, node_sha256: createHash('sha256').update(await readFile(process.execPath)).digest('hex'),
  highs: '1.15.3', fflate: '0.8.3', godot: '4.7.2', release_ready: false};
await writeFile(`${destination}/runtime-manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`Prepared the standalone calculation runtime in ${destination}.`);
