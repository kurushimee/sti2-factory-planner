import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir, mkdtemp, stat} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {readDataset} from './read_dataset.mjs';

if (process.platform !== 'win32') throw new Error('Run the exported Windows check on Windows.');
const archive = process.argv[2];
if (!archive) throw new Error('Supply the private charged-storage world ZIP.');
const scratch = await mkdtemp('F:/sti2-work/storage-desktop-');
const user = join(scratch, 'Godot', 'app_userdata', 'STI2 Factory Planner');
await mkdir(user, {recursive: true});
const artifacts = resolve('.plans/artifacts/storage-import');
await mkdir(artifacts, {recursive: true});
const dataset = await readDataset('data/statech-2.0.1.json.gz');
await writeFile(join(user, 'autosave.json'), JSON.stringify({format: 'factory-plan', version: 1,
  dataset_identity: dataset.identity, dataset, request: {goals: []}, positions: {}, groups: {}}));
const capture = join(artifacts, 'standalone-import.png');
const before = await stat(archive);
await new Promise((done, reject) => {
  const child = spawn(resolve(process.env.STI2_WINDOWS_EXE ?? 'builds/windows/FactoryPlanner.exe'),
    ['--audio-driver', 'Dummy', '--log-file', join(scratch, 'application.log'), '--',
      '--capture-existing', `--capture-path=${capture}`, `--world=${resolve(archive)}`],
    {env: {...process.env, PATH: '', APPDATA: scratch}, windowsHide: true, stdio: 'pipe'});
  let output = '';
  child.stdout.on('data', bytes => {output += bytes;});
  child.stderr.on('data', bytes => {output += bytes;});
  const timer = setTimeout(() => {child.kill(); reject(new Error(`Storage import timed out. ${output}`));}, 120000);
  child.once('error', error => {clearTimeout(timer); reject(error);});
  child.once('exit', code => {
    clearTimeout(timer);
    if (code !== 0 || /SCRIPT ERROR|ERROR:/.test(output)) reject(new Error(`Storage import failed (${code}). ${output}`));
    else done();
  });
});
const saved = JSON.parse(await readFile(join(user, 'autosave.json'), 'utf8'));
const units = saved.imported_world.reconstruction.storage_units;
assert.equal(saved.imported_world.machines.length, 5);
assert.deepEqual(saved.imported_world.errors, []);
assert.deepEqual(saved.imported_world.reconstruction.unresolved, []);
assert.equal(units.length, 5);
assert.ok(units.every(unit => unit.enabled && /^\d+$/.test(unit.saved_charge_eu)));
assert.equal(saved.request.goals.length, 0);
assert.equal(saved.request.periodic_storage.length, 5);
assert.ok(Object.values(saved.request.periodic_storage_installed).every(count => count === 1));
assert.equal(Object.keys(saved.positions).filter(key => key.startsWith('planner:storage|')).length, 5);
assert.equal((await stat(archive)).mtimeMs, before.mtimeMs);
assert.ok((await stat(capture)).size > 10000);
console.log(`The standalone export imported five charged storage units without goals or sustained supply: ${scratch}`);
