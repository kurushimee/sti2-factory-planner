import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import loadHighs from 'highs';
import {readDataset} from './read_dataset.mjs';
import {endgameRequest, verifyEndgame} from './endgame_case.mjs';
import {solveFactory} from '../kernel/planner.js';

const dataset = await readDataset(process.argv[2] ?? 'data/statech-2.0.1.json.gz');
const request = {...endgameRequest(dataset), time_limit_ms: 180000,
  construction: {external: [{resource: 'energy:eu', cost: 0}], work: 0.001}};
const start = performance.now();
const result = solveFactory(await loadHighs(), dataset, request,
  event => console.log(JSON.stringify({elapsed_ms: performance.now() - start, ...event})));
verifyEndgame(dataset, request, result);
assert.equal(result.search.method, 'material_cost_refinement');
assert.equal(result.optimization.lower_bound, null);
assert.ok(result.construction.requirements.length > 100);
assert.ok(result.construction.routes.length > 100);
assert.ok(result.construction.external.every(supply => supply.resource === 'energy:eu'));
for (const balance of result.construction.balances) assert.ok(balance.surplus >= -balance.numerical_tolerance);
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify({request, result}));
console.log(JSON.stringify({elapsed_ms: performance.now() - start, status: result.status, lines: result.lines.length,
  construction_routes: result.construction.routes.length, objective: result.objective,
  construction_objective: result.construction.objective}));
