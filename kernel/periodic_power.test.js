import test from 'node:test';
import assert from 'node:assert/strict';
import {balancePeriodicPower} from './periodic_power.js';

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
