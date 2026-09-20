import {compileConfiguration} from './configuration.js';

function enabled(id, selected, disabled) {
  return (!selected || selected.includes(id)) && !disabled?.includes(id);
}

function own(record, key) { return record && Object.hasOwn(record, key) ? record[key] : undefined; }

function *concatenate(first, second) { yield* first; yield* second; }

function *setups(machine, upgrades) {
  const loadouts = [{upgrade_count: 0}];
  for (const upgrade of upgrades) {
    if (!machine.upgrades?.includes(upgrade.id)) continue;
    for (let count = 1; count <= machine.upgrade_limit; count++) loadouts.push({upgrade, upgrade_count: count});
  }
  const shapes = Math.max(machine.recipe_eu_limits?.length ?? 1, machine.fluid_output_limits?.length ?? 1);
  for (const loadout of loadouts) {
    if (machine.mechanic === 'mi_array') {
      for (const contained_machine of machine.eligible_machines) {
        const maximum = Math.max(...machine.shape_capacities);
        for (let contained_count = 1; contained_count <= maximum; contained_count++) {
          const shape = machine.shape_capacities.findIndex(limit => limit >= contained_count);
          for (let batch = 1; batch <= contained_count; batch++) yield {...loadout, contained_machine, contained_count, batch, shape};
        }
      }
    } else {
      for (let shape = 0; shape < shapes; shape++) {
        for (let batch = 1; batch <= (machine.batch_limit ?? 1); batch++) {
          yield {...loadout, batch, shape};
          if (machine.steel_hatch_variant) yield {...loadout, batch, shape, steel_hatches: true};
        }
      }
    }
  }
}

export function configureRecipe(recipe, dataset, request = {}, explicitOnly = false) {
  if ((recipe.requires_obtained ?? []).some(resource => !request.obtained_resources?.includes(resource))) return {...recipe, unsupported: 'This route requires an item the player has already obtained.'};
  if (!recipe.process || recipe.unsupported) {
    const configurations = recipe.configurations.filter(value => enabled(value.machine, request.available_machines ?? dataset.default_machines, request.disabled_machines));
    return {...recipe, configurations, ...(!configurations.length && !recipe.unsupported ? {unsupported: 'No available machine supports this recipe.'} : {})};
  }
  const machines = dataset.machines ?? [];
  const upgrades = (dataset.upgrades ?? []).filter(upgrade => enabled(upgrade.id, request.available_upgrades ?? [], request.disabled_upgrades));
  const configurations = new Map();
  const rejected = new Set();
  const pinnedSelection = own(request.configurations, recipe.id);
  const fixedIds = new Set(Array.isArray(pinnedSelection) ? pinnedSelection : pinnedSelection ? [pinnedSelection] : []);
  for (const goal of request.goals ?? []) if (goal.recipe === recipe.id && goal.kind === 'capacity') fixedIds.add(goal.configuration);
  const explicitSetupIds = new Set();
  for (const value of own(request.machine_setups, recipe.id) ?? []) {
    const machine = machines.find(candidate => candidate.id === value.machine);
    if (machine) explicitSetupIds.add(compileConfiguration({...recipe, ...recipe.process}, machine, {...value.setup, compute_warmup: false}).id);
  }
  // A complete pinned setup leaves no loadout choice to search for this recipe.
  const fixedOnly = fixedIds.size > 0 && [...fixedIds].every(id => explicitSetupIds.has(id));
  const allowedConditions = new Set(['extended_industrialization:runtime_generated_flag', 'modern_industrialization:adjacent_block', 'modern_industrialization:dimension', 'modern_industrialization:biome']);
  for (const condition of recipe.conditions ?? []) {
    if (!allowedConditions.has(condition.type)) return {...recipe, unsupported: `No condition adapter exists for ${condition.type}.`};
    if (condition.dimension && request.available_dimensions && !request.available_dimensions.includes(condition.dimension)) return {...recipe, unsupported: `The required dimension is unavailable: ${condition.dimension}.`};
    if (condition.tag && request.available_biomes && !request.available_biomes.includes(condition.tag)) return {...recipe, unsupported: `The required biome tag is unavailable: ${condition.tag}.`};
  }
  for (const machine of machines) {
    if (machine.status !== 'supported' || !enabled(machine.id, request.available_machines ?? dataset.default_machines, request.disabled_machines)) continue;
    if (machine.recipe_type !== recipe.process.type && !Object.values(machine.contained_recipe_types ?? {}).includes(recipe.process.type)) continue;
    const matched = machine.mechanic === 'mi_array' ? {...machine, eligible_machines: machine.eligible_machines.filter(id => machine.contained_recipe_types[id] === recipe.process.type && enabled(id, request.available_machines ?? dataset.default_machines, request.disabled_machines))} : machine;
    const explicit = (own(request.machine_setups, recipe.id) ?? []).filter(value => value.machine === machine.id).map(value => value.setup);
    for (const setup of concatenate(explicit, explicitOnly || fixedOnly ? [] : setups(matched, upgrades))) {
      try {
        const configuration = compileConfiguration({...recipe, ...recipe.process}, matched, {...setup, compute_warmup: false});
        configuration.conditions = recipe.conditions ?? [];
        configuration.startup_inputs = [];
        for (const [index, catalyst] of (recipe.catalysts ?? []).entries()) {
          const chosen = own(request.catalysts, `${recipe.id}#${index}`) ?? (catalyst.choices.length === 1 ? catalyst.choices[0] : null);
          if (!chosen || !catalyst.choices.includes(chosen)) throw new Error(`Choose a reusable ingredient for catalyst slot ${index + 1}.`);
          configuration.startup_inputs.push({resource: chosen, amount: catalyst.amount * (setup.batch ?? setup.contained_count ?? 1)});
        }
        for (const condition of recipe.conditions ?? []) {
          if (condition.block) configuration.build_requirements.push({resource: `item:${condition.block}`, amount: 1});
        }
        configurations.set(configuration.id, configuration);
      } catch (error) { rejected.add(error.message); }
    }
  }
  // Identical rates and operating inputs leave the build objective as the only steady-state difference.
  // Explicit setups remain available even when another configuration has a lower build cost.
  const explicitIds = new Set((own(request.machine_setups, recipe.id) ?? []).map(value => {
    const machine = machines.find(candidate => candidate.id === value.machine);
    if (!machine) throw new Error(`Unknown configured machine: ${value.machine}.`);
    return compileConfiguration({...recipe, ...recipe.process}, machine, value.setup).id;
  }));
  for (const goal of request.goals ?? []) if (goal.recipe === recipe.id && goal.configuration) explicitIds.add(goal.configuration);
  const pinned = own(request.configurations, recipe.id);
  for (const id of (Array.isArray(pinned) ? pinned : pinned ? [pinned] : [])) explicitIds.add(id);
  const best = new Map();
  for (const configuration of configurations.values()) {
    const key = JSON.stringify([configuration.operations_per_second, configuration.eu_per_operation, configuration.inputs, configuration.conditions, configuration.startup_inputs]);
    if (!best.has(key) || best.get(key).build_cost > configuration.build_cost) best.set(key, configuration);
  }
  const kept = new Map([...best.values()].map(value => [value.id, value]));
  if ([request.installed, request.limits, request.dispatch].some(value => value && Object.keys(value).length)) {
    for (const configuration of configurations.values()) kept.set(configuration.id, configuration);
  }
  for (const id of explicitIds) if (configurations.has(id)) kept.set(id, configurations.get(id));
  return {...recipe, configurations: [...kept.values()], configuration_diagnostics: [...rejected],
    ...(!kept.size ? {unsupported: rejected.size ? [...rejected].join(' ') : 'No available machine supports this recipe.'} : {})};
}

