import test from 'node:test';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {appendPeriodicDispatch, constantPowerSegments, decodePeriodicDispatch} from './periodic_model.js';
import {balancePeriodicPower} from './periodic_power.js';
import {clearSolarProfile} from './solar_profile.js';
import {runSolver} from './solver.js';
import {solveFactory} from './planner.js';

const highs = await loadHighs();

function dispatch(profile, demand, units, firm = 0, gap = 0) {
  const model = {bounds: ['zero = 0', 'panel = 1', `firm = ${firm}`], constraints: [], integers: [],
    objective: new Map([['zero', 0]])};
  appendPeriodicDispatch(model, {profiles: [{variable: 'panel', values: profile,
    one_event_loss_eu_per_period: gap}],
    firm_terms: new Map([['firm', 20]]), demand_eu_per_tick: demand, storage: units});
  const expression = [...model.objective].map(([variable, cost]) => `+ ${cost} ${variable}`).join(' ');
  const lp = ['Minimize', `cost: ${expression}`, 'Subject To', ...model.constraints, 'Bounds',
    ...model.bounds, 'Generals', ...model.integers, 'End'].join('\n');
  return runSolver(highs, lp);
}

const storage = {capacity_eu: 2, charge_eu_per_tick: 1, discharge_eu_per_tick: 1,
  loss_eu_per_tick: 0};

test('constant profile segments preserve each transition and shared boundary', () => {
  assert.deepEqual(constantPowerSegments([
    {variable: 'a', values: [2, 2, 0, 0]},
    {variable: 'b', values: [0, 1, 1, 0]},
  ]), [
    {start: 0, ticks: 1, power: [2, 0]},
    {start: 1, ticks: 1, power: [2, 1]},
    {start: 2, ticks: 1, power: [0, 1]},
    {start: 3, ticks: 1, power: [0, 0]},
  ]);
});

test('whole storage dispatch agrees with known night, capacity, and transfer cases', () => {
  assert.equal(dispatch([2, 2, 0, 0], 1, [storage]).columns.periodic_storage_0, 1);
  assert.equal(dispatch([0, 0, 2, 2], 1, [storage]).columns.periodic_storage_0, 1);
  assert.equal(dispatch([2, 2, 0, 0], 1, []).status, 'infeasible');
  assert.equal(dispatch([2, 2, 0, 0], 1, [{...storage, max_count: 0}]).status, 'infeasible');
  assert.equal(dispatch([2, 2, 0, 0], 1, [{...storage, charge_eu_per_tick: 1, discharge_eu_per_tick: 1,
    capacity_eu: 1, max_count: 1}]).status, 'infeasible');
  assert.equal(dispatch([2, 2, 0, 0], 1, [{...storage, charge_eu_per_tick: 1,
    discharge_eu_per_tick: 1, capacity_eu: 1}]).columns.periodic_storage_0, 2);
  assert.equal(dispatch([2, 2, 0, 0], 1, [{...storage, discharge_eu_per_tick: 1, max_count: 1}]).feasible, true);
  assert.ok(dispatch([2, 2, 0, 0], 1, [{...storage, discharge_eu_per_tick: 1, max_count: 1}], 1).columns.periodic_storage_0 === 0);
});

test('segmented dispatch matches independent tick checks across all short profiles', () => {
  for (let code = 0; code < 81; code++) {
    let encoded = code;
    const profile = Array.from({length: 4}, () => { const value = encoded % 3; encoded = Math.floor(encoded / 3); return value; });
    const expected = balancePeriodicPower(profile, [1, 1, 1, 1], storage);
    const actual = dispatch(profile, 1, [{...storage, max_count: 1}]);
    assert.equal(actual.feasible, expected.status === 'feasible', `profile=${profile}`);
  }
});

test('separate tier states cannot borrow capacity from an unrelated tier', () => {
  const tooSlow = {...storage, capacity_eu: 100, discharge_eu_per_tick: 1, max_count: 1};
  const tooSmall = {...storage, capacity_eu: 1, discharge_eu_per_tick: 100, max_count: 1};
  const result = dispatch([6, 6, 0, 0], 3, [tooSlow, tooSmall]);
  assert.equal(result.status, 'infeasible');
});

