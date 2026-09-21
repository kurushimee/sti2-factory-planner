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
