import {compileConfiguration} from './configuration.js';
import {structureContext, checkFixedStructure} from './structure_bill.js';
import {infrastructurePower} from './infrastructure.js';

function enabled(id, selected, disabled) {
  return (!selected || selected.includes(id)) && !disabled?.includes(id);
}

function own(record, key) { return record && Object.hasOwn(record, key) ? record[key] : undefined; }

function *concatenate(first, second) { yield* first; yield* second; }

function *setups(machine, upgrades, preserveCounts, process, materialCosts) {
  const loadouts = [{upgrade_count: 0}];
  const maximumBatch = Math.max(machine.batch_limit ?? 1, ...(machine.shape_capacities ?? []), ...(machine.batch_tiers ?? []).map(tier => tier.batch_limit));
  const multiplier = Math.max(machine.energy_multiplier ?? 1, ...(machine.batch_tiers ?? []).map(tier => tier.energy_multiplier));
  const totalEnergy = process.duration_ticks * process.eu_per_tick;
  const saturationBound = Math.max(totalEnergy, Math.trunc(Math.fround(Math.fround(totalEnergy * maximumBatch) * Math.fround(multiplier))));
  const compatible = upgrades.filter(upgrade => machine.upgrades?.includes(upgrade.id));
  for (const upgrade of compatible) {
    if (!materialCosts && !preserveCounts && machine.mechanic !== 'ae_molecular_assembler' && compatible.some(other => other !== upgrade &&
      other.extra_max_eu >= upgrade.extra_max_eu && (other.build_cost ?? 1) <= (upgrade.build_cost ?? 1) &&
      (other.extra_max_eu > upgrade.extra_max_eu || (other.build_cost ?? 1) < (upgrade.build_cost ?? 1)))) continue;
    for (let count = 1; count <= machine.upgrade_limit; count++) {
      // Once the upgrades alone cover every possible batch in one tick, further copies cannot help.
      if (!preserveCounts && upgrade.extra_max_eu > 0 && Number.isFinite(saturationBound) && count > Math.max(1, Math.ceil(saturationBound / upgrade.extra_max_eu))) break;
      loadouts.push({upgrade, upgrade_count: count});
    }
  }
  const shapes = Math.max(machine.batch_tiers?.length ?? 1, machine.recipe_eu_limits?.length ?? 1, machine.fluid_output_limits?.length ?? 1);
  for (const loadout of loadouts) {
    if (machine.mechanic === 'mi_array') {
      for (const contained_machine of machine.eligible_machines) {
        const maximum = Math.max(...machine.shape_capacities);
        for (let contained_count = 1; contained_count <= maximum; contained_count++) {
          const shape = machine.shape_capacities.findIndex(limit => limit >= contained_count);
          // A larger contained count costs more but cannot accelerate a smaller batch.
          const firstBatch = preserveCounts ? 1 : contained_count;
          for (let batch = firstBatch; batch <= contained_count; batch++) yield {...loadout, contained_machine, contained_count, batch, shape};
        }
      }
    } else {
      for (let shape = 0; shape < shapes; shape++) {
        for (let batch = 1; batch <= (machine.batch_tiers?.[shape].batch_limit ?? machine.batch_limit ?? 1); batch++) {
          yield {...loadout, batch, shape};
          if (machine.steel_hatch_variant) yield {...loadout, batch, shape, steel_hatches: true};
        }
      }
    }
  }
}

