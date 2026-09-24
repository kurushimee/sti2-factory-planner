import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import loadHighs from 'highs';
import {solveFactory} from './planner.js';

const highs = await loadHighs();

test('an exact byproduct cycle covers its goal and uses only its true external deficit', () => {
  const configuration = id => ({id, machine: id, operations_per_second: 1,
    capacity: {ticks_per_batch: 20}, build_cost: 1});
  const dataset = {format: 1, resources: [{id: 'ore'}, {id: 'plate'}, {id: 'scrap'}], recipes: [
    {id: 'press', primary: 'plate', inputs: [{resource: 'ore', amount: 1}],
      outputs: [{resource: 'plate', amount: 2}, {resource: 'scrap', amount: 1}],
      configurations: [configuration('press')]},
    {id: 'recycle', primary: 'ore', inputs: [{resource: 'scrap', amount: 1}],
      outputs: [{resource: 'ore', amount: 0.5}], configurations: [configuration('recycle')]},
  ]};
  const result = solveFactory(highs, dataset, {goals: [{resource: 'plate', rate: 1}],
    external: [{resource: 'ore'}], exact_production: true});
  assert.equal(result.status, 'optimal');
  assert.equal(result.exact_production.status, 'exact');
  assert.equal(result.lines.find(line => line.recipe === 'press').operations_per_second_exact.display, '1/2');
  assert.equal(result.lines.find(line => line.recipe === 'recycle').operations_per_second_exact.display, '1/2');
  assert.equal(result.external[0].rate_exact.display, '1/4');
  assert.equal(result.exact_production.endpoints.find(endpoint => endpoint.key === 'external:ore').rate.display, '1/4');
  assert.deepEqual(result.flow_roundoff, []);
  assert.ok(result.connections.some(flow => flow.source.startsWith('recycle|') &&
    flow.destination.startsWith('press|') && flow.rate_exact.display === '1/4'));
});

test('a capacity goal derives its target from whole ticks and the chosen machine count', () => {
  const dataset = {format: 1, resources: [{id: 'part'}], recipes: [{id: 'press', primary: 'part',
    inputs: [], outputs: [{resource: 'part', amount: 3}], configurations: [{id: 'press:batch',
      machine: 'press', operations_per_second: 20 / 53, capacity: {ticks_per_batch: 53},
      build_cost: 1}]}]};
  const result = solveFactory(highs, dataset, {goals: [{kind: 'capacity', recipe: 'press',
    configuration: 'press:batch', machines: 2, resource: 'part'}], exact_production: true});
  assert.equal(result.status, 'optimal');
  assert.equal(result.exact_production.status, 'exact', result.exact_production.reason);
  assert.equal(result.startup.preview_omitted, true);
  assert.equal(result.lines[0].operations_per_second_exact.display, '40/53');
  assert.equal(result.balances.find(balance => balance.resource === 'part').demand_exact.display, '120/53');
});

test('a fractional goal keeps its stated rational rate through exact recovery', () => {
  const dataset = {format: 1, resources: [{id: 'part'}], recipes: [{id: 'press', primary: 'part',
    inputs: [], outputs: [{resource: 'part', amount: 2}], configurations: [{id: 'press:one',
      machine: 'press', operations_per_second: 1, capacity: {ticks_per_batch: 20}, build_cost: 1}]}]};
  const result = solveFactory(highs, dataset, {goals: [{resource: 'part', rate: 1 / 3600,
    rate_ratio: {numerator: '1', denominator: '3600'}}], exact_production: true});
  assert.equal(result.exact_production.status, 'exact', result.exact_production.reason);
  assert.equal(result.lines[0].operations_per_second_exact.display, '1/7200');
  assert.equal(result.exact_production.endpoints.find(endpoint => endpoint.key === 'goal:part').rate.display, '1/3600');
  assert.equal(result.lines[0].machines, 1);
});

