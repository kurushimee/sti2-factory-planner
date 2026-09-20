import {readFile, writeFile, rename} from 'node:fs/promises';
import loadHighs from 'highs';
import {solveFactory} from './planner.js';
import {inspectWorld} from './world.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Provide an input job path and an output result path.');
let result;
try {
  const job = JSON.parse(await readFile(input, 'utf8'));
  if (job.kind === 'import_world') {
    result = {id: job.id, result: inspectWorld(new Uint8Array(await readFile(job.path)), job.dataset)};
  } else {
    const highs = await loadHighs();
    result = {id: job.id, result: solveFactory(highs, job.dataset, job.request)};
  }
} catch (error) {
  result = {error: String(error.message ?? error)};
}
// The UI sees either the whole result or no result, including when a job is cancelled.
await writeFile(`${output}.pending`, JSON.stringify(result));
await rename(`${output}.pending`, output);
