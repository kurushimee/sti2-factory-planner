import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDataset} from './validation.js';

const example = () => JSON.parse(readFileSync(new URL('../data/example.json', import.meta.url)));
test('dataset validation accepts the portable example', () => validateDataset(example()));
test('dataset validation rejects malformed references before dependency pruning', () => {
  for (const [change, message] of [
    [data => data.resources.push(data.resources[0]), /duplicate ID/],
    [data => data.recipes[0].outputs[0].resource = 'missing', /unknown ID/],
    [data => data.recipes[0].primary = 'coal', /primary must/],
    [data => data.recipes[0].configurations[0].eu_per_operation = -1, /eu_per_operation/],
    [data => data.recipes[0].inputs = [{choices: ['ore'], amount: 1, returns: {coal: [{resource: 'ore', amount: 1}]}}], /remainder key/],
    [data => data.recipes[0].process = {type: 'press', duration_ticks: 1.5, eu_per_tick: 2}, /whole number/],
  ]) {
    const data = example();
    change(data);
    assert.throws(() => validateDataset(data), message);
  }
});
