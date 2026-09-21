import {readFile, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {solveFactory} from '../kernel/planner.js';

const [catalogPath, outputPath, mode] = process.argv.slice(2);
if (!catalogPath || !outputPath) throw new Error('Provide a catalog and a private output path for the controlled structure fixture.');
const data = JSON.parse(await readFile(catalogPath, 'utf8'));
const irradiation = mode === 'irradiation';
const machine = irradiation ? 'yet_another_industrialization:nuclear_rod_irradiator' : 'modern_industrialization:electric_blast_furnace';
const recipe = data.recipes.find(value => irradiation ? value.id === 'irradiate|item:modern_industrialization:uranium_fuel_rod|modern_industrialization:beryllium_block'
  : value.primary === 'item:modern_industrialization:steel_ingot' && value.process?.type === 'modern_industrialization:blast_furnace');
const plan = solveFactory(await loadHighs(), data, {goals: [{recipe: recipe.id, resource: recipe.primary, rate: irradiation ? 0.02 : 1}],
  available_machines: [machine], external: [{resource: 'energy:eu'}, ...recipe.inputs.map(flow => ({resource: flow.resource ?? flow.choices[0]})),
    ...(irradiation ? [{resource: 'item:modern_industrialization:beryllium_block'}] : [])]});
assert.equal(plan.status, 'optimal');
const result = plan.lines[0].configuration_details.structure;
assert.equal(result.status, 'sized');
if (!irradiation) assert.deepEqual(Object.fromEntries(result.build_requirements.map(value => [value.resource, value.amount])), {
  'item:modern_industrialization:heatproof_machine_casing': 14,
  'item:modern_industrialization:cupronickel_coil': 16,
  'item:modern_industrialization:steel_item_input_hatch': 1,
  'item:modern_industrialization:bronze_item_output_hatch': 1,
  'item:modern_industrialization:lv_energy_input_hatch': 1,
});
await writeFile(outputPath, JSON.stringify({machine, recipe: recipe.id, origin: irradiation ? [192, 100, 0] : [128, 100, 0], ...result}, null, 2));
console.log('Prepared the verified plan bill for placement in the controlled world.');
