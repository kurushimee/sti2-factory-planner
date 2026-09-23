import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir, mkdtemp, stat} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {readDataset} from './read_dataset.mjs';

if (process.platform !== 'win32') throw new Error('Run the exported Windows check on Windows.');
const archive = process.argv[2];
if (!archive) throw new Error('Supply the private solar-panel world ZIP.');
const scratch = await mkdtemp('F:/sti2-work/solar-desktop-');
const user = join(scratch, 'Godot', 'app_userdata', 'STI2 Factory Planner');
await mkdir(user, {recursive: true});
const artifacts = resolve('.plans/artifacts/solar-import');
await mkdir(artifacts, {recursive: true});
const dataset = await readDataset('data/statech-2.0.1.json.gz');
const panels = ['lv', 'mv', 'hv'].map(tier => `extended_industrialization:${tier}_solar_panel`);
const supplies = ['lv', 'mv', 'hv'].map(tier => ({resource: `item:extended_industrialization:${tier}_photovoltaic_cell`}));
supplies.push({resource: 'fluid:extended_industrialization:distilled_water'});
await writeFile(join(user, 'autosave.json'), JSON.stringify({format: 'factory-plan', version: 1,
  dataset_identity: dataset.identity, dataset,
  request: {goals: [], available_machines: panels, external: supplies, time_limit_ms: 30000},
  positions: {}, groups: {}}));
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
  const timer = setTimeout(() => {child.kill(); reject(new Error(`Solar import timed out. ${output}`));}, 120000);
  child.once('error', error => {clearTimeout(timer); reject(error);});
  child.once('exit', code => {
    clearTimeout(timer);
    if (code !== 0 || /SCRIPT ERROR|ERROR:/.test(output)) reject(new Error(`Solar import failed (${code}). ${output}`));
    else done();
  });
});
const saved = JSON.parse(await readFile(join(user, 'autosave.json'), 'utf8'));
const imported = saved.imported_world;
assert.equal(imported.machines.length, 3);
assert.deepEqual(imported.errors, []);
assert.deepEqual(imported.reconstruction.unresolved, []);
assert.equal(imported.reconstruction.solar_panels.length, 3);
assert.ok(imported.reconstruction.solar_panels.every(panel => panel.enabled && panel.saved_cell.amount === '1' && panel.saved_fluid.amount_mb === '9'));
assert.equal(saved.request.goals.length, 0);
assert.equal(Object.keys(saved.request.installed).length, 3);
assert.ok(Object.values(saved.request.installed).every(count => count === 1));
assert.deepEqual(saved.request.periodic_storage, ['modern_industrialization:mv_storage_unit']);
assert.equal(Object.keys(saved.positions).filter(key => key.startsWith('planner:solar|')).length, 3);
assert.equal((await stat(archive)).mtimeMs, before.mtimeMs);
assert.ok((await stat(capture)).size > 10000);
console.log(`The standalone export imported three saved solar panels into the power plan: ${scratch}`);
