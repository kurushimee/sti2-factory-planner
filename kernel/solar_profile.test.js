import test from 'node:test';
import assert from 'node:assert/strict';
import {balancePeriodicPower} from './periodic_power.js';
import {clearSolarEfficiency, clearSolarProfile} from './solar_profile.js';

test('released LV curve reproduces independently captured clear-day totals', () => {
  for (const [time, efficiency] of [[0, 0], [1500, 1], [6000, 1], [10500, 1], [12000, 0], [12001, 0]]) {
    assert.equal(clearSolarEfficiency(time), efficiency);
  }
  const dry = clearSolarProfile(32);
  assert.equal(dry.total_eu, 336782);
  assert.equal(dry.water_mb, 0);
  assert.equal(dry.cells_consumed, 0);
  assert.equal(dry.ending_cell_wear, 11999);
  const wet = clearSolarProfile(32, {distilled_water: true});
  assert.equal(wet.total_eu, 505934);
  assert.equal(wet.water_mb, 11999);
  assert.equal(wet.ending_cell_wear, 5999);
});

test('cell expiry loses one active generation tick before immediate replacement', () => {
  const dry = clearSolarProfile(32, {cell_wear: 11999});
  assert.equal(dry.cells_consumed, 1);
  assert.equal(dry.ending_cell_wear, 11998);
  assert.equal(dry.power_eu_per_tick[1500], 32);
  const noonGap = clearSolarProfile(32, {cell_wear: 10500});
  assert.equal(noonGap.power_eu_per_tick[1500], 0);
  assert.equal(noonGap.total_eu, 336750);
  const wet = clearSolarProfile(32, {distilled_water: true, cell_wear: 11999, generator_tick: 19});
  assert.equal(wet.cells_consumed, 1);
  assert.equal(wet.water_mb, 11999);
  const wetNoonGap = clearSolarProfile(32, {distilled_water: true, cell_wear: 11250});
  assert.equal(wetNoonGap.power_eu_per_tick[1500], 0);
  assert.equal(wetNoonGap.total_eu, 505886);
});

test('one LV panel needs real overnight storage for a constant load', () => {
  const profile = clearSolarProfile(32);
  const balance = balancePeriodicPower([...profile.power_eu_per_tick], Array(24000).fill(14),
    {capacity_eu: 3200000, charge_eu_per_tick: 256, discharge_eu_per_tick: 256});
  assert.equal(balance.status, 'feasible');
  assert(balance.required_capacity_eu > 170000 && balance.required_capacity_eu < 180000);
  assert.equal(balancePeriodicPower([...profile.power_eu_per_tick], Array(24000).fill(14)).reason, 'discharge_limit');
});
