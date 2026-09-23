import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir, mkdtemp, stat} from 'node:fs/promises';
import {resolve, join} from 'node:path';

if (process.platform !== 'win32') throw new Error('Run the standalone check on Windows.');
const planPath = process.argv[2];
if (!planPath) throw new Error('Supply the confirmed portable plan from the embedded browser check.');
const executable = resolve(process.env.STI2_WINDOWS_EXE ?? 'builds/windows/FactoryPlanner.exe');
const plan = JSON.parse(await readFile(planPath, 'utf8'));
const route = 'planner:solar|extended_industrialization:lv_solar_panel|water';
const key = 'minecraft:overworld|400|250|0';
const scratch = await mkdtemp('F:/sti2-work/solar-cell-desktop-');
const user = join(scratch, 'Godot', 'app_userdata', 'STI2 Factory Planner');
await mkdir(user, {recursive: true});
await writeFile(join(user, 'autosave.json'), JSON.stringify(plan));
const artifacts = resolve('.plans/artifacts/solar-cell');
await mkdir(artifacts, {recursive: true});
const capture = join(artifacts, 'standalone-confirmed-panel.png');
const resultPath = join(scratch, 'result.json');
await new Promise((done, reject) => {
  const child = spawn(executable, ['--audio-driver', 'Dummy', '--log-file', join(scratch, 'application.log'), '--',
    '--capture-existing', `--capture-path=${capture}`, `--capture-result=${resultPath}`],
  {env: {...process.env, PATH: '', APPDATA: scratch}, windowsHide: true, stdio: 'pipe'});
  let output = '';
  child.stdout.on('data', bytes => {output += bytes;});
  child.stderr.on('data', bytes => {output += bytes;});
  const timer = setTimeout(() => {child.kill(); reject(new Error(`Standalone solar check timed out. ${output}`));}, 120000);
  child.once('error', error => {clearTimeout(timer); reject(error);});
  child.once('exit', code => {
    clearTimeout(timer);
    if (code !== 0 || /SCRIPT ERROR|ERROR:/.test(output)) reject(new Error(`Standalone solar check failed (${code}). ${output}`));
    else done();
  });
});
const result = JSON.parse(await readFile(resultPath, 'utf8'));
assert.ok(['optimal', 'feasible'].includes(result.status));
assert.equal(result.lines.find(line => line.recipe === route)?.machines, 1);
const saved = JSON.parse(await readFile(join(user, 'autosave.json'), 'utf8'));
assert.equal(saved.imported_world.corrections[key].solar_cell_confirmed, true);
assert.equal(saved.imported_world.reconstruction.solar_panels[0].saved_cell, null);
assert.equal(saved.imported_world.reconstruction.solar_panels[0].cell_evidence, 'player_supply_confirmation');
assert.deepEqual(saved.request.external, plan.request.external);
assert.equal(saved.request.installed[route], 1);
assert.ok((await stat(capture)).size > 10000);
console.log(`The standalone export restored and calculated the confirmed solar panel with empty PATH: ${scratch}`);
