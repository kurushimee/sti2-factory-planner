import {readDataset} from './read_dataset.mjs';
import {validateDataset} from '../kernel/validation.js';

const path = process.argv[2];
if (!path) throw new Error('Provide a dataset JSON path.');
const dataset = await readDataset(path);
validateDataset(dataset);
console.log(`${dataset.identity ?? path}: ${dataset.resources.length} resources and ${dataset.recipes.length} recipes passed format checks.`);
