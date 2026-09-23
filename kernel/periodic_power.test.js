import test from 'node:test';
import assert from 'node:assert/strict';
import {balancePeriodicPower, minimumStorageCount} from './periodic_power.js';
import {clearSolarProfile} from './solar_profile.js';

test('a full day covers a constant load only with an overnight charge', () => {
  const storage = {capacity_eu: 2, charge_eu_per_tick: 1, discharge_eu_per_tick: 1};
  const dayFirst = balancePeriodicPower([2, 2, 0, 0], [1, 1, 1, 1], storage);
  assert.equal(dayFirst.status, 'feasible');
  assert.equal(dayFirst.required_capacity_eu, 2);
  assert.equal(dayFirst.required_initial_charge_eu, 0);
  assert.equal(dayFirst.ending_charge_eu, 0);
  const nightFirst = balancePeriodicPower([0, 0, 2, 2], [1, 1, 1, 1], storage);
  assert.equal(nightFirst.status, 'feasible');
  assert.equal(nightFirst.required_initial_charge_eu, 2);
  assert.equal(nightFirst.ending_charge_eu, 2);
});

test('energy average, transfer, and capacity are separate requirements', () => {
  const generation = [2, 2, 0, 0], demand = [1, 1, 1, 1];
  assert.deepEqual(balancePeriodicPower(generation, demand,
    {capacity_eu: 2, charge_eu_per_tick: 0.5, discharge_eu_per_tick: 1}).reason, 'period_energy');
  assert.deepEqual(balancePeriodicPower(generation, demand,
    {capacity_eu: 2, charge_eu_per_tick: 1, discharge_eu_per_tick: 0.5}).reason, 'discharge_limit');
  const small = balancePeriodicPower(generation, demand,
    {capacity_eu: 1, charge_eu_per_tick: 1, discharge_eu_per_tick: 1});
  assert.equal(small.reason, 'storage_capacity');
  assert.equal(small.required_capacity_eu, 2);
});

test('curtailed daytime power does not masquerade as replenished storage', () => {
  const result = balancePeriodicPower([10, 10, 0, 0], [1, 1, 1, 1],
    {capacity_eu: 2, charge_eu_per_tick: 10, discharge_eu_per_tick: 1});
  assert.equal(result.status, 'feasible');
  assert.equal(result.required_capacity_eu, 2);
  assert.equal(result.curtailed_generation_eu, 16);
});

test('invalid profiles and storage bounds fail explicitly', () => {
  assert.throws(() => balancePeriodicPower([], []), /nonempty/);
  assert.throws(() => balancePeriodicPower([1], [NaN]), /Demand/);
  assert.throws(() => balancePeriodicPower([1], [0], {capacity_eu: -1}), /capacity/);
});

test('circular storage sizing agrees with an independent discrete-state search', () => {
  for (let code = 0; code < 625; code++) {
    let value = code;
    const net = Array.from({length: 4}, () => { const digit = value % 5 - 2; value = Math.floor(value / 5); return digit; });
    const generation = net.map(amount => Math.max(0, amount));
    const demand = net.map(amount => Math.max(0, -amount));
    for (let capacity = 0; capacity <= 6; capacity++) {
      const expected = [];
      for (let initial = 0; initial <= capacity; initial++) {
        let stored = initial, possible = true;
        for (const amount of net) {
          stored = Math.min(capacity, stored + amount);
          if (stored < 0) { possible = false; break; }
        }
        if (possible && stored >= initial) expected.push(initial);
      }
      const result = balancePeriodicPower(generation, demand,
        {capacity_eu: capacity, charge_eu_per_tick: 2, discharge_eu_per_tick: 2});
      assert.equal(result.status === 'feasible', expected.length > 0, `net=${net}, capacity=${capacity}`);
      if (expected.length) assert.equal(result.required_initial_charge_eu, expected[0], `net=${net}, capacity=${capacity}`);
    }
  }
});

test('whole storage sizing includes both transfer directions and period capacity', () => {
  const rule = {capacity_eu: 2, charge_eu_per_tick: 2, discharge_eu_per_tick: 1, loss_eu_per_tick: 0};
  const generation = [4, 0, 0, 0], demand = [1, 1, 1, 1];
  assert.equal(minimumStorageCount(generation, demand, rule, 1).status, 'infeasible');
  const sized = minimumStorageCount(generation, demand, rule, 10);
  assert.equal(sized.count, 2);
  assert.equal(sized.balance.required_capacity_eu, 3);
  assert.equal(minimumStorageCount([2], [1], rule, 10).count, 0);
  assert.throws(() => minimumStorageCount(generation, demand, {...rule, loss_eu_per_tick: 1}, 10), /loss adapter/);
});

test('one measured LV storage unit covers a verified clear day at 14 EU per tick', () => {
  const profile = clearSolarProfile(32);
  const demand = Array(profile.power_eu_per_tick.length).fill(14);
  const sized = minimumStorageCount(Array.from(profile.power_eu_per_tick), demand,
    {capacity_eu: 3200000, charge_eu_per_tick: 256, discharge_eu_per_tick: 256,
      loss_eu_per_tick: 0}, 10);
  assert.equal(sized.count, 1);
  assert.ok(sized.balance.required_capacity_eu > 170000);
  assert.ok(sized.balance.ending_charge_eu >= sized.balance.required_initial_charge_eu);
});
