import test from 'node:test';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {runSolver} from './solver.js';

const highs = await loadHighs();
const problem = 'Minimize\nc: x + y\nSubject To\nr: 2 x + 3 y >= 7\nBounds\nx >= 0\ny >= 0\nGenerals\nx y\nEnd';

test('persistent solves distinguish an optimum from a feasible limited incumbent', () => {
  const optimal = runSolver(highs, problem);
  assert.equal(optimal.status, 'optimal');
  assert.equal(optimal.feasible, true);
  assert.equal(optimal.objective, 3);
  assert.equal(optimal.lower_bound, 3);
  assert.equal(optimal.relative_gap, 0);
  const limited = runSolver(highs, problem, {time_limit: 0, presolve: 'off'}, {x: 4, y: 0});
  assert.equal(limited.status, 'timeLimit');
  assert.equal(limited.feasible, true);
  assert.equal(limited.optimal, false);
  assert.equal(limited.columns.x, 4);
  assert.equal(limited.objective, 4);
  assert.equal(limited.lower_bound, null);
  assert.equal(limited.relative_gap, null);
});

test('solution buffers from an unsolved or infeasible model are not accepted', () => {
  const limited = runSolver(highs, problem, {time_limit: 0, presolve: 'off'});
  assert.equal(limited.feasible, false);
  assert.equal(limited.columns, null);
  const impossible = runSolver(highs, problem.replace('x >= 0\ny >= 0', 'x = 0\ny = 0'));
  assert.equal(impossible.status, 'infeasible');
  assert.equal(impossible.feasible, false);
  assert.equal(impossible.columns, null);
});

test('an invalid initial solution cannot become an unchecked incumbent', () => {
  const result = runSolver(highs, problem, {time_limit: 0, presolve: 'off'}, {x: 0, y: 0});
  assert.equal(result.feasible, false);
  assert.equal(result.columns, null);
});

test('native model memory is released when configuration fails', () => {
  let disposed = false;
  const fake = {createModel: () => ({options: {set: () => {throw new Error('bad option');}}, dispose: () => {disposed = true;}})};
  assert.throws(() => runSolver(fake, problem), /bad option/);
  assert.equal(disposed, true);
});
