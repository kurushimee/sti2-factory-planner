import test from 'node:test';
import assert from 'node:assert/strict';
import {previewConfiguration} from './preview.js';

const recipe = {id: 'press', primary: 'plate', inputs: [], outputs: [{resource: 'plate', amount: 2}],
  configurations: [], process: {type: 'press', duration_ticks: 40, eu_per_tick: 8}};
const machine = {id: 'press', status: 'supported', recipe_type: 'press', mechanic: 'mi_crafter', base_eu: 8, max_eu: 32,
  upgrades: ['upgrade'], upgrade_limit: 8};
const dataset = {recipes: [recipe], machines: [machine], upgrades: [{id: 'upgrade', extra_max_eu: 16}]};

test('configuration previews use actual setup capacity and preserve revision identity', () => {
  const result = previewConfiguration(dataset, {}, {recipe: 'press', machine: 'press', revision: 17,
    setup: {upgrade: dataset.upgrades[0], upgrade_count: 3}});
  assert.equal(result.revision, 17);
  assert.equal(result.configuration.operations_per_second, 5);
  assert.equal(result.outputs[0].rate_per_machine, 10);
  assert.equal(result.configuration.build_requirements[1].amount, 3);
  assert.throws(() => previewConfiguration(dataset, {disabled_machines: ['press']}, {recipe: 'press', machine: 'press'}), /available/);
  assert.throws(() => previewConfiguration(dataset, {}, {recipe: 'press', machine: 'press', setup: {batch: 2}}), /batch/);
});
