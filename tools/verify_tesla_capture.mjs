import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {inspectWorld} from '../kernel/world.js';
import {infrastructurePower} from '../kernel/infrastructure.js';
const [archivePath, datasetPath, reportPath] = process.argv.slice(2);
const archive = new Uint8Array(await readFile(archivePath));
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const world = inspectWorld(archive, dataset);
assert.deepEqual(world.errors, []);
const selected = world.reconstruction.infrastructure;
assert.equal(selected.length, 1);
assert.equal(selected[0].machine, 'extended_industrialization:tesla_tower');
assert.equal(selected[0].variant, '0');
assert.equal(selected[0].energy_hatch, 'modern_industrialization:lv_energy_input_hatch');
assert.equal(selected[0].imported_hatches.length, 7);
assert.equal(selected[0].transmit_eu_per_tick, 1536);
const power = infrastructurePower(dataset, {infrastructure: selected});
assert.equal(power.total_eu_per_tick, 64);
assert.equal(power.entries[0].structure.build_requirements.find(value => value.resource === `item:${selected[0].energy_hatch}`).amount, 7);
assert(!world.reconstruction.unresolved.some(value => value.machine_id === selected[0].machine));
await writeFile(reportPath, JSON.stringify({archive_sha256: createHash('sha256').update(archive).digest('hex'), configuration: selected[0],
  passive_eu_per_tick: power.total_eu_per_tick, evidence: 'A stopped real world contains a matching copper Tesla structure and seven uniquely associated LV input hatches.',
  limits: 'Continuous enabled operation is assumed. The winding limit becomes an editable capacity target. Saved energy is a quantity; receiver coverage and observed transmission are not established.'}, null, 2) + '\n');
if (process.argv[5]) await writeFile(process.argv[5], JSON.stringify(world));
console.log('The real saved tower reconstructs copper winding, seven LV input hatches, and 64 EU/t enabled drain.');

