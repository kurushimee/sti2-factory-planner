import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readDataset} from './read_dataset.mjs';
import {withArchiveFile} from '../kernel/archive_file.js';
import {inspectWorld} from '../kernel/world.js';

const [archive, catalog, fixturePath] = process.argv.slice(2);
if (!archive || !catalog || !fixturePath) throw new Error('Supply the controlled world ZIP, matching catalog, and runtime fixture report.');
const dataset = await readDataset(catalog);
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'));
assert.equal(fixtures.length, 4);
const imported = withArchiveFile(archive, source => inspectWorld(source, dataset));
for (const fixture of fixtures) {
  assert.equal(fixture.loaded_matcher_accepted, true);
  assert.ok(fixture.vertical_chains > 0);
  const machine = imported.machines.find(value => value.id === fixture.machine &&
    value.origin.x === fixture.x && value.origin.y === fixture.y && value.origin.z === fixture.z);
  assert.ok(machine, `The saved ${fixture.facing} steam quarry was not imported.`);
  assert.equal(machine.facts.facingDirection, fixture.facing_direction);
  assert.equal(machine.structure.status, 'matching_saved_geometry', JSON.stringify(machine.structure));
}
console.log('Four saved steam quarries match the loaded game matcher and the imported world geometry in every horizontal orientation.');
