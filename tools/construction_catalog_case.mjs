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

export function finiteHammerCase(catalog, plates = 35) {
  const hammer = catalog.recipes.find(recipe => recipe.primary === 'item:modern_industrialization:iron_plate' &&
    recipe.tool_usage?.resource === 'item:modern_industrialization:iron_hammer');
  assert.equal(hammer.tool_usage.crafts_per_tool, 34);
  assert.equal(hammer.inputs.filter(flow => flow.resource === 'item:minecraft:iron_ingot').reduce((sum, flow) => sum + flow.amount, 0), 4);
  const goal = {id: 'fixture:plate_structure', primary: 'item:minecraft:stick', inputs: [], outputs: [{resource: 'item:minecraft:stick', amount: 1}],
    configurations: [{id: 'fixture:plate_structure', machine: 'fixture:structure', operations_per_second: 1,
      build_requirements: [{resource: hammer.primary, amount: plates}]}]};
  const machines = [catalog.machines.find(machine => machine.id === 'ae2:molecular_assembler'),
    {id: 'fixture:structure', status: 'supported', mechanic: 'fixed_capacity'}];
  const request = {goals: [{recipe: goal.id, resource: goal.primary, rate: 1}],
    available_machines: machines.map(machine => machine.id), construction: {round_batches: true, external: [
      {resource: 'item:minecraft:iron_ingot'}, {resource: hammer.tool_usage.resource}, {resource: 'energy:eu', cost: 0},
    ]}};
  return {dataset: {...catalog, identity: 'captured-hammer-construction-check', recipes: [goal, hammer], machines,
    default_machines: machines.map(machine => machine.id), progression: [], shape_member_rules: []}, request, hammer, plates};
}

export function verifyFiniteHammerCase(result, fixture) {
  assert.equal(result.status, 'optimal');
  assert.equal(result.construction.method, 'whole_batches');
  assert.equal(result.construction.routes[0].operations, fixture.plates);
  assert.equal(result.construction.tools[0].count, Math.ceil(fixture.plates / 34));
  assert.equal(result.construction.tools[0].remaining_crafts, Math.ceil(fixture.plates / 34) * 34 - fixture.plates);
  assert.equal(result.construction.external.find(flow => flow.resource === 'item:minecraft:iron_ingot').amount, fixture.plates * 4);
  assert.equal(result.construction.external.find(flow => flow.resource === fixture.hammer.tool_usage.resource).amount, Math.ceil(fixture.plates / 34));
}
