import loadHighs from 'highs';
import {readDataset} from './read_dataset.mjs';
import {solveFactory} from '../kernel/planner.js';
import {constructionCase, verifyConstructionCase, finiteHammerCase, verifyFiniteHammerCase} from './construction_catalog_case.mjs';

const catalog = await readDataset(process.argv[2] ?? 'data/statech-2.0.1.json.gz');
const fixture = constructionCase(catalog), highs = await loadHighs();
verifyConstructionCase(solveFactory(highs, fixture.dataset, fixture.request), fixture);
console.log('Captured upgrade recipes favor four basic upgrades over a second macerator or a quantum upgrade under the stated component prices.');
for (const plates of [1, 34, 35, 1000]) {
  const finite = finiteHammerCase(catalog, plates);
  verifyFiniteHammerCase(solveFactory(highs, finite.dataset, finite.request), finite);
}
console.log('Captured hammer crafting uses four ingots per plate and whole tools at its verified 34-craft lifetime.');
