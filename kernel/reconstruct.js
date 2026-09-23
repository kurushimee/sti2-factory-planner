import {compileConfiguration} from './configuration.js';

export function worldMachineKey(machine) {
  const origin = machine.origin;
  return `${origin.dimension}|${origin.x}|${origin.y}|${origin.z}`;
}

export function reconstructFactory(imported, dataset, corrections = {}) {
  const machines = new Map((dataset.machines ?? []).map(value => [value.id, value]));
  const upgrades = new Map((dataset.upgrades ?? []).map(value => [value.id, value]));
  const assignments = [], unresolved = [], infrastructure = [], infrastructureCandidates = [], storageUnits = [];
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
      recipe_candidates: saved.recipe_candidates ?? saved.provider_candidates ?? [], facts: saved});
    const definition = machines.get(saved.id);
    if (definition?.mechanic === 'energy_storage') {
      const rule = definition.storage;
      const raw = saved.facts?.[rule?.saved_charge_field ?? 'storedEu'];
      if (!rule || !Number.isSafeInteger(rule.capacity_eu) || rule.capacity_eu <= 0
        || !Number.isSafeInteger(rule.charge_eu_per_tick) || rule.charge_eu_per_tick <= 0
        || !Number.isSafeInteger(rule.discharge_eu_per_tick) || rule.discharge_eu_per_tick <= 0
        || rule.loss_eu_per_tick !== 0) {
        pending('This storage unit needs a verified capacity, transfer limit, and loss rule.'); continue;
      }
      if (!/^(0|[1-9]\d*)$/.test(String(raw ?? '')) || BigInt(raw) > BigInt(rule.capacity_eu)) {
        pending('The saved charge is missing, invalid, or exceeds this storage unit capacity.'); continue;
      }
      storageUnits.push({machine: key, machine_id: saved.id, origin: saved.origin,
        enabled: correction.storage_enabled !== false,
        saved_charge_eu: String(raw), capacity_eu: rule.capacity_eu,
        charge_eu_per_tick: rule.charge_eu_per_tick, discharge_eu_per_tick: rule.discharge_eu_per_tick,
        loss_eu_per_tick: rule.loss_eu_per_tick, evidence: `saved_${rule.saved_charge_field ?? 'storedEu'}`,
        assumption: 'Saved charge is a starting quantity, not a sustained power supply. Cable layout and enabled state may limit transfer.'});
      continue;
    }
    if (definition?.mechanic === 'passive_infrastructure') {
      const enabled = correction.infrastructure_enabled;
      const candidate = {machine: key, origin: saved.origin, enabled: enabled ?? true,
        evidence: 'saved_structure_and_unique_energy_hatches',
        assumption: 'Continuous enabled operation with supplied power; no observed transmission rate or verified receiver network.'};
      infrastructureCandidates.push(candidate);
      if (enabled === false) continue;
      const variant = definition.infrastructure?.find(value => value.structure?.shape === saved.shape);
      if (!variant || saved.structure?.status !== 'matching_saved_geometry') {
        pending('The infrastructure needs a supported winding and a matching saved structure.'); continue;
      }
      const hatches = (imported.parts ?? []).filter(part => part.controller && worldMachineKey({origin: part.controller}) === key
        && part.association_evidence === 'unique_matching_saved_geometry' && part.hatch_type === 'modern_industrialization:energy_input');
      const types = [...new Set(hatches.map(part => part.id))];
      if (types.length !== 1 || !machines.get(types[0])?.hatch_capacity?.cable_eu_per_tick) {
        pending('The infrastructure needs uniquely associated energy input hatches of one supported tier.'); continue;
      }
      if (saved.facts?.redstoneModuleStack?.id && enabled !== true) {
        candidate.enabled = false;
        pending('This tower has redstone control. Confirm continuous operation or leave it excluded; its saved configuration does not establish a duty cycle.'); continue;
      }
      const selection = {id: `world:${key}`, machine: saved.id, variant: variant.id, count: 1, energy_hatch: types[0],
        transmit_eu_per_tick: variant.max_transfer_eu_per_tick, origins: [saved.origin],
        imported_hatches: hatches.map(part => ({id: part.id, origin: part.origin})),
        transmission_basis: 'Winding capacity target, not a saved operating rate. Support hatches may be resized.',
        operation_basis: candidate.assumption};
      if (saved.facts?.tesla_tower_upgrade_stack?.id) {
        pending('The saved Tesla upgrade needs a network and construction adapter before this tower can be included.'); continue;
      }
      candidate.configuration = selection;
      infrastructure.push(selection);
      continue;
    }
    if (!correction.recipe && saved.assignment_error) { pending(saved.assignment_error); continue; }
    if (!recipeId) { pending('No unique recipe assignment was saved or inferred.'); continue; }
    if (possible.length !== 1) { pending('The saved recipe does not identify one recipe in this dataset.'); continue; }
    const recipe = possible[0];
    const machine = machines.get(saved.id);
    if (!machine?.mechanic || machine.status !== 'supported' || recipe.unsupported) {
      pending(recipe.unsupported ?? 'The saved machine or recipe still needs a capacity adapter.'); continue;
    }
    try {
      const setup = {shape: saved.shape ?? 0, upgrade_count: saved.upgrades?.count ?? 0,
        ...(saved.contained_machine?.id ? {contained_machine: saved.contained_machine.id, contained_count: saved.contained_machine.count} : {}),
        ...(saved.casing?.id ? {casing: saved.casing.id} : {}), ...saved.saved_setup, ...correction.setup};
      if (saved.upgrades?.id && !setup.upgrade) {
        if (!upgrades.has(saved.upgrades.id)) throw new Error(`The saved upgrade is unknown: ${saved.upgrades.id}.`);
        setup.upgrade = upgrades.get(saved.upgrades.id);
      }
      if (machine.steel_hatch_variant && !Object.hasOwn(setup, 'steel_hatches')) throw new Error('The controller needs an associated hatch tier before its capacity can be established.');
      const configurationId = correction.configuration ?? (!correction.recipe ? saved.configuration_id : null);
      const fixed = recipe.configurations.filter(value => value.machine === machine.id
        && (!configurationId || value.id === configurationId)
        && (machine.mechanic !== 'irradiator' || value.startup_profile?.batch === setup.batch));
      const configuration = recipe.process ? compileConfiguration({...recipe, ...recipe.process}, machine, setup)
        : fixed.length === 1 ? fixed[0] : null;
      if (!configuration) throw new Error('Choose a unique machine configuration for this saved utility process.');
      const ingredientPins = {};
      if (saved.crafting_pattern && !saved.crafting_pattern.canSubstitute) {
        const stacks = saved.crafting_pattern.inputs.filter(stack => stack.id);
        if (stacks.some(stack => Object.keys(stack.components ?? {}).length)) throw new Error('The dedicated crafting pattern has component-specific inputs that need a matching adapter.');
        for (const [slot, flow] of recipe.inputs.entries()) {
          const matching = [...new Set(stacks.map(stack => `item:${stack.id}`).filter(id => (flow.choices ?? [flow.resource]).includes(id)))];
          if (matching.length !== 1) throw new Error('The dedicated crafting pattern needs an ingredient-choice correction.');
          ingredientPins[`${recipe.id}#${slot}`] = matching[0];
        }
      }
      assignments.push({machine: key, origin: saved.origin, recipe: recipe.id, configuration, setup,
        ingredient_pins: ingredientPins, obtained_resources: saved.obtained_resources ?? [],
        assignment_evidence: correction.recipe ? 'player_correction' : saved.assignment_evidence,
        capacity_basis: 'Configured capacity with continuous inputs, peak power, and accepted outputs; not an observed production rate.'});
    } catch (error) { pending(error.message); }
  }
  const recipes = new Map(dataset.recipes.map(value => [value.id, value]));
  const consumers = new Map();
  for (const assignment of assignments) {
    for (const flow of [...recipes.get(assignment.recipe).inputs, ...(assignment.configuration.inputs ?? []),
      ...(assignment.configuration.operating_points ?? []).flatMap(point => point.inputs ?? [])]) {
      for (const resource of flow.choices ?? [flow.resource]) {
        if (!consumers.has(resource)) consumers.set(resource, new Set());
        consumers.get(resource).add(assignment.recipe);
      }
    }
  }
  const goals = [], machineSetups = Object.create(null), grouped = new Map(), ingredients = Object.create(null), obtained = new Set();
  const goalCandidates = [];
  for (const assignment of assignments) {
    const recipe = recipes.get(assignment.recipe);
    const consumersOfPrimary = [...consumers.get(recipe.primary) ?? []].filter(id => id !== recipe.id);
    const correction = Object.hasOwn(corrections, assignment.machine) ? corrections[assignment.machine] : {};
    const retained = correction.goal ?? consumersOfPrimary.length === 0;
    goalCandidates.push({machine: assignment.machine, recipe: recipe.id, resource: recipe.primary, retained,
      consumers: consumersOfPrimary, evidence: Object.hasOwn(correction, 'goal') ? 'player_correction' : 'primary_output_dependency_inference',
      reason: retained ? 'Keep this configured output as an editable capacity target.' : 'Another assigned recipe consumes this primary output.'});
    for (const resource of assignment.obtained_resources) obtained.add(resource);
    if (!retained) continue;
    const conflict = Object.entries(assignment.ingredient_pins).find(([slot, resource]) => ingredients[slot] && ingredients[slot] !== resource);
    if (conflict) {
      unresolved.push({machine: assignment.machine, origin: assignment.origin, machine_id: assignment.configuration.machine,
        recipe_id: assignment.recipe, reason: 'Dedicated patterns use different fixed ingredients for the same recipe. This target needs a separate route or a corrected assignment.', ingredient_slot: conflict[0]});
      continue;
    }
    for (const [slot, resource] of Object.entries(assignment.ingredient_pins)) {
      ingredients[slot] = resource;
    }
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
    infrastructure, infrastructure_candidates: infrastructureCandidates, storage_units: storageUnits,
    ingredients, obtained_resources: [...obtained],
    stock_targets: (imported.requesters ?? []).flatMap(requester => requester.requests.map(value => ({...value, origin: requester.origin}))),
    inference: 'Primary outputs with no other assigned consumer become capacity goals. Shared-resource connectivity is inferred, not a recovered cable network. Byproduct retention and cycles may need correction.',
    bootstrap_verified: false};
}
