import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructFactory} from './reconstruct.js';

const machine = 'pack:solar_panel';
const cell = 'pack:photovoltaic_cell';
const water = 'pack:distilled_water';
const origin = {dimension: 'minecraft:overworld', x: 40, y: 80, z: 4};
const key = 'minecraft:overworld|40|80|4';
const recipe = (suffix, inputs) => ({id: `planner:solar|${machine}|${suffix}`,
  primary: 'energy:eu', inputs, outputs: [{resource: 'energy:eu', amount: 20}],
  configurations: [{id: `planner:solar|${machine}|${suffix}`, machine,
    periodic_generation: {period_ticks: 2, segments: [{ticks: 1, eu_per_tick: 2}, {ticks: 1, eu_per_tick: 0}]}}]});
const dataset = {machines: [{id: machine, mechanic: 'periodic_generation', status: 'supported'}], recipes: [
  recipe('dry', [{resource: `item:${cell}`, amount: 1}]),
  recipe('water', [{resource: `item:${cell}`, amount: 1}, {resource: `fluid:${water}`, amount: 1}])]};
const saved = fluid => ({id: machine, origin, facts: {items: [{key: {id: cell}, amount: '1'}],
  fluids: fluid ? [{key: {id: water}, amount: fluid}] : []}});

test('saved panel stock selects a reviewable route without becoming a power goal', () => {
  const result = reconstructFactory({machines: [saved('9')]}, dataset);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.goals, []);
  assert.deepEqual(result.assignments, []);
  assert.equal(result.solar_panels[0].recipe, `planner:solar|${machine}|water`);
  assert.equal(result.solar_panels[0].saved_cell.amount, '1');
  assert.equal(result.solar_panels[0].saved_fluid.amount_mb, '9');
  assert.match(result.solar_panels[0].assumption, /not recurring supplies/);
  assert.equal(reconstructFactory({machines: [saved()]}, dataset).solar_panels[0].recipe,
    `planner:solar|${machine}|dry`);
  const corrected = reconstructFactory({machines: [saved('9')]}, dataset,
    {[key]: {solar_recipe: `planner:solar|${machine}|dry`}});
  assert.equal(corrected.solar_panels[0].route_evidence, 'player_correction');
  assert.equal(corrected.solar_panels[0].recipe, `planner:solar|${machine}|dry`);
  const disabled = reconstructFactory({machines: [saved('9')]}, dataset,
    {[key]: {solar_enabled: false}});
  assert.deepEqual(disabled.solar_panels, []);
  assert.equal(disabled.solar_candidates[0].enabled, false);
});

test('unverified cell and route state stay visible for correction', () => {
  const missing = saved('9');
  missing.facts.items = [];
  const result = reconstructFactory({machines: [missing]}, dataset);
  assert.deepEqual(result.solar_panels, []);
  assert.match(result.unresolved[0].reason, /matching photovoltaic cell/);
  const invalid = reconstructFactory({machines: [saved('9')]}, dataset,
    {[key]: {solar_recipe: 'pack:unknown'}});
  assert.deepEqual(invalid.solar_panels, []);
  assert.match(invalid.unresolved[0].reason, /Choose one supported/);
});