test('firm generation can share the bus with solar and fixed storage counts stay binding', () => {
  assert.equal(dispatch([2, 2, 0, 0], 1, [], 1).feasible, true);
  assert.equal(dispatch([2, 2, 0, 0], 1, [], 0.5).status, 'infeasible');
  assert.equal(dispatch([2, 2, 0, 0], 1, [{...storage, installed_count: 1}], 0.5)
    .columns.periodic_storage_0, 1);
  assert.equal(dispatch([2, 2, 0, 0], 1, [{...storage, installed_count: 0}], 0.5)
    .status, 'infeasible');
});

test('the measured clear-day LV curve needs one real LV storage unit at 14 EU per tick', () => {
  const profile = clearSolarProfile(32).power_eu_per_tick;
  const unit = {capacity_eu: 3200000, charge_eu_per_tick: 256,
    discharge_eu_per_tick: 256, loss_eu_per_tick: 0};
  assert.equal(dispatch(profile, 14, [unit]).columns.periodic_storage_0, 1);
  assert.equal(dispatch(profile, 14, [{...unit, max_count: 0}]).status, 'infeasible');
});

test('an uncertain one-tick loss needs a daily energy allowance and a separate store buffer', () => {
  const unit = {...storage, capacity_eu: 12, charge_eu_per_tick: 4,
    discharge_eu_per_tick: 4};
  const planned = dispatch([4, 4, 0, 0], 1, [unit], 0, 4);
  assert.equal(planned.columns.periodic_storage_0, 1);
  const initial = planned.columns.periodic_state_0_0 + 8;
  for (let code = 0; code < 81; code++) {
    let choices = code, stored = initial;
    for (let day = 0; day < 4; day++) {
      const lostAt = choices % 3;
      choices = Math.floor(choices / 3);
      for (let tick = 0; tick < 4; tick++) {
        const generation = tick < 2 && tick !== lostAt ? 4 : 0;
        stored = Math.min(unit.capacity_eu, stored + generation - 1);
        assert.ok(stored >= 0, `gap sequence ${code} at day ${day}, tick ${tick}`);
      }
    }
    assert.ok(stored >= initial, `gap sequence ${code} did not replenish the starting charge`);
  }
  assert.equal(dispatch([4, 4, 0, 0], 1, [{...unit, capacity_eu: 11, max_count: 1}], 0, 4).status, 'infeasible');
  assert.equal(dispatch([4, 4, 0, 0], 1, [], 1, 4).feasible, true);
  assert.throws(() => dispatch([4, 4, 0, 0], 1, [unit, unit], 0, 4), /one selected storage tier/);
});

test('an uncertain gap cannot exceed the installed discharge transfer', () => {
  const slow = {...storage, capacity_eu: 20, charge_eu_per_tick: 4,
    discharge_eu_per_tick: 1, max_count: 2};
  assert.equal(dispatch([10, 10, 10, 10], 7, [slow], 0, 10).status, 'infeasible');
  const fast = {...slow, discharge_eu_per_tick: 7, max_count: 1};
  assert.equal(dispatch([10, 10, 10, 10], 7, [fast], 0, 10).feasible, true);
});

function factory() {
  return {format: 1, resources: ['energy:eu', 'item:storage', 'item:solar', 'item:press', 'item:cell', 'item:product'].map(id => ({id})),
    machines: [{id: 'storage', status: 'infrastructure', mechanic: 'energy_storage', storage: {
      ...storage, saved_charge_field: 'charge'}}, {id: 'solar', status: 'supported', mechanic: 'periodic_generation'},
    {id: 'press', status: 'supported', mechanic: 'fixed_cycle'}],
    recipes: [
      {id: 'solar', primary: 'energy:eu', inputs: [{resource: 'item:cell', amount: 0.1}],
        outputs: [{resource: 'energy:eu', amount: 20}], configurations: [{id: 'solar:fixed', machine: 'solar',
          operations_per_second: 1, build_requirements: [{resource: 'item:solar', amount: 1}],
          periodic_generation: {period_ticks: 4, segments: [
            {ticks: 2, eu_per_tick: 2}, {ticks: 2, eu_per_tick: 0}]}}]},
      {id: 'press', primary: 'item:product', inputs: [], outputs: [{resource: 'item:product', amount: 1}],
        configurations: [{id: 'press:fixed', machine: 'press', operations_per_second: 1,
          eu_per_operation: 20, build_requirements: [{resource: 'item:press', amount: 1}]}]},
    ]};
}

