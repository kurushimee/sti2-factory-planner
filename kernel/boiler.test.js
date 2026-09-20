import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {boilerWarmup} from './boiler.js';

test('cold boiler schedules match actual loaded MI heater and burner ticks', () => {
  const reference = JSON.parse(readFileSync(new URL('../data/provenance/runtime-report.json', import.meta.url))).boiler_warmup;
  for (const [id, expected] of Object.entries(reference)) {
    const result = boilerWarmup({max_eu_per_tick: id.includes('bronze') ? 8 : 16, eu_per_degree: 8, temperature_max: 1500}, {kind: 'item', eu_per_unit: 32000});
    assert.equal(result.first_full_output_tick, expected.first_full_output_tick);
    assert.equal(result.steam_produced, expected.steam_produced);
    assert.equal(result.water_consumed, expected.water_consumed);
    assert.equal(result.fuel_consumed, expected.coal_consumed);
    assert.equal(result.steam_deficit, expected.steam_deficit);
    assert.deepEqual(result.output_segments, expected.output_segments);
  }
});

test('fluid fuel must fit the real boiler refill threshold', () => {
  assert.throws(() => boilerWarmup({max_eu_per_tick: 8, eu_per_degree: 8, temperature_max: 1500}, {kind: 'fluid', eu_per_unit: 1000}), /threshold/);
});
