import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {readDataset} from './read_dataset.mjs';
import {solveFactory} from '../kernel/planner.js';
import {withRecipes} from '../kernel/recipe_preferences.js';

const dataset = await readDataset(process.argv[2] ?? 'data/statech-2.0.1.json.gz');
const versions = new Map(dataset.loaded_mods.map(mod => [mod.id, mod.version]));
const mods = new Map([
  ['modern_industrialization', '2.5.8'],
  ['extended_industrialization', '1.16.2-1.21.1'],
  ['industrialization_overdrive', '1.14.0+1.21.1'],
  ['yet_another_industrialization', '1.6.3-1.21.1'],
]);
assert.equal(dataset.identity, 'statech-industry-2:2.0.1');
for (const [mod, version] of mods) assert.equal(versions.get(mod), version);

const relevant = dataset.recipes.filter(recipe => mods.has(recipe.type?.split(':')[0]));
const unavailable = dataset.unsupported_entries.filter(entry => mods.has(entry.type?.split(':')[0]));
const machineTypes = new Set(dataset.machines.filter(machine => machine.status === 'supported')
  .map(machine => machine.recipe_type));
assert.equal(relevant.length, 10024);
assert.equal(unavailable.length, 113);
for (const recipe of relevant) {
  assert.ok(recipe.process || recipe.configurations.length, `${recipe.id} has no process rule.`);
  assert.ok(recipe.configurations.length || machineTypes.has(recipe.type), `${recipe.id} has no supported machine.`);
  const chance = [...recipe.inputs, ...recipe.outputs].some(flow => (flow.probability ?? 1) !== 1);
  assert.equal(recipe.expected_yields, chance, `${recipe.id} must identify chance-based flow.`);
  assert.equal(/estimate|approximate|assumed 40-tick/i.test(JSON.stringify(recipe)), false,
    `${recipe.id} contains an empirical allowance.`);
}
assert.ok(unavailable.every(entry => entry.reason && entry.source_id));

const highs = await loadHighs();
const ironPlate = dataset.recipes.find(recipe => recipe.source_id ===
  'modern_industrialization:materials/iron/compressor/main');
const early = solveFactory(highs, dataset, {goals: [{recipe: ironPlate.id, resource: ironPlate.primary, rate: 1}],
  replication: false, available_machines: dataset.progression[2].available_machines,
  available_upgrades: dataset.progression[2].available_upgrades,
  external: [{resource: 'energy:eu', cost: 0}], time_limit_ms: 30000, exact_production: true});
assert.ok(['optimal', 'feasible'].includes(early.status));
assert.equal(early.exact_production.status, 'exact');
assert.deepEqual(early.flow_roundoff, []);
assert.equal(early.targets[0].rate, 1);
assert.ok(early.lines.some(line => line.recipe === ironPlate.id));
assert.ok(early.external.every(flow => flow.resource === 'energy:eu'));
const byId = new Map(dataset.recipes.map(recipe => [recipe.id, recipe]));
const chanceLines = early.lines.filter(line => byId.get(line.recipe).expected_yields);
assert.ok(chanceLines.length > 0);
assert.ok(early.lines.every(line => !/estimate|approximate/i.test(JSON.stringify(byId.get(line.recipe)))));

const quantum = dataset.recipes.find(recipe => recipe.source_id ===
  'modern_industrialization:electric_age/upgrades/quantum');
const isolated = withRecipes(dataset, [quantum]);
const late = solveFactory(highs, isolated, {goals: [{recipe: quantum.id, resource: quantum.primary, rate: 0.02}],
  replication: false, available_machines: ['modern_industrialization:assembler'],
  external: [...quantum.inputs.map(flow => ({resource: flow.resource})), {resource: 'energy:eu'}],
  exact_production: true});
assert.equal(late.status, 'optimal');
assert.equal(late.exact_production.status, 'exact');
assert.equal(late.lines.length, 1);
assert.equal(late.lines[0].machines, 1);
assert.equal(late.lines[0].operations_per_second, 0.02);
for (const input of quantum.inputs) {
  const supply = late.external.find(flow => flow.resource === input.resource);
  assert.ok(supply);
  assert.ok(Math.abs(supply.rate - input.amount * 0.02) < 1e-10);
}
console.log(JSON.stringify({pack: dataset.identity, process_recipes: relevant.length,
  explicitly_unsupported: unavailable.length,
  chance_recipes: relevant.filter(recipe => recipe.expected_yields).length,
  early: {lines: early.lines.length, machines: early.lines.reduce((sum, line) => sum + line.machines, 0),
    chance_lines: chanceLines.length, status: early.status},
  late: {recipe: quantum.id, lines: late.lines.length, machines: late.lines[0].machines, status: late.status}}));