export function prepareDataset(dataset, request) {
  if (!dataset.recipes.some(recipe => recipe.process) && !request.available_machines && !dataset.default_machines) return dataset;
  const producers = new Map();
  const selected = new Map();
  const needed = new Set((request.goals ?? []).map(goal => goal.resource));
  if (request.overhead_eu_per_tick) needed.add('energy:eu');
  const queue = [...needed];
  for (const recipe of dataset.recipes) {
    for (const output of [...recipe.outputs, ...recipe.inputs.flatMap(flow => Object.values(flow.returns ?? {}).flat())]) {
      if (!producers.has(output.resource)) producers.set(output.resource, []);
      producers.get(output.resource).push(recipe);
    }
  }
  const addResource = resource => { if (!needed.has(resource)) { needed.add(resource); queue.push(resource); } };
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const recipe of producers.get(queue[cursor]) ?? []) {
      if (selected.has(recipe.id) || request.disabled_recipes?.includes(recipe.id) || (recipe.replication && !request.replication)) continue;
      const pin = own(request.routes, recipe.primary);
      if (pin && pin !== recipe.id) continue;
      const configured = configureRecipe(recipe, dataset, request);
      selected.set(recipe.id, configured);
      if (configured.unsupported) continue;
      for (const flow of configured.inputs) for (const resource of flow.choices ?? [flow.resource]) addResource(resource);
      for (const configuration of configured.configurations) {
        if (configuration.eu_per_operation || configuration.idle_eu_per_tick) addResource('energy:eu');
        for (const flow of configuration.inputs ?? []) for (const resource of flow.choices ?? [flow.resource]) addResource(resource);
      }
    }
  }
  return {...dataset, recipes: [...selected.values()]};
}
