import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructFactory} from './reconstruct.js';

const origin = x => ({dimension: 'minecraft:overworld', x, y: 64, z: 4});
const rule = {id: 'mi:lv_storage_unit', status: 'infrastructure', mechanic: 'energy_storage',
  storage: {capacity_eu: 3200000, charge_eu_per_tick: 256, discharge_eu_per_tick: 256,
    loss_eu_per_tick: 0, saved_charge_field: 'storedEu'}};
const dataset = {machines: [rule], recipes: []};
const saved = (x, storedEu) => ({id: rule.id, origin: origin(x), facts: {storedEu}});

test('saved storage remains startup state rather than a recipe or production goal', () => {
  const result = reconstructFactory({machines: [saved(1, '1066666'), saved(2, '3200000')]}, dataset);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.assignments, []);
  assert.deepEqual(result.goals, []);
  assert.equal(result.storage_units.length, 2);
  assert.equal(result.storage_units[0].saved_charge_eu, '1066666');
  assert.equal(result.storage_units[0].enabled, true);
  assert.equal(result.storage_units[0].charge_eu_per_tick, 256);
  assert.equal(result.storage_units[1].capacity_eu, 3200000);
  assert.match(result.storage_units[0].assumption, /not a sustained power supply/);
  const excluded = reconstructFactory({machines: [saved(1, '1')]}, dataset,
    {'minecraft:overworld|1|64|4': {exclude: true}});
  assert.deepEqual(excluded.storage_units, []);
  const disabled = reconstructFactory({machines: [saved(1, '1')]}, dataset,
    {'minecraft:overworld|1|64|4': {storage_enabled: false}});
  assert.equal(disabled.storage_units[0].enabled, false);
  assert.equal(disabled.storage_units[0].saved_charge_eu, '1');
});

test('missing and impossible stored charge receive focused corrections', () => {
  for (const value of [undefined, '-1', '3200001', '1.5', 'abc']) {
    const result = reconstructFactory({machines: [saved(1, value)]}, dataset);
    assert.equal(result.storage_units.length, 0);
    assert.match(result.unresolved[0].reason, /saved charge/);
  }
  const unknown = reconstructFactory({machines: [saved(1, '1')]},
    {machines: [{...rule, storage: {...rule.storage, loss_eu_per_tick: 1}}], recipes: []});
  assert.equal(unknown.storage_units.length, 0);
  assert.match(unknown.unresolved[0].reason, /loss rule/);
  const missingTier = reconstructFactory({machines: [{...saved(2, '1'), id: 'mi:new_storage_unit'}]}, dataset);
  assert.equal(missingTier.storage_units.length, 0);
  assert.match(missingTier.unresolved[0].reason, /missing from the dataset/);
  assert.equal(missingTier.unresolved[0].facts.facts.storedEu, '1');
});
