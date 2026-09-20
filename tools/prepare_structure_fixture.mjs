import {readFile, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {solveFactory} from '../kernel/planner.js';

const [catalogPath, outputPath] = process.argv.slice(2);
if (!catalogPath || !outputPath) throw new Error('Provide a catalog and a private output path for the controlled structure fixture.');
const data = JSON.parse(await readFile(catalogPath, 'utf8'));
const machine = 'modern_industrialization:electric_blast_furnace';
const recipe = data.recipes.find(value => value.primary === 'item:modern_industrialization:steel_ingot' && value.process?.type === 'modern_industrialization:blast_furnace');
const plan = solveFactory(await loadHighs(), data, {goals: [{recipe: recipe.id, resource: recipe.primary, rate: 1}],
  available_machines: [machine], external: [{resource: 'energy:eu'}, ...recipe.inputs.map(flow => ({resource: flow.resource ?? flow.choices[0]}))]});
assert.equal(plan.status, 'optimal');
const result = plan.lines[0].configuration_details.structure;
assert.equal(result.status, 'sized');
assert.deepEqual(Object.fromEntries(result.build_requirements.map(value => [value.resource, value.amount])), {
  'item:modern_industrialization:heatproof_machine_casing': 14,
  'item:modern_industrialization:cupronickel_coil': 16,
  'item:modern_industrialization:steel_item_input_hatch': 1,
  'item:modern_industrialization:bronze_item_output_hatch': 1,
  'item:modern_industrialization:mv_energy_input_hatch': 1,
});
await writeFile(outputPath, JSON.stringify({machine, recipe: recipe.id, ...result}, null, 2));
console.log('The planned steel line uses 14 casings, 16 coils, and three sized hatches per controller.');
