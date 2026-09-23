import {readFile} from 'node:fs/promises';
import {prepareDataset} from '../kernel/catalog.js';

const path = process.argv[2];
if (!path) throw new Error('Provide the captured player catalog.');
const dataset = JSON.parse(await readFile(path, 'utf8'));
const recipe = dataset.recipes.find(value => value.source_id === 'statech:modern_industrialization/assembler/creative_storage_unit');
if (!recipe) throw new Error('The catalog has no StaTech creative storage unit recipe.');
const start = performance.now();
const result = prepareDataset(dataset, {goals: [{recipe: recipe.id, resource: recipe.primary, rate: 1}],
  replication: false, available_upgrades: dataset.upgrades.map(value => value.id)}, () => {
  if (performance.now() - start > 30000) throw new Error('Catalog preparation exceeded 30 seconds.');
});
console.log(JSON.stringify({case: 'Creative storage unit, all upgrades, replication disabled',
  phase: 'configuration only; no solved factory is claimed', elapsed_ms: Math.round(performance.now() - start),
  recipes: result.recipes.length, configurations: result.recipes.reduce((sum, value) => sum + value.configurations.length, 0)}));
