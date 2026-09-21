import test from 'node:test';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {solveFactory} from './planner.js';
import {refineMaterialPlan} from './material_refinement.js';

const highs = await loadHighs();
const flow = (resource, amount = 1) => ({resource, amount});
const configuration = (id, capacity, bill) => ({id, machine: id, operations_per_second: capacity, build_requirements: bill});
const recipe = (id, inputs, outputs, configurations = [configuration('bench', 1, [flow('bench')])]) => ({id, primary: outputs[0].resource, inputs, outputs, configurations});
const production = recipe('production', [flow('ore')], [flow('part')], [
  configuration('slow', 1, [flow('cheap')]), configuration('fast', 2, [flow('expensive')]),
]);
const dataset = {format: 1, resources: ['ore', 'part', 'cheap', 'expensive', 'bench'].map(id => ({id})), recipes: [production,
  recipe('cheap_build', [flow('ore')], [flow('cheap')]), recipe('expensive_build', [flow('ore', 20)], [flow('expensive')])]};
const request = {goals: [{resource: 'part', rate: 2}], external: [{resource: 'ore', cost: 0}],
  construction: {external: [{resource: 'ore'}, {resource: 'bench', cost: 0}]}};
const refine = (data, settings = request) => refineMaterialPlan(highs, data, settings,
  (source, selection) => solveFactory(highs, source, selection), Date.now() + 10000);

test('material refinement replaces an expensive fast machine only after balancing its complete build', () => {
  const original = JSON.stringify(dataset);
  const baseline = solveFactory(highs, dataset, {...request, construction: undefined});
  assert.equal(baseline.lines[0].configuration, 'fast');
  const result = refine(dataset);
  assert.equal(result.status, 'feasible');
  assert.equal(result.optimal, false);
  assert.equal(result.lines[0].configuration, 'slow');
  assert.equal(result.lines[0].machines, 2);
  assert.deepEqual(result.construction.requirements, [flow('cheap', 2)]);
  assert.equal(result.construction.external.find(supply => supply.resource === 'ore').amount, 2);
  assert.equal(result.lines[0].configuration_details.build_cost, 1);
  assert.equal(result.optimization.lower_bound, null);
  assert.equal(JSON.stringify(dataset), original);
});

test('capacity goals and deliberate machine choices survive material refinement', () => {
  for (const settings of [
    {...request, configurations: {production: 'fast'}},
    {...request, goals: [{kind: 'capacity', recipe: 'production', resource: 'part', configuration: 'fast', machines: 1}]},
  ]) {
    const result = refine(dataset, settings);
    assert.equal(result.lines[0].configuration, 'fast');
    assert.equal(result.lines[0].machines, 1);
    assert.equal(result.targets[0].rate, 2);
  }
});

test('an apparent byproduct bargain cannot replace a cheaper verified construction order', () => {
  const coupled = {...dataset, recipes: [
    {...production, configurations: [configuration('slow', 1, [flow('cheap', 200)]), configuration('fast', 2, [flow('expensive')])]},
    recipe('joint', [flow('ore')], [flow('expensive'), flow('cheap', 100)]),
  ]};
  const result = refine(coupled);
  assert.equal(result.lines[0].configuration, 'fast');
  assert.equal(result.construction.external.find(supply => supply.resource === 'ore').amount, 1);
  assert.equal(result.objective, 1002);
});

test('an unavailable construction bill or exhausted budget never becomes a completed plan', () => {
  const unavailable = refine({...dataset, recipes: [production]});
  assert.equal(unavailable.status, 'limit');
  assert.equal(unavailable.lines, undefined);
  const timedOut = refineMaterialPlan(highs, dataset, request,
    (source, selection) => solveFactory(highs, source, selection), Date.now() - 1);
  assert.equal(timedOut.status, 'limit');
  assert.equal(timedOut.lines, undefined);
});

test('normal planning selects bounded material refinement for a large construction model', () => {
  const data = structuredClone(dataset);
  data.recipes[0].configurations.push(...Array.from({length: 2001}, (_, index) =>
    configuration(`duplicate${index}`, 2, [flow('expensive')])));
  const progress = [];
  const result = solveFactory(highs, data, {...request, time_limit_ms: 10000}, event => progress.push(event.phase));
  assert.equal(result.search.method, 'material_cost_refinement');
  assert.equal(result.lines[0].configuration, 'slow');
  assert.equal(result.lines[0].machines, 2);
  assert.ok(progress.includes('construction_verification'));
});
