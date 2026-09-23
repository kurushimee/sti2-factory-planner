import test from 'node:test';
import assert from 'node:assert/strict';
import {matchRouteOwnership} from './route_ownership.js';

test('chlorine chemistry can retain its useful products while sharing an acid coproduct', () => {
  const result = matchRouteOwnership(new Map([
    ['chloroform', ['hydrochloric_acid', 'chloroform']],
    ['tetrafluoroethylene', ['hydrochloric_acid', 'tetrafluoroethylene']],
    ['acid', ['hydrochloric_acid']],
  ]));
  assert.deepEqual(result.conflict, []);
  assert.deepEqual(new Map(result.assignments.map(value => [value.recipe, value.resource])),
    new Map([['acid', 'hydrochloric_acid'], ['chloroform', 'chloroform'], ['tetrafluoroethylene', 'tetrafluoroethylene']]));
});

test('competing single-output routes identify a complete exclusion branch', () => {
  const result = matchRouteOwnership(new Map([['cheap', ['plate']], ['fast', ['plate']], ['wire', ['wire']]]));
  assert.deepEqual(result.conflict, ['cheap', 'fast']);
});

test('alternating reassignment preserves every recipe without recursion', () => {
  const candidates = new Map(Array.from({length: 10000}, (_, index) => [`r${index}`, [`o${index}`, `o${index + 1}`]]));
  candidates.set('last', ['o0']);
  const result = matchRouteOwnership(candidates);
  assert.equal(result.conflict.length, 0);
  assert.equal(result.assignments.length, candidates.size);
  assert.equal(new Set(result.assignments.map(value => value.resource)).size, candidates.size);
});

test('an output without a useful purpose cannot conceal a primary-route conflict', () => {
  const result = matchRouteOwnership(new Map([['unused', []]]));
  assert.deepEqual(result.conflict, ['unused']);
});
