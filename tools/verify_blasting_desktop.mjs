import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir, mkdtemp, stat} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {readDataset} from './read_dataset.mjs';

if (process.platform !== 'win32') throw new Error('Run the exported Windows check on Windows.');
const archive = process.argv[2];
if (!archive) throw new Error('Supply the private saved blast-furnace world ZIP.');
const scratch = await mkdtemp('F:/sti2-work/blasting-desktop-');
const user = join(scratch, 'Godot', 'app_userdata', 'STI2 Factory Planner');
await mkdir(user, {recursive: true});
await mkdir(resolve('.plans/artifacts/blasting-import'), {recursive: true});
const dataset = await readDataset('data/statech-2.0.1.json.gz');
const request = {goals: [], replication: false, available_machines: ['minecraft:blast_furnace'],
  external: ['item:spectrum:pure_iron', 'item:minecraft:coal', 'item:minecraft:lava_bucket'].map(resource => ({resource}))};
await writeFile(join(user, 'autosave.json'), JSON.stringify({format: 'factory-plan', version: 1,
  dataset_identity: dataset.identity, dataset, request, positions: {}, groups: {}}));
const capture = resolve('.plans/artifacts/blasting-import/standalone-import.png');
const before = await stat(archive);
await new Promise((done, reject) => {
  const child = spawn(resolve(process.env.STI2_WINDOWS_EXE ?? 'builds/windows/FactoryPlanner.exe'),
    ['--audio-driver', 'Dummy', '--log-file', join(scratch, 'application.log'), '--',
      '--capture-existing', `--capture-path=${capture}`, `--world=${resolve(archive)}`],
    {env: {...process.env, PATH: '', APPDATA: scratch}, windowsHide: true, stdio: 'pipe'});
  let output = '';
  child.stdout.on('data', bytes => {output += bytes;});
  child.stderr.on('data', bytes => {output += bytes;});
  const timer = setTimeout(() => {child.kill(); reject(new Error(`Blast-furnace import timed out. ${output}`));}, 120000);
  child.once('error', error => {clearTimeout(timer); reject(error);});
  child.once('exit', code => {
    clearTimeout(timer);
    if (code !== 0 || /SCRIPT ERROR|ERROR:/.test(output)) reject(new Error(`Blast-furnace import failed (${code}). ${output}`));
    else done();
  });
});
const saved = JSON.parse(await readFile(join(user, 'autosave.json'), 'utf8'));
assert.equal(saved.imported_world.machines.length, 4);
assert.equal(saved.imported_world.reconstruction.unresolved.length, 2);
assert.equal(saved.request.goals.length, 2);
assert.ok(saved.request.goals.every(value => value.kind === 'capacity' && value.machines === 1));
assert.ok(Object.keys(saved.positions).length >= 2);
assert.deepEqual(saved.imported_world.errors, []);
assert.equal((await stat(archive)).mtimeMs, before.mtimeMs);
assert.ok((await stat(capture)).size > 10000);
console.log(`The standalone export recalculated two imported blast-furnace goals from the real ZIP with empty PATH: ${scratch}`);