test('the connected factory installs whole storage and pays for solar cell replacement', () => {
  const request = {goals: [{resource: 'item:product', rate: 1}], external: [{resource: 'item:cell'}],
    periodic_storage: ['storage']};
  const result = solveFactory(highs, factory(), request);
  assert.equal(result.status, 'optimal');
  assert.equal(result.lines.find(line => line.recipe === 'solar').machines, 1);
  assert.equal(result.external.find(flow => flow.resource === 'item:cell').rate, 0.1);
  assert.equal(result.power.gross_generation_eu_per_tick, 1);
  assert.equal(result.periodic_power.storage[0].machines, 1);
  assert.equal(result.periodic_power.storage[0].capacity_eu, 2);
  assert.equal(result.periodic_power.generation[0].guaranteed_average_eu_per_tick, 1);
  assert.ok(result.periodic_power.storage[0].ending_charge_eu >= result.periodic_power.storage[0].initial_charge_eu);
  assert.equal(solveFactory(highs, factory(), {...request, periodic_storage: []}).status, 'infeasible');
  assert.equal(solveFactory(highs, factory(), {...request, periodic_storage_limits: {storage: 0}}).status, 'infeasible');
  const reserved = solveFactory(highs, factory(), {...request, reserve_fraction: 0.25});
  assert.equal(reserved.status, 'optimal');
  assert.equal(reserved.lines.find(line => line.recipe === 'solar').machines, 2);
  assert.equal(reserved.periodic_power.storage[0].machines, 2);
});

test('installed periodic generators remain in a plan without an output demand', () => {
  const result = solveFactory(highs, factory(), {goals: [], installed: {'solar:fixed': 2},
    available_machines: ['solar', 'storage'], periodic_storage: ['storage'],
    external: [{resource: 'item:cell'}]});
  assert.equal(result.status, 'optimal');
  assert.equal(result.lines.find(line => line.recipe === 'solar').machines, 2);
  assert.equal(result.external.find(flow => flow.resource === 'item:cell').rate, 0.2);
  assert.deepEqual(result.targets, []);
});

test('a small capacity goal preserves its machine and rejects a real period deficit', () => {
  const request = {goals: [{kind: 'capacity', resource: 'energy:eu', recipe: 'solar',
    configuration: 'solar:fixed', machines: 1}], installed: {'solar:fixed': 1},
    available_machines: ['solar', 'storage'], periodic_storage: ['storage'],
    external: [{resource: 'item:cell'}]};
  const result = solveFactory(highs, factory(), request);
  assert.equal(result.status, 'optimal');
  assert.equal(result.targets[0].rate, 20);
  assert.equal(result.lines.find(line => line.recipe === 'solar').machines, 1);
  assert.equal(solveFactory(highs, factory(), {...request,
    goals: [...request.goals, {resource: 'energy:eu', rate: 0.01}]}).status, 'infeasible');

  const model = {firm_terms: new Map(), demand_eu_per_tick: 1 / 3 + 1e-8,
    period_ticks: 3, lines: [{variable: 'panel', values: [1, 0, 0]}], gaps: [0], storage: []};
  assert.throws(() => decodePeriodicDispatch(model, name =>
    name === 'panel' ? 1 : -model.demand_eu_per_tick), /whole-period energy/);
});

test('storage build item enters the connected construction balance', () => {
  const request = {goals: [{resource: 'item:product', rate: 1}], external: [{resource: 'item:cell'}],
    periodic_storage: ['storage'], construction: {external: [{resource: 'item:storage'},
      {resource: 'item:solar'}, {resource: 'item:press'}]}};
  const result = solveFactory(highs, factory(), request);
  assert.equal(result.status, 'optimal');
  assert.equal(result.construction.requirements.find(flow => flow.resource === 'item:storage').amount, 1);
  assert.equal(result.construction.external.find(flow => flow.resource === 'item:storage').amount, 1);
});
