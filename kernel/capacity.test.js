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