test('a requested intermediate remains separate from downstream use', () => {
  const configuration = id => ({id, machine: id, operations_per_second: 1,
    capacity: {ticks_per_batch: 20}, build_cost: 1});
  const dataset = {format: 1, resources: [{id: 'ore'}, {id: 'plate'}, {id: 'motor'}], recipes: [
    {id: 'press', primary: 'plate', inputs: [{resource: 'ore', amount: 1}],
      outputs: [{resource: 'plate', amount: 2}], configurations: [configuration('press')]},
    {id: 'assemble', primary: 'motor', inputs: [{resource: 'plate', amount: 1}],
      outputs: [{resource: 'motor', amount: 1}], configurations: [configuration('assemble')]},
  ]};
  const result = solveFactory(highs, dataset, {goals: [{resource: 'plate', rate: 1},
    {resource: 'motor', rate: 1}], external: [{resource: 'ore'}], exact_production: true});
  assert.equal(result.status, 'optimal');
  assert.equal(result.exact_production.status, 'exact', result.exact_production.reason);
  assert.equal(result.lines.find(line => line.recipe === 'press').operations_per_second_exact.display, '1');
  assert.equal(result.lines.find(line => line.recipe === 'assemble').operations_per_second_exact.display, '1');
  assert.equal(result.connections.filter(flow => flow.resource === 'plate').length, 2);
  assert.equal(result.exact_production.endpoints.find(endpoint => endpoint.key === 'goal:plate').rate.display, '1');
});

test('factory peak sums the rated draw of every installed machine', () => {
  const dataset = {format: 1, resources: [{id: 'ore'}, {id: 'plate'}, {id: 'motor'}, {id: 'energy:eu'}], recipes: [
    {id: 'press', primary: 'plate', inputs: [{resource: 'ore', amount: 1}],
      outputs: [{resource: 'plate', amount: 1}], configurations: [{id: 'press:standard', machine: 'press',
        operations_per_second: 1, eu_per_operation: 200, capacity: {ticks_per_batch: 20, peak_eu_per_tick: 40}}]},
    {id: 'assemble', primary: 'motor', inputs: [{resource: 'plate', amount: 1}],
      outputs: [{resource: 'motor', amount: 1}], configurations: [{id: 'assemble:standard', machine: 'assembler',
        operations_per_second: 2, eu_per_operation: 300, capacity: {ticks_per_batch: 10, peak_eu_per_tick: 70}}]},
  ]};
  const result = solveFactory(highs, dataset, {goals: [{resource: 'motor', rate: 2}],
    external: [{resource: 'ore'}, {resource: 'energy:eu'}], exact_production: true});
  assert.equal(result.status, 'optimal');
  assert.equal(result.exact_production.status, 'exact');
  assert.equal(result.lines.find(line => line.recipe === 'press').machines, 2);
  assert.equal(result.lines.find(line => line.recipe === 'assemble').machines, 1);
  assert.equal(result.power.production_peak_eu_per_tick_exact.display, '150');
  assert.equal(result.power.production_peak_missing_lines, 0);
});

test('an unverified machine capacity leaves the prior exact plan recoverable', () => {
  const dataset = {format: 1, resources: [{id: 'part'}], recipes: [{id: 'press', primary: 'part',
    inputs: [], outputs: [{resource: 'part', amount: 1}], configurations: [{id: 'press:unknown',
      machine: 'press', operations_per_second: 0.3, build_cost: 1}]}]};
  const result = solveFactory(highs, dataset, {goals: [{resource: 'part', rate: 0.1}], exact_production: true});
  assert.equal(result.status, 'numerical_error');
  assert.match(result.reason, /Exact installed capacity is unavailable/);
  assert.equal(result.lines, undefined);
});

test('the StaTech iron-plate line has source-derived exact rates and no flow gap', {timeout: 60000}, () => {
  const dataset = JSON.parse(gunzipSync(readFileSync(new URL('../data/statech-2.0.1.json.gz', import.meta.url))));
  const stage = dataset.progression[2];
  const request = {goals: [{recipe: 'modern_industrialization:compressor|modern_industrialization:materials/iron/compressor/main',
    resource: 'item:modern_industrialization:iron_plate', rate: 1}], replication: false,
    available_machines: stage.available_machines, available_upgrades: stage.available_upgrades,
    external: [{resource: 'energy:eu', cost: 0}], exact_production: true};
  const result = solveFactory(highs, dataset, request);
  assert.ok(['optimal', 'feasible'].includes(result.status));
  assert.equal(result.exact_production.status, 'exact', result.exact_production.reason);
  assert.deepEqual(result.flow_roundoff, []);
  assert.equal(result.exact_production.operations.length, 64);
  const plate = result.lines.find(line => line.recipe === request.goals[0].recipe);
  assert.equal(plate.operations_per_second_exact.display, '25411/24259');
  assert.ok(result.connections.every(flow => flow.rate_exact));
  assert.ok(result.balances.every(balance => balance.surplus_exact));
});
