import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import loadHighs from 'highs';
import {solveFactory} from '../kernel/planner.js';

const path = process.argv[2];
if (!path) throw new Error('Pass a solar-enabled StaTech dataset.');
const raw = readFileSync(path);
const data = JSON.parse(path.endsWith('.gz') ? gunzipSync(raw) : raw);
const panels = data.recipes.filter(recipe => recipe.type === 'planner:solar_generation');
assert.equal(panels.length, 6);
for (const recipe of panels) {
  const configuration = recipe.configurations[0];
  const profile = configuration.periodic_generation;
  assert.equal(profile.segments.reduce((sum, entry) => sum + entry.ticks, 0), 24000);
  assert.ok(profile.one_event_loss_eu_per_period > 0);
  assert.equal(data.machines.find(machine => machine.id === configuration.machine)?.status, 'supported');
  assert.equal(recipe.inputs[0].amount, 1 / 1200);
  if (recipe.id.endsWith('|water')) assert.equal(recipe.inputs[1].amount, 11999 / 1200);
}

const highs = await loadHighs();
const panel = 'extended_industrialization:lv_solar_panel';
const storage = 'modern_industrialization:lv_storage_unit';
const request = {goals: [{resource: 'energy:eu', rate: 280}],
  available_machines: [panel, storage], periodic_storage: [storage],
  external: [{resource: 'item:extended_industrialization:lv_photovoltaic_cell'}],
  time_limit_ms: 30000};
const result = solveFactory(highs, data, request);
assert.ok(result.lines, `The LV solar goal was not solved: ${result.status}.`);
assert.equal(result.lines.find(line => line.machine === panel)?.machines, 1);
assert.equal(result.periodic_power.storage.find(unit => unit.machine === storage)?.machines, 1);
assert.equal(result.periodic_power.event_buffer_eu, 64);
assert.ok(result.periodic_power.storage[0].initial_charge_eu >= 64);
assert.equal(result.startup.resources.find(flow => flow.resource ===
  'item:extended_industrialization:lv_photovoltaic_cell')?.first_operation_stock, 1);
assert.equal(result.startup.energy_storage_initial_charge_eu,
  result.periodic_power.storage[0].initial_charge_eu);
assert.equal(result.external.find(flow => flow.resource === 'item:extended_industrialization:lv_photovoltaic_cell').rate, 1 / 1200);
assert.equal(solveFactory(highs, data, {...request, periodic_storage: []}).status, 'infeasible');
console.log('A measured LV solar panel and one LV storage unit cover 14 EU/t under the stated clear-weather conditions.');
