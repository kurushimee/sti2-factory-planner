import assert from 'node:assert/strict';

export function endgameRequest(dataset, goal = 'creative_storage_unit') {
  const recipe = dataset.recipes.find(value => value.source_id === `statech:modern_industrialization/assembler/${goal}`);
  assert.ok(recipe, 'The released creative storage recipe must be present.');
  return {goals: [{recipe: recipe.id, resource: recipe.primary, rate: 1 / 3600}], replication: false,
    available_upgrades: dataset.upgrades.map(value => value.id), external: [{resource: 'energy:eu'}],
    obtained_resources: dataset.recipes.filter(value => value.type === 'planner:certus_growth').flatMap(value => value.requires_obtained),
    time_limit_ms: 120000};
}

export function verifyEndgame(dataset, request, result) {
  assert.ok(['optimal', 'feasible'].includes(result.status), JSON.stringify({status: result.status, branches: result.branches}));
  assert.ok(result.lines.length > 100);
  const recipes = new Map(dataset.recipes.map(value => [value.id, value]));
  for (const line of result.lines) {
    assert.equal(recipes.get(line.recipe).replication === true, false);
    assert.ok(Number.isSafeInteger(line.machines) && line.machines > 0);
    assert.ok(line.operations_per_second <= line.capacity_per_second + 1e-7);
  }
  assert.equal(result.targets[0].rate, 1 / 3600);
  assert.ok(result.lines.some(line => line.recipe === request.goals[0].recipe));
  assert.ok(result.lines.some(line => line.recipe === 'certus_growth|clusters'));
  assert.ok(result.external.every(value => value.resource === 'energy:eu'));
  const owned = result.primary_routes.filter(value => value.resource !== 'energy:eu').map(value => value.resource);
  assert.equal(new Set(owned).size, owned.length);
  assert.ok(result.optimization.lower_bound <= result.objective + 1e-7);
  assert.ok(result.optimization.relative_gap >= 0);
  if (result.status === 'feasible') assert.equal(result.optimal, false);
  for (const balance of result.balances) assert.ok(balance.surplus >= -balance.numerical_tolerance);
  for (const residual of result.flow_roundoff) assert.ok(residual.rate <= residual.numerical_tolerance);
}
