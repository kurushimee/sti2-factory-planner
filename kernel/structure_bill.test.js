import {test} from 'node:test';
import assert from 'node:assert/strict';
import {structureBill, attachStructureBills} from './structure_bill.js';

const rules = [{state_only_verified: true, matching_states: [{Name: 'test:casing'}]}];
const cell = (x, types) => ({position: [x, 0, 0], member_rule: 0, preview_block: 'test:casing', preview_items: ['test:casing'], allowed_hatches: types});
const part = (id, type, capacity) => ({id, hatch_type: type, hatch_capacity: capacity});

test('structure hatches replace casing cells and respect restricted positions', () => {
  const shape = {cells: [cell(0, ['item', 'fluid']), cell(1, ['item']), cell(2, [])]};
  const parts = [part('test:item', 'item', {item_slots: [64]}), part('test:fluid', 'fluid', {fluid_slots_mb: [4000]})];
  const result = structureBill(shape, rules, parts, [{type: 'item', items: [{amount: 64, max_stack_size: 64}]}, {type: 'fluid', fluids: [{amount: 4000}]}]);
  assert.deepEqual(result.placements.map(value => value.block), ['test:fluid', 'test:item', 'test:casing']);
  assert.equal(result.build_requirements.reduce((sum, value) => sum + value.amount, 0), 3);
  assert.throws(() => structureBill(shape, rules, parts, [{type: 'item', items: [{amount: 65, max_stack_size: 64}]}, {type: 'fluid', fluids: [{amount: 4000}]}]), /do not fit/);
});

test('structure sizing respects unstackable items and one-hatch burst buffers', () => {
  const shape = {cells: [cell(0, ['item']), cell(1, ['energy'])]};
  const parts = [part('test:small', 'item', {item_slots: [64]}), part('test:large', 'item', {item_slots: [64, 64]}),
    part('test:lv', 'energy', {energy_eu: 19200, cable_eu_per_tick: 32}), part('test:sv', 'energy', {energy_eu: 76800000000, cable_eu_per_tick: 128000000})];
  const result = structureBill(shape, rules, parts, [{type: 'item', items: [{amount: 2, max_stack_size: 1}]},
    {type: 'energy', energy: {buffer: 24576000000, rate: 40960000}, single_buffer: true}]);
  assert.deepEqual(result.placements.map(value => value.block), ['test:large', 'test:sv']);
  assert.throws(() => structureBill(shape, rules, parts, [{type: 'energy', energy: {buffer: 24576000000, rate: 1}, single_buffer: true}],
    {allowed_parts: ['test:lv']}), /cannot hold/);
});

test('unverified block predicates remain visible instead of producing a guessed bill', () => {
  assert.throws(() => structureBill({cells: [cell(0, [])]}, [], [], []), /no verified default block/);
  assert.equal(structureBill({cells: [cell(0, [])]}, rules, [], []).build_requirements[0].resource, 'item:test:casing');
});


test('selected recipe batches add measured hatches and preserve controller requirements', () => {
  const machine = {id: 'test:machine', shapes: [{index: 0, cells: [cell(0, ['modern_industrialization:item_input']), cell(1, ['modern_industrialization:item_output'])]}]};
  const data = {resources: [{id: 'item:ore', max_stack_size: 64}, {id: 'item:plate', max_stack_size: 64}], shape_member_rules: rules,
    machines: [machine, part('modern_industrialization:steel_item_input_hatch', 'modern_industrialization:item_input', {item_slots: [64, 64]}),
      part('modern_industrialization:bronze_item_output_hatch', 'modern_industrialization:item_output', {item_slots: [64]})],
    recipes: [{id: 'press', inputs: [{resource: 'item:ore', amount: 40}], outputs: [{resource: 'item:plate', amount: 1}]}]};
  const result = {lines: [{recipe: 'press', machine: machine.id, ingredient_choices: [{slot: 0, resource: 'item:ore', rate: 80}],
    configuration_details: {setup: {batch: 2}, capacity: {}, build_requirements: [{resource: 'item:test:machine', amount: 1}]}}]};
  attachStructureBills(result, data);
  const configuration = result.lines[0].configuration_details;
  assert.equal(configuration.structure.status, 'sized');
  assert.equal(configuration.build_requirements.length, 3);
  assert.equal(configuration.build_requirements[0].resource, 'item:test:machine');
});
