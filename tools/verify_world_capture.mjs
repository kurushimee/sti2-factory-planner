import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {inspectWorld} from '../kernel/world.js';

const [archivePath, capturePath, reportPath] = process.argv.slice(2);
if (!archivePath || !capturePath || !reportPath) throw new Error('Provide a controlled world ZIP, machine capture, and report output path.');
const archive = new Uint8Array(await readFile(archivePath));
const capture = JSON.parse(await readFile(capturePath, 'utf8'));
const result = inspectWorld(archive, capture);
assert.deepEqual(result.errors, []);
const at = x => result.machines.find(machine => machine.origin.dimension === 'minecraft:overworld' && machine.origin.x === x && machine.origin.y === 100 && machine.origin.z === 0);
assert.equal(at(0).id, 'modern_industrialization:electric_macerator');
assert.equal(at(0).recipe_id, 'statech:modern_industrialization/macerator/copper_dust_from_copper_cluster');
assert.equal(at(0).upgrades.id, 'modern_industrialization:advanced_upgrade');
assert.equal(at(0).upgrades.count, 8);
assert.equal(at(2).id, 'modern_industrialization:assembler');
assert.equal(at(2).recipe_id, null);
assert.equal(at(4).contained_machine.id, 'modern_industrialization:electric_macerator');
assert.equal(at(4).contained_machine.count, 16);
assert.equal(at(4).upgrades.count, 4);
assert.equal(at(4).recipe_type, 'modern_industrialization:macerator');
assert.equal(at(6).contained_machine.id, 'modern_industrialization:distillation_tower');
assert.equal(at(6).contained_machine.count, 8);
assert.equal(result.providers.length, 2);
const cableProvider = result.providers.find(provider => provider.origin.part === 'west');
const blockProvider = result.providers.find(provider => provider.origin.part === null);
assert.equal(cableProvider.patterns[0].inputs[0].resource, 'item:spectrum:copper_cluster');
assert.equal(cableProvider.patterns[0].outputs[0].amount, 6);
assert.deepEqual(cableProvider.directions, ['west']);
assert.deepEqual(blockProvider.directions, ['east']);
const extended = Boolean(at(14));
assert.equal(result.machines.length, extended ? 6 : 4);
if (extended) {
  assert.equal(at(12).recipe_id, 'replicate|item:minecraft:iron_ingot');
  assert.equal(at(12).assignment_evidence, 'saved_replication_template');
  assert.equal(at(14).recipe_id, 'minecraft:stick');
  assert.equal(at(14).upgrades.count, 2);
  assert.equal(at(14).assignment_evidence, 'saved_dedicated_crafting_pattern');
  assert.equal(result.reconstruction.goals.length, 3);
  assert.equal(result.reconstruction.unresolved.length, 3);
}
assert.equal(result.parts.length, 1);
assert.equal(result.parts[0].id, 'modern_industrialization:steel_item_input_hatch');
assert.equal(result.requesters.length, 1);
assert.equal(result.requesters[0].requests[0].resource, 'item:modern_industrialization:copper_dust');
assert.equal(result.requesters[0].requests[0].stock_target, '4096');
assert.equal(result.requesters[0].requests[0].crafting_batch, '64');
assert.equal(result.requesters[0].requests[0].rate, null);
const report = {archive_sha256: createHash('sha256').update(archive).digest('hex'),
  data_version: result.data_version, machines: (extended ? [0, 2, 4, 6, 12, 14] : [0, 2, 4, 6]).map(x => {
    const {facts, ...machine} = at(x);
    return machine;
  }), providers: result.providers.map(provider => ({origin: provider.origin, directions: provider.directions,
    patterns: provider.patterns.map(({facts, ...pattern}) => pattern)})),
  parts: result.parts.map(({facts, ...part}) => part),
  requesters: result.requesters.map(({facts, requests, ...requester}) => ({...requester, requests: requests.map(({facts, ...request}) => request)})),
  errors: result.errors, evidence: result.evidence,
  limitations: ['The multiblock controllers are unformed.', 'Saved loadouts establish configured capacity, not observed long-term output.']};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`The real world fixture preserved ${result.machines.length} machines, both arrays, upgrades, assigned recipes, both AE2 provider forms, a separate hatch, and requester quantities.`);
