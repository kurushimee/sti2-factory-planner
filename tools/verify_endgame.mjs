import {writeFile} from 'node:fs/promises';
import loadHighs from 'highs';
import {readDataset} from './read_dataset.mjs';
import {endgameRequest, verifyEndgame} from './endgame_case.mjs';
import {solveFactory} from '../kernel/planner.js';

const dataset = await readDataset(process.argv[2] ?? 'data/statech-2.0.1.json.gz');
const request = endgameRequest(dataset);
const highs = await loadHighs();
const start = performance.now();
const result = solveFactory(highs, dataset, request);
verifyEndgame(dataset, request, result);
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify({request, result}));
console.log(JSON.stringify({status: result.status, elapsed_ms: performance.now() - start, lines: result.lines.length,
  machines: result.lines.reduce((sum, line) => sum + line.machines, 0), optimization: result.optimization}));
