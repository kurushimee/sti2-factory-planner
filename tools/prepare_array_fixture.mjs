import {readFile, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {compileConfiguration} from '../kernel/configuration.js';
import {attachStructureBills} from '../kernel/structure_bill.js';
const [catalogPath, outputPath, mode = 'single'] = process.argv.slice(2);
const dataset = JSON.parse(await readFile(catalogPath, 'utf8'));
const multi = mode === 'multi';
const machine = dataset.machines.find(value => value.id === (multi ? 'industrialization_overdrive:multi_processing_array' : 'extended_industrialization:processing_array'));
const contained = multi ? 'modern_industrialization:distillation_tower' : 'modern_industrialization:electric_macerator';
const recipe = dataset.recipes.find(value => value.source_id === (multi ? 'modern_industrialization:petrochem/distillation/crude_oil_full' : 'statech:modern_industrialization/macerator/copper_dust_from_copper_cluster'));
const setup = {contained_machine: contained, contained_count: 8, shape: 0, upgrade: dataset.upgrades.find(value => value.id === 'modern_industrialization:advanced_upgrade'), upgrade_count: 4};
const configuration = compileConfiguration({...recipe, ...recipe.process}, machine, setup);
const plan = {lines: [{recipe: recipe.id, configuration_details: configuration, machine: machine.id,
  ingredient_choices: recipe.inputs.map((flow, slot) => ({slot, resource: flow.resource ?? flow.choices[0]}))}]};
attachStructureBills(plan, dataset);
assert.equal(configuration.structure.status, 'sized', configuration.structure.reason);
await writeFile(outputPath, JSON.stringify({machine: machine.id, recipe: recipe.source_id, origin: multi ? [384, 100, 0] : [320, 100, 0], setup,
  inputs: recipe.inputs, outputs: recipe.outputs, expected_capacity: configuration.capacity, ...configuration.structure}, null, 2));
console.log(`Prepared ${mode} array with eight contained machines and four advanced upgrades.`);
