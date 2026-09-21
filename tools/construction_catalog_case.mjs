import assert from 'node:assert/strict';

export function constructionCase(catalog) {
  const production = catalog.recipes.find(value => value.source_id === 'statech:modern_industrialization/macerator/copper_dust_from_copper_cluster');
  const upgrades = ['basic', 'quantum'].map(tier => catalog.recipes.find(value => value.source_id === `modern_industrialization:electric_age/upgrades/${tier}`));
  assert.equal(upgrades[0].outputs[0].amount, 4);
  assert.deepEqual(upgrades[0].inputs.map(flow => flow.amount), [2, 4, 2, 1]);
  assert.deepEqual(upgrades[1].inputs.map(flow => flow.amount), [32, 8, 1, 1, 50]);
  const resources = new Set(upgrades.flatMap(recipe => recipe.inputs.map(flow => flow.resource)));
  const request = {goals: [{recipe: production.id, resource: production.primary, rate: 12}],
    available_machines: ['modern_industrialization:electric_macerator', 'modern_industrialization:assembler'],
    available_upgrades: ['modern_industrialization:basic_upgrade', 'modern_industrialization:quantum_upgrade'],
    external: [{resource: production.inputs[0].resource}, {resource: 'energy:eu', cost: 0}],
    construction: {work: 0.001, external: [
      {resource: 'item:modern_industrialization:electric_macerator', cost: 100},
      {resource: 'energy:eu', cost: 0}, ...[...resources].map(resource => ({resource, cost: 1})),
    ]}};
  return {dataset: {...catalog, recipes: [production, ...upgrades]}, request, production, basic: upgrades[0]};
}

export function verifyConstructionCase(result, fixture) {
  assert.equal(result.status, 'optimal');
  assert.equal(result.lines.length, 1);
  const line = result.lines[0];
  assert.equal(line.machines, 1);
  assert.equal(line.configuration_details.setup.upgrade.id, 'modern_industrialization:basic_upgrade');
  assert.equal(line.configuration_details.setup.upgrade_count, 4);
  const build = result.construction.routes.find(value => value.recipe === fixture.basic.id);
  assert.equal(build.operations, 1);
  for (const input of fixture.basic.inputs) {
    const supplied = result.construction.external.find(value => value.resource === input.resource);
    assert.equal(supplied.amount, input.amount);
  }
  assert.equal(result.construction.material_cost, 109);
}
