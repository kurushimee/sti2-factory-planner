import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compileConfiguration} from '../kernel/configuration.js';
import {attachStructureBills} from '../kernel/structure_bill.js';
const dataset = JSON.parse(gunzipSync(await readFile('data/statech-2.0.1.json.gz')));
const report = JSON.parse(await readFile('data/provenance/array-save-report.json', 'utf8'));
for (const saved of report.arrays) {
  const machine = dataset.machines.find(value => value.id === saved.machine);
  const recipe = dataset.recipes.find(value => value.id === saved.recipe);
  const configuration = compileConfiguration({...recipe, ...recipe.process}, machine, {shape: 0,
    contained_machine: saved.contained_machine.id, contained_count: saved.contained_machine.count,
    upgrade: dataset.upgrades.find(value => value.id === saved.upgrades.id), upgrade_count: saved.upgrades.count});
  assert.equal(configuration.capacity.ticks_per_batch, saved.steady_ticks);
  assert.equal(configuration.capacity.energy_per_batch, saved.energy_per_batch);
  assert.equal(configuration.operations_per_second, saved.operations_per_batch * 20 / saved.steady_ticks);
  const plan = {lines: [{recipe: recipe.id, machine: machine.id, configuration_details: configuration,
    ingredient_choices: recipe.inputs.map((flow, slot) => ({slot, resource: flow.resource ?? flow.choices[0]}))}]};
  attachStructureBills(plan, dataset);
  assert.equal(configuration.structure.status, 'sized', configuration.structure.reason);
  const evidence = JSON.parse(await readFile(`data/provenance/${saved.origin.x === 320 ? 'processing-array' : 'multi-processing-array'}-structure-check.json`, 'utf8'));
  assert.deepEqual(Object.fromEntries(configuration.structure.build_requirements.map(value => [value.resource.substring(5), value.amount])), evidence.placed_blocks_excluding_controller);
  for (const sample of evidence.array_cycle.steady_batches.slice(1)) {
    assert.equal(sample.ticks, saved.steady_ticks);
    assert.equal(sample.energy, saved.energy_per_batch);
    assert.equal(sample.output_quantity, saved.total_output_per_batch);
  }
}
console.log('Both bundled array configurations and structure bills match formed runtime batches and saved configurations.');
