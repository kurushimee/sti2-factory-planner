import {readFile, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {structureBill, structureContext} from '../kernel/structure_bill.js';

const [catalogPath, outputPath] = process.argv.slice(2);
if (!catalogPath || !outputPath) throw new Error('Provide a catalog and a private output path for the Tesla fixture.');
const dataset = JSON.parse(await readFile(catalogPath, 'utf8'));
const context = structureContext(dataset);
const machine = 'extended_industrialization:tesla_tower';
const tower = context.definitions.get(machine);
const variant = tower.infrastructure.find(value => value.id === '0');
const power = variant.passive_eu_per_tick + variant.max_transfer_eu_per_tick;
const bill = structureBill(tower.shapes.find(value => value.index === 0), dataset.shape_member_rules, context.hatches,
  [{type: 'modern_industrialization:energy_input', energy: {buffer: power, rate: power}}],
  {allowed_parts: ['modern_industrialization:lv_energy_input_hatch']});
assert.equal(bill.build_requirements.find(value => value.resource === 'item:modern_industrialization:lv_energy_input_hatch').amount, 7);
await writeFile(outputPath, JSON.stringify({machine, origin: [256, 100, 0], ...bill}, null, 2));
console.log('Prepared a copper Tesla tower with seven LV hatches for its stated full-load supply.');
