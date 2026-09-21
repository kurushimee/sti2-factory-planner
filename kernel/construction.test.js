import test from 'node:test';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {solveFactory} from './planner.js';
import {configureRecipe} from './catalog.js';

const highs = await loadHighs();
const flow = (resource, amount = 1) => ({resource, amount});
const config = (id, capacity, bill) => ({id, machine: id, operations_per_second: capacity, build_requirements: bill});
const recipe = (id, inputs, outputs, configurations = [config(id, 1, [flow('bench')])]) => ({id, primary: outputs[0].resource, inputs, outputs, configurations});
const dataset = recipes => ({format: 1, resources: ['ore', 'product', 'cheap', 'expensive', 'case', 'coil', 'bench', 'full', 'empty'].map(id => ({id})), recipes});
const request = {goals: [{resource: 'product', rate: 2}], external: [{resource: 'ore', cost: 0}],
  construction: {external: [{resource: 'ore'}, {resource: 'bench', cost: 0}]}};
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('complete construction routes change the chosen whole-machine allocation', () => {
  const data = dataset([
    recipe('production', [flow('ore')], [flow('product')], [config('slow', 1, [flow('cheap')]), config('fast', 2, [flow('expensive')])]),
    recipe('cheap_build', [flow('ore', 1)], [flow('cheap')]),
    recipe('expensive_build', [flow('ore', 20)], [flow('expensive')]),
  ]);
  const result = solveFactory(highs, data, request);
  assert.equal(result.status, 'optimal');
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].configuration, 'slow');
  assert.equal(result.lines[0].machines, 2);
  close(result.construction.external.find(value => value.resource === 'ore').amount, 2);
  close(result.external[0].rate, 2);
  assert.deepEqual(result.construction.requirements, [flow('cheap', 2)]);
  assert.equal(result.construction.method, 'material_equivalents');
  assert.ok(result.construction.assumptions.some(value => value.includes('not a rounded shopping list')));
  const pinned = solveFactory(highs, data, {...request, configurations: {production: ['fast']}});
  assert.equal(pinned.lines[0].configuration, 'fast');
  close(pinned.construction.material_cost, 20);
});

test('construction shares coproducts across different parts and preserves operation quantities', () => {
  const data = dataset([
    recipe('production', [flow('ore')], [flow('product')], [config('machine', 2, [flow('case'), flow('coil')])]),
    recipe('joint', [flow('ore', 4)], [flow('case'), flow('coil')]),
    recipe('case_only', [flow('ore', 3)], [flow('case')]),
    recipe('coil_only', [flow('ore', 3)], [flow('coil')]),
  ]);
  const result = solveFactory(highs, data, request);
  assert.equal(result.status, 'optimal');
  assert.equal(result.construction.routes.length, 1);
  assert.equal(result.construction.routes[0].recipe, 'joint');
  close(result.construction.routes[0].operations, 1);
  close(result.construction.material_cost, 4);
  assert.ok(result.balances.find(value => value.resource === 'coil').net === 0);
});

test('construction alternatives return the selected container without paying twice', () => {
  const data = dataset([
    recipe('production', [], [flow('product')], [config('machine', 2, [flow('case'), flow('empty')])]),
    recipe('case_build', [{choices: ['full', 'ore'], amount: 1, returns: {full: [flow('empty')]}}], [flow('case')]),
  ]);
  const result = solveFactory(highs, data, {...request, construction: {external: [flow('full'), {resource: 'ore', cost: 100}]}});
  assert.equal(result.status, 'optimal');
  assert.deepEqual(result.construction.external.map(value => [value.resource, value.amount]), [['full', 1]]);
  assert.ok(result.construction.routes[0].outputs.some(value => value.resource === 'empty' && value.amount === 1));
});

