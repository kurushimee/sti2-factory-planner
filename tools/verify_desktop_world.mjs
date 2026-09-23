import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir, mkdtemp, stat} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import assert from 'node:assert/strict';
import {readDataset} from './read_dataset.mjs';

if (process.platform !== 'win32') throw new Error('Run the exported Windows check on Windows.');
const [archive, catalog = 'data/statech-2.0.1.json.gz'] = process.argv.slice(2);
if (!archive) throw new Error('Supply the controlled array-world ZIP.');
const appdata = await mkdtemp('F:/sti2-work/desktop-world-');
const user = join(appdata, 'Godot', 'app_userdata', 'STI2 Factory Planner');
await mkdir(user, {recursive: true});
const dataset = await readDataset(catalog);
const request = {goals: [], replication: true,
  available_machines: ['modern_industrialization:electric_macerator', 'modern_industrialization:replicator', 'ae2:molecular_assembler',
    'modern_industrialization:electric_blast_furnace', 'yet_another_industrialization:nuclear_rod_irradiator'],
  external: ['fluid:modern_industrialization:crude_oil', 'item:spectrum:copper_cluster', 'energy:eu',
    'fluid:modern_industrialization:uu_matter', 'item:minecraft:oak_planks', 'item:modern_industrialization:uncooked_steel_dust',
    'item:modern_industrialization:uranium_fuel_rod', 'item:modern_industrialization:beryllium_block'].map(resource => ({resource}))};
await writeFile(join(user, 'autosave.json'), JSON.stringify({format: 'factory-plan', version: 1, dataset_identity: dataset.identity,
  dataset, request, positions: {}, groups: {}}));
const capture = resolve('.plans/artifacts/workspace/standalone-world.png'), log = join(appdata, 'application.log');
const started = Date.now(), before = await stat(archive);
await new Promise((resolveRun, reject) => {
  const child = spawn(resolve('builds/windows/FactoryPlanner.exe'), ['--audio-driver', 'Dummy', '--log-file', log, '--',
    '--capture-existing', `--capture-path=${capture}`, `--world=${resolve(archive)}`],
  {env: {...process.env, PATH: '', APPDATA: appdata}, windowsHide: true, stdio: 'pipe'});
  let output = '';
  child.stdout.on('data', bytes => {output += bytes;});
  child.stderr.on('data', bytes => {output += bytes;});
  const timer = setTimeout(() => {child.kill(); reject(new Error(`World import timed out. ${output}`));}, 120000);
  child.once('error', error => {clearTimeout(timer); reject(error);});
  child.once('exit', code => {
    clearTimeout(timer);
    if (code !== 0 || /SCRIPT ERROR|ERROR:/.test(output)) reject(new Error(`World import failed (${code}). ${output}`));
    else resolveRun();
  });
});
const saved = JSON.parse(await readFile(join(user, 'autosave.json'), 'utf8'));
assert.equal(saved.imported_world.machines.length, 12);
assert.equal(saved.request.goals.length, 7);
assert.deepEqual(saved.imported_world.errors, []);
assert.ok(Object.keys(saved.positions).length >= 7);
for (const x of [320, 384]) {
  const machine = saved.imported_world.machines.find(value => value.origin.x === x);
  assert.equal(machine.contained_machine.count, 8);
  assert.equal(machine.upgrades.count, 4);
}
assert.ok((await stat(capture)).mtimeMs >= started);
assert.equal((await stat(archive)).mtimeMs, before.mtimeMs);
console.log(`The standalone export imported 12 machines and seven goals from ${before.size} bytes with empty PATH: ${appdata}`);
