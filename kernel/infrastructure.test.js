import test from 'node:test';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {infrastructurePower} from './infrastructure.js';
import {solveFactory} from './planner.js';

const machines = [{id: 'tower', status: 'infrastructure', infrastructure: [{id: 'copper', passive_eu_per_tick: 64, max_transfer_eu_per_tick: 1536}]}];
test('infrastructure adds idle drain once without charging transferred power', () => {
  const result = infrastructurePower({machines}, {overhead_eu_per_tick: 5, infrastructure: [{machine: 'tower', variant: 'copper', count: 2}]});
  assert.equal(result.total_eu_per_tick, 133);
  assert.equal(result.entries[0].transfer_eu_per_tick_per_machine, 1536);
  for (const count of [-1, 0.5, NaN, Infinity]) assert.throws(() => infrastructurePower({machines}, {infrastructure: [{machine: 'tower', variant: 'copper', count}]}));
  assert.throws(() => infrastructurePower({machines}, {infrastructure: [{machine: 'tower', variant: 'missing', count: 1}]}), /Unknown/);
  assert.throws(() => infrastructurePower({machines}, {overhead_eu_per_tick: NaN}), /overhead/);
});

test('infrastructure-only demand discovers generation and balances its fuel power feedback', async () => {
  const data = {format: 1, machines, default_machines: ['miner', 'generator'],
    resources: [{id: 'energy:eu'}, {id: 'fuel'}], recipes: [
      {id: 'mine', primary: 'fuel', inputs: [], outputs: [{resource: 'fuel', amount: 1}], configurations: [{id: 'mine', machine: 'miner', operations_per_second: 10, eu_per_operation: 10}]},
      {id: 'generate', primary: 'energy:eu', inputs: [{resource: 'fuel', amount: 1}], outputs: [{resource: 'energy:eu', amount: 1000}], configurations: [{id: 'gen', machine: 'generator', operations_per_second: 10}]},
    ]};
  const result = solveFactory(await loadHighs(), data, {goals: [], infrastructure: [{machine: 'tower', variant: 'copper', count: 2}]});
  assert.equal(result.status, 'optimal');
  assert(Math.abs(result.power.net_generation_eu_per_tick - 128) < 1e-7);
  assert.equal(result.power.infrastructure.total_eu_per_tick, 128);
  assert.equal(result.lines.length, 2);
});

test('fixed infrastructure bills enter finite construction quantities and preserve the selected receiver tier', async () => {
  const hatch = 'modern_industrialization:lv_energy_input_hatch';
  const type = 'modern_industrialization:energy_input';
  const data = {format: 1, resources: ['energy:eu', 'item:tower', `item:${hatch}`, 'item:casing', 'item:ore'].map(id => ({id})),
    shape_member_rules: [{state_only_verified: true, matching_states: [{Name: 'casing'}]}],
    machines: [{id: 'tower', status: 'infrastructure', infrastructure: [{id: 'copper', passive_eu_per_tick: 64,
      max_transfer_eu_per_tick: 1536, structure: {energy_input: true, shape: 0}}],
      shapes: [{index: 0, cells: [0, 1].map(x => ({position: [x, 0, 0], member_rule: 0, preview_block: 'casing', preview_items: ['casing'], allowed_hatches: x === 0 ? [type] : []}))}]},
      {id: hatch, status: 'structural', hatch_type: type, hatch_capacity: {energy_eu: 19200, cable_eu_per_tick: 256}}],
    recipes: [{id: 'casing', primary: 'item:casing', inputs: [{resource: 'item:ore', amount: 2}], outputs: [{resource: 'item:casing', amount: 1}],
      configurations: [{id: 'craft', machine: 'crafting', operations_per_second: 1, build_requirements: [{resource: 'item:tower', amount: 1}]}]}]};
  const request = {goals: [], external: [{resource: 'energy:eu'}], infrastructure: [{machine: 'tower', variant: 'copper', count: 2,
    energy_hatch: hatch, transmit_eu_per_tick: 100}], construction: {round_batches: true, external: ['item:tower', `item:${hatch}`, 'item:ore'].map(resource => ({resource, cost: 1}))}};
  const result = solveFactory(await loadHighs(), data, request);
  assert.equal(result.status, 'optimal');
  assert.equal(result.power.external_eu_per_tick, 128);
  assert.equal(result.construction.material_cost, 8);
  assert.equal(result.construction.routes.find(value => value.recipe === 'casing').operations, 2);
  assert.equal(result.power.infrastructure.entries[0].structure.status, 'sized');
  assert.throws(() => infrastructurePower(data, {...request, available_parts: []}), /unavailable/);
  assert.throws(() => infrastructurePower(data, {...request, infrastructure: [{machine: 'tower', variant: 'copper', count: 1}]}), /construction is incomplete/);
});
