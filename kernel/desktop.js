import {readFile, writeFile, rename} from 'node:fs/promises';
import loadHighs from 'highs';
import {solveFactory} from './planner.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Provide an input job path and an output result path.');
let result;
try {
  const job = JSON.parse(await readFile(input, 'utf8'));
  const highs = await loadHighs();
  result = {id: job.id, result: solveFactory(highs, job.dataset, job.request)};
} catch (error) {
  result = {error: String(error.message ?? error)};
}
// The UI sees either the whole result or no result, including when a job is cancelled.
await writeFile(`${output}.pending`, JSON.stringify(result));
await rename(`${output}.pending`, output);
