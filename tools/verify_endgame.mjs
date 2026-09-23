import {writeFile} from 'node:fs/promises';
import loadHighs from 'highs';
import {readDataset} from './read_dataset.mjs';
import {endgameRequest, verifyEndgame} from './endgame_case.mjs';
import {solveFactory} from '../kernel/planner.js';

const dataset = await readDataset(process.argv[2] ?? 'data/statech-2.0.1.json.gz');
const request = endgameRequest(dataset, process.argv[4]);
if (process.env.STI2_ENDGAME_BUDGET_MS) {
  const budget = Number(process.env.STI2_ENDGAME_BUDGET_MS);
  if (!Number.isSafeInteger(budget) || budget < 120000 || budget > 600000) throw new Error('The endgame check budget must be 120–600 seconds.');
  request.time_limit_ms = budget;
}
const highs = await loadHighs();
const start = performance.now();
const result = solveFactory(highs, dataset, request, event => console.log(JSON.stringify({elapsed_ms: performance.now() - start, ...event})));
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify({request, result}));
console.log(JSON.stringify({status: result.status, phase: result.phase, branches: result.branches,
  elapsed_ms: performance.now() - start, budget_ms: request.time_limit_ms}));
verifyEndgame(dataset, request, result);
console.log(JSON.stringify({status: result.status, elapsed_ms: performance.now() - start, lines: result.lines.length,
  machines: result.lines.reduce((sum, line) => sum + line.machines, 0), optimization: result.optimization,
  numerical_retries: result.search?.numerical_retries ?? 0}));
