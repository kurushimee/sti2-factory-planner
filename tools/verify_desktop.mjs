import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir, mkdtemp, stat} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';

if (process.platform !== 'win32') throw new Error('Run the exported Windows check on Windows.');
const executable = resolve(process.argv[2] ?? 'builds/windows/FactoryPlanner.exe');
const scratch = resolve(process.argv[3] ?? 'F:/sti2-work');
await mkdir(scratch, {recursive: true});
const appdata = await mkdtemp(join(scratch, 'desktop-check-'));
const user = join(appdata, 'Godot', 'app_userdata', 'STI2 Factory Planner');
await mkdir(user, {recursive: true});
const dataset = JSON.parse(gunzipSync(await readFile('data/statech-2.0.1.json.gz')));
const plan = process.argv[4] ? JSON.parse(await readFile(process.argv[4], 'utf8')) : {format: 'factory-plan', version: 1, dataset_identity: dataset.identity, dataset,
  request: {goals: [{recipe: 'waste_collection|extended_industrialization:electric_waste_collector', resource: 'fluid:extended_industrialization:manure', rate: 2000 / 15}],
    available_machines: ['extended_industrialization:electric_waste_collector'], external: [{resource: 'energy:eu'}]},
  positions: {}, groups: {}};
const recipe = plan.request.goals[0].recipe;
await writeFile(join(user, 'autosave.json'), JSON.stringify(plan));
const capture = resolve('.plans/artifacts/workspace/standalone-bundled-plan.png');
await mkdir(resolve('.plans/artifacts/workspace'), {recursive: true});
const log = join(appdata, 'application.log');
const resultPath = join(appdata, 'calculation-result.json');
const started = Date.now();
await new Promise((resolveRun, reject) => {
  const child = spawn(executable, ['--audio-driver', 'Dummy', '--log-file', log, '--', '--capture-existing', `--capture-path=${capture}`, `--capture-result=${resultPath}`],
    {env: {...process.env, PATH: '', APPDATA: appdata}, windowsHide: true, stdio: 'pipe'});
  let output = '';
  const observe = setInterval(async () => {
    let result;
    try {result = JSON.parse(await readFile(resultPath, 'utf8'));} catch {return;}
    if (result.status && !['optimal', 'feasible'].includes(result.status)) {
      clearInterval(observe); child.kill();
      reject(new Error(`The exported calculation failed: ${JSON.stringify({status: result.status, phase: result.phase, reason: result.reason, construction_status: result.construction_status})}`));
    }
  }, 250);
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => { clearInterval(observe); child.kill(); reject(new Error(`The exported application timed out. ${output}`)); },
    Math.max(60000, (plan.request.time_limit_ms ?? 0) + 30000));
  child.once('error', error => { clearInterval(observe); clearTimeout(timer); reject(error); });
  child.once('exit', code => {
    clearTimeout(timer);
    clearInterval(observe);
    if (code !== 0 || /SCRIPT ERROR|ERROR:/.test(output)) reject(new Error(`The exported application failed (${code}). ${output}`));
    else resolveRun();
  });
});
const saved = JSON.parse(await readFile(join(user, 'autosave.json'), 'utf8'));
assert.equal(saved.dataset_identity, plan.dataset_identity);
assert.equal(saved.request.goals[0].recipe, recipe);
assert.deepEqual(saved.request.construction, plan.request.construction);
assert.deepEqual(saved.request.infrastructure, plan.request.infrastructure);
assert.ok(Object.keys(saved.positions).some(key => key.includes(recipe)));
assert.ok((await stat(capture)).mtimeMs >= started);
assert.ok((await stat(capture)).size > 10000);
const output = await readFile(log, 'utf8');
assert.doesNotMatch(output, /SCRIPT ERROR|ERROR:/);
console.log(`The Windows export calculated and saved ${plan.dataset_identity} with empty PATH and isolated APPDATA: ${appdata}`);
