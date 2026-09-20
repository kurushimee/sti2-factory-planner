import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import loadHighs from 'highs';
import {compileConfiguration} from './configuration.js';
import {solveFactory} from './planner.js';

test('loaded burst-generator cycles retain duration, large energy values and startup stocks', async () => {
  const report = JSON.parse(readFileSync(new URL('../data/provenance/runtime-report.json', import.meta.url)));
  const samples = [...report.recipe_generation, ...report.pulse_detonation];
  assert.equal(samples.length, 10);
  const highs = await loadHighs();
  for (const sample of samples) {
    const outputs = [{resource: 'energy:eu', amount: sample.cycle.generated_eu},
      ...sample.cycle.fluid_outputs.map(flow => ({resource: `fluid:${flow.fluid}`, amount: flow.amount}))];
    const recipe = {id: sample.recipe, primary: 'energy:eu', inputs: [{resource: 'feed', amount: 1}], outputs,
      duration_ticks: sample.duration_ticks, eu_per_tick: 0};
    const configuration = compileConfiguration(recipe, {id: 'generator', mechanic: 'fixed_cycle'});
    assert.equal(configuration.capacity.ticks_per_batch, sample.cycle.completion_tick);
    assert.equal(sample.cycle.remaining_items, 0);
    assert.equal(sample.cycle.remaining_fluid_mb, 0);
    recipe.configurations = [configuration];
    const resources = [...new Set(['feed', 'item:generator', ...outputs.map(flow => flow.resource)])].map(id => ({id}));
    const result = solveFactory(highs, {format: 1, resources, recipes: [recipe]}, {
      goals: [{resource: 'energy:eu', rate: sample.cycle.generated_eu * 20 / sample.cycle.completion_tick}],
      external: [{resource: 'feed'}],
    });
    assert.equal(result.status, 'optimal');
    assert.equal(result.lines[0].machines, 1);
    assert.equal(result.power.consumption_eu_per_tick, 0);
    const startup = result.startup.resources.find(flow => flow.resource === 'energy:eu');
    assert.ok(Math.abs(startup.quantity / sample.cycle.generated_eu - 1) < 1e-10);
  }
});