test('construction cannot use a nonproductive cycle, disabled replication, or rate-limited supplies as quantities', () => {
  const data = dataset([
    recipe('production', [], [flow('product')], [config('machine', 2, [flow('case')])]),
    recipe('cycle_a', [flow('coil')], [flow('case')]),
    recipe('cycle_b', [flow('case')], [flow('coil')]),
    {...recipe('replicate', [flow('ore')], [flow('case')]), replication: true},
  ]);
  assert.equal(solveFactory(highs, data, request).status, 'infeasible');
  assert.equal(solveFactory(highs, data, {...request, replication: true}).status, 'optimal');
  assert.equal(solveFactory(highs, data, {...request, replication: true, construction: {external: [{resource: 'ore', quantity: 0.5}]}}).status, 'infeasible');
  assert.throws(() => solveFactory(highs, data, {...request, construction: {external: [{resource: 'ore', limit: 2}]}}), /quantity/);
});

test('construction rejects missing bills and reports the affected configuration', () => {
  const data = dataset([recipe('production', [], [flow('product')], [{id: 'unknown', machine: 'unknown', operations_per_second: 2}])]);
  const result = solveFactory(highs, data, request);
  assert.equal(result.status, 'infeasible');
  assert.ok(result.exclusions.some(value => value.configuration === 'unknown' && value.reason.includes('no verified construction bill')));
});

test('the primary-route rule covers construction work as well as sustained production', () => {
  const data = dataset([
    recipe('production', [], [flow('product')], [config('machine', 2, [flow('case'), flow('coil')])]),
    recipe('left', [flow('ore')], [flow('case', 2), flow('coil', 0.1)]),
    recipe('right', [flow('ore')], [flow('case', 0.1), flow('coil', 2)]),
  ]);
  const single = solveFactory(highs, data, request);
  assert.equal(single.status, 'optimal');
  assert.equal(single.construction.routes.length, 1);
  close(single.construction.material_cost, 10);
  const mixed = solveFactory(highs, data, {...request, single_primary_route: false});
  assert.equal(mixed.construction.routes.length, 2);
  close(mixed.construction.material_cost, 2 / 2.1);
});

test('construction converts full-load idle power and operating losses to quantities', () => {
  const data = dataset([
    recipe('production', [], [flow('product')], [config('machine', 2, [flow('case')])]),
    recipe('case_build', [], [flow('case')], [{...config('builder', 2, [flow('bench')]), idle_eu_per_tick: 3,
      eu_per_operation: 5, operating_points: [{operations_per_second: 0, inputs: [flow('ore', 2)]},
        {operations_per_second: 2, inputs: [flow('ore', 4)]}]}]),
  ]);
  data.resources.push({id: 'energy:eu'});
  const result = solveFactory(highs, data, {...request, construction: {external: [{resource: 'ore'}, {resource: 'energy:eu', cost: 0}]}});
  assert.equal(result.status, 'optimal');
  close(result.construction.external.find(value => value.resource === 'ore').amount, 2);
  close(result.construction.external.find(value => value.resource === 'energy:eu').amount, 35);
  close(result.construction.energy_eu, 35);
  close(result.power.consumption_eu_per_tick, 0);
});

test('material costing preserves upgrade types with different ingredient requirements', () => {
  const process = {...recipe('process', [flow('ore')], [flow('product')], []), process: {type: 'press', duration_ticks: 100, eu_per_tick: 8}};
  const data = dataset([process]);
  data.machines = [{id: 'press', status: 'supported', mechanic: 'mi_crafter', recipe_type: 'press', base_eu: 8, max_eu: 32,
    upgrades: ['basic', 'quantum'], upgrade_limit: 1}];
  data.upgrades = [{id: 'basic', extra_max_eu: 32}, {id: 'quantum', extra_max_eu: 512}];
  const prepared = configureRecipe(process, data, {available_upgrades: ['basic', 'quantum'], construction: {}});
  assert.ok(prepared.configurations.some(value => value.setup.upgrade?.id === 'basic'));
  assert.ok(prepared.configurations.some(value => value.setup.upgrade?.id === 'quantum'));
});

