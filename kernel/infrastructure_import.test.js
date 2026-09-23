import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructFactory} from './reconstruct.js';
import {infrastructurePower} from './infrastructure.js';

const origin = x => ({dimension: 'minecraft:overworld', x, y: 100, z: 0});
const dataset = {recipes: [], machines: [
  {id: 'tower', mechanic: 'passive_infrastructure', infrastructure: [{id: '0', structure: {shape: 0}, passive_eu_per_tick: 64, max_transfer_eu_per_tick: 1536}]},
  {id: 'lv', hatch_capacity: {cable_eu_per_tick: 256}}, {id: 'mv', hatch_capacity: {cable_eu_per_tick: 1024}},
]};
const tower = x => ({id: 'tower', origin: origin(x), shape: 0, structure: {status: 'matching_saved_geometry'}, facts: {redstoneModuleStack: {}}});
const hatch = (x, id) => ({id, origin: origin(x + 1), controller: origin(x), association_evidence: 'unique_matching_saved_geometry', hatch_type: 'modern_industrialization:energy_input', facts: {storedEu: '19200'}});

test('saved towers retain distinct receiver tiers without inventing production rates', () => {
  const result = reconstructFactory({machines: [tower(0), tower(10)], parts: [hatch(0, 'lv'), hatch(10, 'mv')]}, dataset);
  assert.deepEqual(result.goals, []);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.infrastructure.map(value => value.energy_hatch), ['lv', 'mv']);
  assert.equal(result.infrastructure[0].imported_hatches.length, 1);
  assert.equal(result.infrastructure[0].transmit_eu_per_tick, 1536);
  assert.match(result.infrastructure[0].transmission_basis, /not a saved operating rate/);
  const overheadOnly = result.infrastructure.map(({energy_hatch, ...value}) => value);
  assert.equal(infrastructurePower(dataset, {infrastructure: overheadOnly}).total_eu_per_tick, 128);
  assert.throws(() => infrastructurePower(dataset, {infrastructure: [overheadOnly[0], overheadOnly[0]]}), /Duplicate/);
});

test('conditional operation, conflicting hatches and missing geometry require focused corrections', () => {
  const controlled = tower(0);
  controlled.facts.redstoneModuleStack = {id: 'redstone_control'};
  const world = {machines: [controlled], parts: [hatch(0, 'lv')]};
  const initial = reconstructFactory(world, dataset);
  assert.equal(initial.infrastructure.length, 0);
  assert.match(initial.unresolved[0].reason, /redstone control/);
  const key = 'minecraft:overworld|0|100|0';
  assert.equal(reconstructFactory(world, dataset, {[key]: {infrastructure_enabled: true}}).infrastructure.length, 1);
  const excluded = reconstructFactory(world, dataset, {[key]: {infrastructure_enabled: false}});
  assert.equal(excluded.infrastructure.length, 0);
  assert.equal(excluded.unresolved.length, 0);
  world.parts.push(hatch(0, 'mv'));
  assert.match(reconstructFactory(world, dataset).unresolved[0].reason, /one supported tier/);
  controlled.structure.status = 'ambiguous_shared_hatch';
  assert.match(reconstructFactory(world, dataset).unresolved[0].reason, /matching saved structure/);
});
