import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {inspectWorld} from '../kernel/world.js';

const [archivePath, datasetPath, reportPath] = process.argv.slice(2);
if (!reportPath) throw new Error('Provide the structure fixture ZIP, player dataset, and report path.');
const archive = new Uint8Array(await readFile(archivePath));
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const result = inspectWorld(archive, dataset);
assert.deepEqual(result.errors, []);
const controller = result.machines.find(machine => machine.origin.dimension === 'minecraft:overworld' && machine.origin.x === 64 && machine.origin.y === 100 && machine.origin.z === 0);
assert.equal(controller.id, 'modern_industrialization:electric_blast_furnace');
assert.equal(controller.facts.activeRecipe, undefined);
assert.equal(controller.facts.facingDirection, 5);
assert.equal(controller.structure.status, 'matching_saved_geometry');
assert.deepEqual(controller.structure.problems, []);
assert.equal(controller.structure.hatches.length, 1);
assert.equal(controller.recipe_id, 'statech:modern_industrialization/blast_furnace/steel_ingot_from_uncooked_steel');
const hatch = result.parts.find(part => part.controller?.x === 64);
assert.equal(hatch.origin.x, 64); assert.equal(hatch.origin.z, 1);
const provider = result.providers.find(value => value.origin.x === 65 && value.origin.z === 1);
assert.equal(provider.hatch_connections.length, 1);
assert.equal(provider.adjacent_machines[0].x, 64);
assert.equal(result.reconstruction.goals.length, 4);
const {facts, ...configuration} = controller;
await writeFile(reportPath, JSON.stringify({archive_sha256: createHash('sha256').update(archive).digest('hex'),
  controller: configuration, hatch: {origin: hatch.origin, controller: hatch.controller},
  provider: {origin: provider.origin, hatch_connections: provider.hatch_connections},
  evidence: 'The probe built this fixture and the loaded MI ShapeMatcher accepted it. The importer deduced the saved geometry and hatch-delivered recipe.',
  limits: 'Geometry does not establish power connectivity, observed production, or arbitrary custom shape predicates.'}, null, 2) + '\n');
console.log('The real east-facing blast furnace retained its input hatch and inferred steel recipe from the hatch-adjacent provider.');