test('finite construction rounds recipe batches and purchased item quantities', () => {
  const data = dataset([
    recipe('production', [], [flow('product')], [config('machine', 2, [flow('case', 3)])]),
    recipe('make_case', [flow('ore')], [flow('case', 4)], [{...config('builder', 2, [flow('bench')]), setup: {batch: 2}}]),
  ]);
  data.resources.find(value => value.id === 'ore').unit = 'item';
  const result = solveFactory(highs, data, {...request, construction: {...request.construction, round_batches: true}});
  assert.equal(result.status, 'optimal');
  assert.equal(result.construction.method, 'whole_batches');
  assert.equal(result.construction.routes[0].operations, 2);
  assert.equal(result.construction.routes[0].batches, 1);
  assert.equal(result.construction.routes[0].batch_size, 2);
  assert.equal(result.construction.external[0].amount, 2);
  assert.equal(result.construction.balances.find(value => value.resource === 'case').surplus, 5);
});

test('finite consumable tools use exact whole lifetimes and report remaining uses', () => {
  for (const [operations, tools, remaining] of [[1, 1, 33], [34, 1, 0], [35, 2, 33], [1000000000001, 29411764706, 3]]) {
    const data = dataset([
      recipe('production', [], [flow('product')], [config('machine', 2, [flow('case', operations)])]),
      {...recipe('hammer', [flow('ore'), flow('item:hammer', 1 / 34)], [flow('case')]),
        tool_usage: {resource: 'item:hammer', crafts_per_tool: 34}},
    ]);
    data.resources.push({id: 'item:hammer'});
    const result = solveFactory(highs, data, {...request, construction: {round_batches: true,
      materials: 1, external: [{resource: 'ore'}, {resource: 'item:hammer'}]}});
    assert.equal(result.status, 'optimal');
    assert.equal(result.construction.tools[0].count, tools);
    assert.equal(result.construction.tools[0].remaining_crafts, remaining);
    assert.equal(result.construction.external.find(value => value.resource === 'item:hammer').amount, tools);
  }
});

test('finite alternative items cannot combine fractions of separate physical stacks', () => {
  const data = dataset([
    recipe('production', [], [flow('product')], [config('machine', 2, [flow('case')])]),
    recipe('make_case', [{choices: ['ore', 'coil'], amount: 1}], [flow('case')]),
  ]);
  for (const resource of data.resources) resource.unit = 'item';
  const settings = {external: [{resource: 'ore', quantity: 0.5}, {resource: 'coil', quantity: 0.5}]};
  assert.equal(solveFactory(highs, data, {...request, construction: settings}).status, 'optimal');
  assert.equal(solveFactory(highs, data, {...request, construction: {...settings, round_batches: true}}).status, 'infeasible');
});

test('sequential construction reuses a tool across recipes with the same verified lifetime', () => {
  const data = dataset([
    recipe('production', [], [flow('product')], [config('machine', 2, [flow('case', 17), flow('coil', 17)])]),
    ...['case', 'coil'].map(resource => ({...recipe(`hammer_${resource}`, [flow('ore'), flow('item:hammer', 1 / 34)], [flow(resource)]),
      tool_usage: {resource: 'item:hammer', crafts_per_tool: 34}})),
  ]);
  data.resources.push({id: 'item:hammer'});
  const result = solveFactory(highs, data, {...request, construction: {round_batches: true, external: [{resource: 'ore'}, {resource: 'item:hammer'}]}});
  assert.equal(result.status, 'optimal');
  assert.equal(result.construction.tools.length, 1);
  assert.equal(result.construction.tools[0].count, 1);
  assert.equal(result.construction.tools[0].remaining_crafts, 0);
  assert.deepEqual(result.construction.tools[0].recipes.sort(), ['hammer_case', 'hammer_coil']);
});
