import {readFile, writeFile, rename} from 'node:fs/promises';
import loadHighs from 'highs';
import {solveFactory} from './planner.js';
import {inspectWorld} from './world.js';
import {reconstructFactory} from './reconstruct.js';
import {previewConfiguration} from './preview.js';
import {withArchiveFile} from './archive_file.js';
import {createProgressReporter} from './desktop_progress.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Provide an input job path and an output result path.');
let result;
try {
  const job = JSON.parse(await readFile(input, 'utf8'));
  const progress = createProgressReporter(output, job.id);
  if (job.kind === 'preview_configuration') {
    result = {id: job.id, result: previewConfiguration(job.dataset, job.request, job.selection)};
  } else if (job.kind === 'import_world') {
    result = {id: job.id, result: withArchiveFile(job.path, source => inspectWorld(source, job.dataset, progress))};
  } else if (job.kind === 'reconstruct_world') {
    result = {id: job.id, result: {...job.world, corrections: job.corrections,
      reconstruction: reconstructFactory(job.world, job.dataset, job.corrections)}};
  } else {
    const highs = await loadHighs();
    result = {id: job.id, result: solveFactory(highs, job.dataset, job.request, progress)};
  }
} catch (error) {
  result = {error: String(error.message ?? error)};
}
// The UI sees either the whole result or no result, including when a job is cancelled.
await writeFile(`${output}.pending`, JSON.stringify(result));
await rename(`${output}.pending`, output);
