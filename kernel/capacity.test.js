import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {machineCapacity, miPower} from './capacity.js';

test('MI power agrees with the loaded 2.5.8 reference samples', () => {
  const report = JSON.parse(readFileSync(new URL('../data/provenance/runtime-report.json', import.meta.url)));
  for (const sample of report.arithmetic) {
    assert.equal(miPower(sample.recipe_eu, sample.total_eu, 8, 32, sample.efficiency), sample.max_eu);
  }
});

const macerator = {mechanic: 'mi_crafter', base_eu: 8, max_eu: 32, upgrade_limit: 64, upgrades: ['basic']};

test('whole ticks determine capacity and final-tick energy', () => {
  const result = machineCapacity({duration_ticks: 200, eu_per_tick: 2}, macerator);
  assert.equal(result.ticks_per_batch, 13);
  assert.equal(result.operations_per_second, 20 / 13);
  assert.equal(result.average_full_load_eu_per_tick, 400 / 13);
  assert.equal(result.efficiency_limit, 36);
  assert.equal(result.completion_ticks[0], 50);
  assert(result.warmup_ticks > 36);
});

test('the real 16-operation assembler applies its discount before the upgrade bonus', () => {
  const machine = {mechanic: 'mi_batch', base_eu: 8, max_eu: 32, batch_limit: 16, energy_multiplier: 0.85, upgrade_limit: 64, upgrades: ['basic']};
  const result = machineCapacity({duration_ticks: 125000, eu_per_tick: 8}, machine, {batch: 16, upgrade_count: 1, upgrade: {id: 'basic', extra_max_eu: 2}});
  assert.equal(result.energy_per_batch, 13600000);
  assert.equal(result.peak_eu_per_tick, Math.trunc(Math.fround(Math.fround(32 * 16) * Math.fround(0.85))) + 2);
});

test('buffers include the time before the first output even without warm-up', () => {
  const result = machineCapacity({duration_ticks: 20, eu_per_tick: 2}, {mechanic: 'mi_crafter', base_eu: 2, max_eu: 2});
  assert.equal(result.warmup_ticks, 0);
  assert.equal(result.output_buffer_operations, 1);
});

test('invalid limits and unsupported rules fail explicitly', () => {
  assert.throws(() => machineCapacity({duration_ticks: 20, eu_per_tick: 64}, macerator), /voltage/);
  assert.throws(() => machineCapacity({duration_ticks: 20, eu_per_tick: 2}, macerator, {upgrade_count: 65, upgrade: {id: 'basic', extra_max_eu: 2}}), /count/);
  assert.throws(() => machineCapacity({duration_ticks: 20, eu_per_tick: 2}, macerator, {upgrade_count: 1, upgrade: {id: 'unknown', extra_max_eu: 2}}), /incompatible/);
  assert.throws(() => machineCapacity({duration_ticks: 20, eu_per_tick: 2}, {...macerator, mechanic: 'guessed'}), /Unsupported/);
  assert.throws(() => machineCapacity({duration_ticks: 1e16, eu_per_tick: 2}, macerator), /safe integer/);
});
test('molecular assemblers charge the full final tick and enforce five card slots', () => {
  const machine = {mechanic: 'ae_molecular_assembler', eu_per_ae: 0.2, usage_multiplier: 1};
  const base = machineCapacity({}, machine);
  assert.equal(base.operations_per_second, 2);
  assert.equal(base.eu_per_operation, 20);
  const one = machineCapacity({}, machine, {upgrade_count: 1, upgrade: {id: 'ae2:speed_card'}});
  assert.equal(one.ticks_per_batch, 8);
  assert(Math.abs(one.eu_per_operation - 27.04) < 1e-10);
  const five = machineCapacity({}, machine, {upgrade_count: 5, upgrade: {id: 'ae2:speed_card'}});
  assert.equal(five.operations_per_second, 10);
  assert.equal(five.eu_per_operation, 100);
  assert.throws(() => machineCapacity({}, machine, {upgrade_count: 6}), /five/);
});
test('arrays use their own power limit and reject incompatible machines and shapes', () => {
  const machine = {mechanic: 'mi_array', base_eu: 8, max_eu: 32, energy_multiplier: 1,
    shape_capacities: [8, 16, 32, 64], eligible_machines: ['mi:macerator'],
    upgrade_limit: 64, upgrades: ['mi:turbo']};
  const setup = {contained_machine: 'mi:macerator', contained_count: 16, shape: 1,
    upgrade: {id: 'mi:turbo', extra_max_eu: 64}, upgrade_count: 4};
  const recipe = {duration_ticks: 200, eu_per_tick: 2};
  const result = machineCapacity(recipe, machine, setup);
  assert.equal(result.ticks_per_batch, 9);
  assert.equal(result.energy_per_batch, 6400);
  assert.equal(result.eu_per_operation, 400);
  assert.equal(result.peak_eu_per_tick, 768);
  assert.throws(() => machineCapacity(recipe, machine, {...setup, shape: 0}), /shape/);
  assert.throws(() => machineCapacity(recipe, machine, {...setup, contained_machine: 'mi:batching_replacement'}), /cannot be placed/);
});
