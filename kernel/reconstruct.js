import {compileConfiguration} from './configuration.js';

export function worldMachineKey(machine) {
  const origin = machine.origin;
  return `${origin.dimension}|${origin.x}|${origin.y}|${origin.z}`;
}

export function reconstructFactory(imported, dataset, corrections = {}) {
  const machines = new Map((dataset.machines ?? []).map(value => [value.id, value]));
  const upgrades = new Map((dataset.upgrades ?? []).map(value => [value.id, value]));
  const assignments = [], unresolved = [];
  const candidates = new Map();
  for (const recipe of dataset.recipes ?? []) {
    for (const id of new Set([recipe.id, recipe.source_id].filter(Boolean))) {
      if (!candidates.has(id)) candidates.set(id, []);
      candidates.get(id).push(recipe);
    }
  }
  for (const saved of imported.machines) {
    const key = worldMachineKey(saved);
    const correction = Object.hasOwn(corrections, key) ? corrections[key] : {};
    if (correction.exclude) continue;
    const recipeId = correction.recipe ?? saved.recipe_id;
    const possible = (candidates.get(recipeId) ?? []).filter(recipe => !saved.recipe_type || recipe.type === saved.recipe_type || recipe.process?.type === saved.recipe_type);
    const pending = reason => unresolved.push({machine: key, origin: saved.origin, machine_id: saved.id, recipe_id: recipeId, reason,
      recipe_candidates: saved.provider_candidates ?? [], facts: saved});
    if (!recipeId) { pending('No unique recipe assignment was saved or inferred.'); continue; }
    if (possible.length !== 1) { pending('The saved recipe does not identify one recipe in this dataset.'); continue; }
    const recipe = possible[0];
    const machine = machines.get(saved.id);
    if (!machine?.mechanic || machine.status !== 'supported' || !recipe.process || recipe.unsupported) {
      pending(recipe.unsupported ?? 'The saved machine or recipe still needs a capacity adapter.'); continue;
    }
    try {
      const setup = {shape: saved.shape ?? 0, upgrade_count: saved.upgrades?.count ?? 0,
        ...(saved.contained_machine?.id ? {contained_machine: saved.contained_machine.id, contained_count: saved.contained_machine.count} : {}),
        ...(saved.casing?.id ? {casing: saved.casing.id} : {}), ...correction.setup};
      if (saved.upgrades?.id && !setup.upgrade) {
        if (!upgrades.has(saved.upgrades.id)) throw new Error(`The saved upgrade is unknown: ${saved.upgrades.id}.`);
        setup.upgrade = upgrades.get(saved.upgrades.id);
      }
      if (machine.steel_hatch_variant && !Object.hasOwn(setup, 'steel_hatches')) throw new Error('The controller needs an associated hatch tier before its capacity can be established.');
      const configuration = compileConfiguration({...recipe, ...recipe.process}, machine, setup);
      assignments.push({machine: key, origin: saved.origin, recipe: recipe.id, configuration, setup,
        assignment_evidence: correction.recipe ? 'player_correction' : saved.assignment_evidence,
        capacity_basis: 'Configured capacity with continuous inputs, peak power, and accepted outputs; not an observed production rate.'});
    } catch (error) { pending(error.message); }
  }
  const recipes = new Map(dataset.recipes.map(value => [value.id, value]));
  const consumers = new Map();
  for (const assignment of assignments) {
    for (const flow of recipes.get(assignment.recipe).inputs) {
      for (const resource of flow.choices ?? [flow.resource]) {
        if (!consumers.has(resource)) consumers.set(resource, new Set());
        consumers.get(resource).add(assignment.recipe);
      }
    }
  }
  const goals = [], machineSetups = Object.create(null), grouped = new Map();
  const goalCandidates = [];
  for (const assignment of assignments) {
    const recipe = recipes.get(assignment.recipe);
    const consumersOfPrimary = [...consumers.get(recipe.primary) ?? []].filter(id => id !== recipe.id);
    const correction = Object.hasOwn(corrections, assignment.machine) ? corrections[assignment.machine] : {};
    const retained = correction.goal ?? consumersOfPrimary.length === 0;
    goalCandidates.push({machine: assignment.machine, recipe: recipe.id, resource: recipe.primary, retained,
      consumers: consumersOfPrimary, evidence: Object.hasOwn(correction, 'goal') ? 'player_correction' : 'primary_output_dependency_inference',
      reason: retained ? 'Keep this configured output as an editable capacity target.' : 'Another assigned recipe consumes this primary output.'});
    if (!retained) continue;
    const configuration = assignment.configuration;
    if (!grouped.has(configuration.id)) {
      const goal = {kind: 'capacity', recipe: recipe.id, resource: recipe.primary, configuration: configuration.id, machines: 0, origins: [], inferred: true};
      grouped.set(configuration.id, goal);
      goals.push(goal);
      machineSetups[recipe.id] ??= [];
      machineSetups[recipe.id].push({machine: configuration.machine, setup: assignment.setup, configuration: configuration.id});
    }
    const goal = grouped.get(configuration.id);
    goal.machines++;
    goal.origins.push(assignment.origin);
  }
  if (assignments.length && !goals.length && goalCandidates.every(value => value.consumers.length && value.evidence !== 'player_correction')) unresolved.push({reason: 'Assigned production forms a cycle with no clear retained primary output. Choose an end goal.', machines: assignments.map(value => value.machine)});
  return {assignments, goals, goal_candidates: goalCandidates, machine_setups: machineSetups, unresolved,
    stock_targets: (imported.requesters ?? []).flatMap(requester => requester.requests.map(value => ({...value, origin: requester.origin}))),
    inference: 'Primary outputs with no other assigned consumer become capacity goals. Shared-resource connectivity is inferred, not a recovered cable network. Byproduct retention and cycles may need correction.',
    bootstrap_verified: false};
}
