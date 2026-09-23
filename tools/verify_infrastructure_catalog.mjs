import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {readDataset} from './read_dataset.mjs';
import {solveFactory} from '../kernel/planner.js';

const dataset = await readDataset(process.argv[2] ?? 'data/statech-2.0.1.json.gz');
const highs = await loadHighs();
const expected = [[64, 1536, 32], [256, 6144, 64], [1024, 49152, 128], [4096, 393216, 256], [16384, 6144000000, 512]];
for (const [index, [drain, transfer, distance]] of expected.entries()) {
  const hatch = `modern_industrialization:${['lv', 'mv', 'hv', 'ev', 'superconductor'][index]}_energy_input_hatch`;
  const result = solveFactory(highs, dataset, {goals: [], available_machines: [], external: [{resource: 'energy:eu'}],
    overhead_eu_per_tick: 5, infrastructure: [{machine: 'extended_industrialization:tesla_tower', variant: String(index), count: 2,
      energy_hatch: hatch, transmit_eu_per_tick: transfer}]});
  assert.equal(result.status, 'optimal');
  assert.equal(result.power.external_eu_per_tick, 5 + drain * 2);
  const [entry] = result.power.infrastructure.entries;
  assert.equal(entry.transfer_eu_per_tick_per_machine, transfer);
  assert.equal(entry.max_axis_distance, distance);
  assert.equal(entry.structure.status, 'sized');
  assert.equal(entry.structure.build_requirements.find(value => value.resource === `item:${hatch}`).amount, 7);
  assert.equal(entry.structure.build_requirements.reduce((sum, value) => sum + value.amount, 0), 213);
  const built = solveFactory(highs, dataset, {goals: [], available_machines: [], external: [{resource: 'energy:eu'}],
    infrastructure: [{machine: entry.machine, variant: entry.variant, count: 2, energy_hatch: hatch, transmit_eu_per_tick: transfer}],
    construction: {round_batches: true, external: entry.structure.build_requirements.map(value => ({resource: value.resource, cost: 1}))}});
  assert.equal(built.status, 'optimal');
  assert.equal(built.construction.material_cost, 426);
}
console.log('All five Tesla tiers preserve measured drain, transfer limits, receiver tiers, full-load structures, and finite construction bills.');
