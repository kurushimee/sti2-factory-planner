import loadHighs from 'highs';
import {readDataset} from './read_dataset.mjs';
import {solveFactory} from '../kernel/planner.js';
import {constructionCase, verifyConstructionCase} from './construction_catalog_case.mjs';

const fixture = constructionCase(await readDataset(process.argv[2] ?? 'data/statech-2.0.1.json.gz'));
verifyConstructionCase(solveFactory(await loadHighs(), fixture.dataset, fixture.request), fixture);
console.log('Captured upgrade recipes favor four basic upgrades over a second macerator or a quantum upgrade under the stated component prices.');
