import {readFile} from 'node:fs/promises';
import {validateDataset} from '../kernel/validation.js';

const path = process.argv[2];
if (!path) throw new Error('Provide a dataset JSON path.');
const dataset = JSON.parse(await readFile(path, 'utf8'));
validateDataset(dataset);
console.log(`${dataset.identity ?? path}: ${dataset.resources.length} resources and ${dataset.recipes.length} recipes passed format checks.`);
