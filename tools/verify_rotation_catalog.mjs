import assert from 'node:assert/strict';
import {readDataset} from './read_dataset.mjs';

const dataset = await readDataset(process.argv[2] ?? 'data/statech-2.0.1.json.gz');
const quarry = dataset.machines.find(machine => machine.id === 'modern_industrialization:steam_quarry');
assert.ok(quarry?.shapes?.length);
const rules = new Set(quarry.shapes.flatMap(shape => shape.cells.map(cell => cell.member_rule)));
const chain = [...rules].map(index => dataset.shape_member_rules[index]).find(rule =>
  rule?.matching_states?.some(state => state.Name === 'minecraft:chain' && state.Properties?.axis === 'y'));
assert.ok(chain?.state_only_verified && chain.rotation_verified);
for (const direction of ['2', '3', '4', '5']) {
  assert.deepEqual(chain.matching_world_states?.[direction], [{Name: 'minecraft:chain', Properties: {axis: 'y'}}]);
}
console.log('The bundled steam quarry uses the captured vertical-chain state in all four world orientations.');