export function configureRecipe(recipe, dataset, request = {}, explicitOnly = false, checkBudget = () => {}, capacityCache, structures = structureContext(dataset), options = {}) {
  if ((recipe.requires_obtained ?? []).some(resource => !request.obtained_resources?.includes(resource))) return {...recipe, unsupported: 'This route requires an item the player has already obtained.'};
  if (!recipe.process || recipe.unsupported) {
    const rejected = new Set();
    const configurations = recipe.configurations.filter(value => enabled(value.machine, request.available_machines ?? dataset.default_machines, request.disabled_machines))
      .map(value => structuredClone(value)).filter(value => {
        try { checkFixedStructure(recipe, value, dataset, request, structures); return true; }
        catch (error) { rejected.add(error.message); return false; }
      });
    return {...recipe, configurations, configuration_diagnostics: [...rejected],
      ...(!configurations.length && !recipe.unsupported ? {unsupported: [...rejected].join(' ') || 'No available machine supports this recipe.'} : {})};
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
  const constrainedIds = new Set([request.installed, request.limits, request.dispatch].flatMap(value => Object.keys(value ?? {})));
  const preserveCounts = fixedIds.size > 0 || [...constrainedIds].some(id => id.startsWith(`${recipe.id}|`));
  const allowedConditions = new Set(['extended_industrialization:runtime_generated_flag', 'modern_industrialization:adjacent_block', 'modern_industrialization:dimension', 'modern_industrialization:biome', 'planner:energy_output_buffer']);
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
    for (const setup of concatenate(explicit, explicitOnly || fixedOnly ? [] : setups(matched, upgrades, preserveCounts, recipe.process, request.construction && !options.workstations))) {
      checkBudget();
      options.recordConfiguration?.();
      try {
        const configuration = compileConfiguration({...recipe, ...recipe.process}, matched, {...setup, compute_warmup: false}, capacityCache);
        configuration.assumptions = [...configuration.assumptions ?? [], ...recipe.assumptions ?? []];
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
        checkFixedStructure(recipe, configuration, dataset, request, structures);
        configurations.set(configuration.id, configuration);
      } catch (error) { rejected.add(error.message); }
    }
  }
  // Compare capacity only when operating inputs, conditions, and retained startup materials match.
  // Explicit setups remain available even when another configuration has a lower build cost.
  const explicitIds = new Set((own(request.machine_setups, recipe.id) ?? []).map(value => {
    const machine = machines.find(candidate => candidate.id === value.machine);
    if (!machine) throw new Error(`Unknown configured machine: ${value.machine}.`);
    return compileConfiguration({...recipe, ...recipe.process}, machine, value.setup).id;
  }));
  for (const goal of request.goals ?? []) if (goal.recipe === recipe.id && goal.configuration) explicitIds.add(goal.configuration);
  const pinned = own(request.configurations, recipe.id);
  for (const id of (Array.isArray(pinned) ? pinned : pinned ? [pinned] : [])) explicitIds.add(id);
  const comparable = new Map();
  for (const configuration of configurations.values()) {
    if (constrainedIds.has(configuration.id)) continue;
    const bill = request.construction && !options.workstations ? [...configuration.build_requirements ?? []].sort((a, b) => a.resource.localeCompare(b.resource)) : null;
    const key = JSON.stringify([configuration.eu_per_operation, configuration.inputs, configuration.operating_points, configuration.conditions, configuration.startup_inputs, bill,
      options.workstations ? configuration.structure?.status === 'unsupported' : null]);
    if (!comparable.has(key)) comparable.set(key, []);
    comparable.get(key).push(configuration);
  }
  const kept = new Map();
  for (const candidates of comparable.values()) {
    candidates.sort((a, b) => b.operations_per_second - a.operations_per_second || a.build_cost - b.build_cost);
    let cost = Infinity;
    for (const candidate of candidates) {
      if (candidate.build_cost < cost) { kept.set(candidate.id, candidate); cost = candidate.build_cost; }
    }
  }
  for (const id of constrainedIds) if (configurations.has(id)) kept.set(id, configurations.get(id));
  for (const id of explicitIds) if (configurations.has(id)) kept.set(id, configurations.get(id));
  return {...recipe, configurations: [...kept.values()], configuration_diagnostics: [...rejected],
    ...(!kept.size ? {unsupported: rejected.size ? [...rejected].join(' ') : 'No available machine supports this recipe.'} : {})};
}

export function prepareDataset(dataset, request, checkBudget = () => {}, options = {}) {
  if (!request.construction && !dataset.recipes.some(recipe => recipe.process) && !request.available_machines && !dataset.default_machines &&
    !dataset.machines?.some(machine => machine.shapes?.length)) return dataset;
  const producers = new Map();
  const capacityCache = new Map();
  const structures = structureContext(dataset);
  const selected = new Map();
  const needed = new Set((request.goals ?? []).map(goal => goal.resource));
  for (const recipe of dataset.recipes) {
    if (recipe.configurations?.some(configuration => (request.installed?.[configuration.id] ?? 0) > 0)) {
      for (const output of recipe.outputs) needed.add(output.resource);
    }
  }
  if (request.overhead_eu_per_tick || request.infrastructure?.some(value => value.count > 0)) needed.add('energy:eu');
  if (request.construction) for (const entry of infrastructurePower(dataset, request).entries) {
    for (const flow of entry.structure.build_requirements) needed.add(flow.resource);
  }
  const queue = [...needed];
  for (const recipe of dataset.recipes) {
    checkBudget();
    const inputs = [...recipe.inputs, ...recipe.configurations.flatMap(configuration => [
      ...(configuration.inputs ?? []), ...(configuration.operating_points ?? []).flatMap(point => point.inputs)])];
    for (const output of [...recipe.outputs, ...inputs.flatMap(flow => Object.values(flow.returns ?? {}).flat())]) {
      if (!producers.has(output.resource)) producers.set(output.resource, []);
      producers.get(output.resource).push(recipe);
    }
  }
  const addResource = resource => { if (!needed.has(resource)) { needed.add(resource); queue.push(resource); } };
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const recipe of producers.get(queue[cursor]) ?? []) {
      if (selected.has(recipe.id) || request.disabled_recipes?.includes(recipe.id) || (recipe.replication && !request.replication)) continue;
      checkBudget();
      const configured = configureRecipe(recipe, dataset, request, false, checkBudget, capacityCache, structures, options);
      selected.set(recipe.id, configured);
      if (configured.unsupported) continue;
      for (const flow of configured.inputs) for (const resource of flow.choices ?? [flow.resource]) addResource(resource);
      for (const configuration of configured.configurations) {
        if (request.construction) for (const flow of configuration.build_requirements ?? []) addResource(flow.resource);
        if (configuration.eu_per_operation || configuration.idle_eu_per_tick) addResource('energy:eu');
        for (const flow of [...(configuration.inputs ?? []), ...(configuration.operating_points ?? []).flatMap(point => point.inputs)]) {
          for (const resource of flow.choices ?? [flow.resource]) addResource(resource);
        }
      }
    }
  }
  return {...dataset, recipes: [...selected.values()]};
}
