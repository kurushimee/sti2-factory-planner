import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDataset} from './validation.js';

const example = () => JSON.parse(readFileSync(new URL('../data/example.json', import.meta.url)));
test('dataset validation accepts the portable example', () => validateDataset(example()));
test('dataset validation rejects malformed references before dependency pruning', () => {
  for (const [change, message] of [
    [data => data.resources.push(data.resources[0]), /duplicate ID/],
    [data => data.resources[0].max_stack_size = 0, /max_stack_size/],
    [data => data.machines = [{id: 'test:machine', availability: []}], /availability/],
    [data => data.machines = [{id: 'test:machine', availability: {automatic: 'no', reason: 'Removed'}}], /availability/],
    [data => data.machines = [{id: 'test:storage', status: 'infrastructure', mechanic: 'energy_storage',
      storage: {capacity_eu: 3200000, charge_eu_per_tick: 256, discharge_eu_per_tick: 0,
        loss_eu_per_tick: 0, saved_charge_field: 'storedEu'}}], /discharge_eu_per_tick/],
    [data => data.recipes[0].outputs[0].resource = 'missing', /unknown ID/],
    [data => data.recipes[0].primary = 'coal', /primary must/],
    [data => data.recipes[0].configurations[0].eu_per_operation = -1, /eu_per_operation/],
    [data => data.recipes[0].configurations[0].operating_points = [], /zero and full capacity/],
    [data => data.recipes[0].configurations[0].operating_points = [{operations_per_second: -1, inputs: []}], /operations_per_second/],
    [data => data.recipes[0].inputs = [{choices: ['ore'], amount: 1, returns: {coal: [{resource: 'ore', amount: 1}]}}], /remainder key/],
    [data => data.recipes[0].process = {type: 'press', duration_ticks: 1.5, eu_per_tick: 2}, /whole number/],
    [data => data.machines = [{id: 'test:controller', status: 'unsupported', shapes: [{index: 0, cells: [{position: [0, 0, 1], allowed_hatches: [], member_rule: 7}]}]}], /unknown shape member/],
    [data => data.shape_member_rules = [{state_only_verified: true, matching_states: [{Name: 'test:casing', Properties: {axis: 2}}]}], /nonempty text/],
    [data => data.shape_member_rules = [{state_only_verified: true, matching_states: [], matching_world_states: {'2': []}}], /verified capture evidence/],
    [data => data.shape_member_rules = [{state_only_verified: true, matching_states: [], rotation_verified: true, matching_world_states: {'2': []}}], /matching_world_states.3/],
    [data => data.progression[0].available_machines = ['missing'], /unknown ID/],
    [data => data.progression[0].available_parts = ['missing'], /unknown ID/],
  ]) {
    const data = example();
    change(data);
    assert.throws(() => validateDataset(data), message);
  }
});

test('dataset validation accepts complete captured world-state rotations', () => {
  const data = example();
  const state = {Name: 'test:chain', Properties: {axis: 'y'}};
  data.shape_member_rules = [{state_only_verified: true, matching_states: [state], rotation_verified: true,
    matching_world_states: {'2': [state], '3': [state], '4': [state], '5': [state]}}];
  validateDataset(data);
});

test('dataset validation accepts a portable energy-storage machine', () => {
  const data = example();
  data.machines = [{id: 'test:storage', status: 'infrastructure', mechanic: 'energy_storage',
    storage: {capacity_eu: 3200000, charge_eu_per_tick: 256, discharge_eu_per_tick: 256,
      loss_eu_per_tick: 0, saved_charge_field: 'storedEu'}}];
  validateDataset(data);
});
