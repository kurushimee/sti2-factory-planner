import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import loadHighs from 'highs';
import {prepareDataset} from './catalog.js';
import {solveFactory} from './planner.js';

const dataset = JSON.parse(await readFile(new URL('../data/example.json', import.meta.url)));
const machines = [...new Set(dataset.recipes.flatMap(recipe => recipe.configurations.map(config => config.machine)))];
const highs = await loadHighs();

test('production-only plans take explicit external electricity without adding generators', () => {
  const request = {goals: [{recipe: 'press', resource: 'plate', rate: 1}], production_only: true,
    available_machines: machines, external: [{resource: 'energy:eu'}]};
  const prepared = prepareDataset(dataset, request);
  assert.equal(prepared.recipes.some(recipe => recipe.id === 'generate'), false);
  const result = solveFactory(highs, dataset, request);
  assert.equal(result.status, 'optimal');
  assert.equal(result.lines.some(line => line.recipe === 'generate'), false);
  assert.ok(result.external.some(flow => flow.resource === 'energy:eu' && flow.rate > 0));
});

test('an explicitly requested generator remains available in production-only mode', () => {
  const request = {goals: [{recipe: 'generate', resource: 'energy:eu', rate: 1}], production_only: true,
    available_machines: machines};
  assert.equal(prepareDataset(dataset, request).recipes.some(recipe => recipe.id === 'generate'), true);
});

test('an explicit EU resource goal admits generator routes in production-only mode', () => {
  const request = {goals: [{resource: 'energy:eu', rate: 1}], production_only: true,
    available_machines: machines};
  assert.equal(prepareDataset(dataset, request).recipes.some(recipe => recipe.id === 'generate'), true);
  const result = solveFactory(highs, dataset, request);
  assert.equal(result.status, 'optimal');
  assert.ok(result.lines.some(line => line.recipe === 'generate'));
});
