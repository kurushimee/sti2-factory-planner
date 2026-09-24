import {allocateFlows} from './flows.js';
import {generationSupport} from './power.js';
import {infrastructurePower} from './infrastructure.js';
import {resolveGoals} from './goals.js';
import {startupRequirements} from './startup.js';
import {prepareDataset} from './catalog.js';
import {validateDataset} from './validation.js';
import {attachStructureBills} from './structure_bill.js';
import {addConstruction, constructionBill, ConstructionBalanceError, decodeConstruction} from './construction.js';
import {productionRouteOwnership} from './route_ownership.js';
import {runSolver} from './solver.js';
import {findFactorySeed} from './seed.js';
import {refineMaterialPlan} from './material_refinement.js';
import {balanceTolerance, diagnosticNumber, scaleConstraintRows} from './numerics.js';
import {preferredRecipes, describePreferences, withRecipes} from './recipe_preferences.js';
import {appendPeriodicDispatch, decodePeriodicDispatch, expandPowerProfile, PeriodicBalanceError} from './periodic_model.js';
import {exactInstalledCapacity} from './exact_capacity.js';
import {recoverExactProduction} from './exact_recovery.js';
import * as Q from './rational.js';

const ENERGY = 'energy:eu';

function nonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${name} must be finite, nonnegative, and within the supported numeric range.`);
  }
  return value;
}

function expression(terms) {
  const values = [...terms].filter(([, coefficient]) => coefficient !== 0);
  return values.length ? values.map(([name, coefficient]) => `${coefficient < 0 ? '-' : '+'} ${Math.abs(coefficient)} ${name}`).join(' ') : '0 zero';
}

function add(terms, name, value) {
  terms.set(name, (terms.get(name) ?? 0) + value);
}

function own(record, key) {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

function combineFlows(flows) {
  const totals = new Map();
  for (const flow of flows) totals.set(flow.resource, (totals.get(flow.resource) ?? 0) + flow.rate);
  return [...totals].filter(([, rate]) => rate > 0).map(([resource, rate]) => ({resource, rate}));
}

export function compileFactory(dataset, request, routeChoices = {}) {
  if (dataset.format !== 1) throw new Error('Unsupported planning dataset version.');
  const resources = new Set(dataset.resources.map(resource => resource.id));
  if (resources.size !== dataset.resources.length) throw new Error('Duplicate resource IDs.');
  const rows = new Map([...resources].map(id => [id, new Map()]));
  const demands = new Map([...resources].map(id => [id, 0]));
  for (const goal of request.goals ?? []) {
    if (!resources.has(goal.resource)) throw new Error(`Unknown goal resource: ${goal.resource}.`);
    demands.set(goal.resource, demands.get(goal.resource) + nonnegative(goal.rate, 'Goal rate'));
  }
  const infrastructure = infrastructurePower(dataset, request);
  if (infrastructure.total_eu_per_tick) {
    if (!resources.has(ENERGY)) throw new Error('Infrastructure power needs an energy resource.');
    demands.set(ENERGY, demands.get(ENERGY) + infrastructure.total_eu_per_tick * 20);
  }
  const weights = {external: 1000, machines: 1, energy: 0.000001, ...request.weights};
  for (const [key, value] of Object.entries(weights)) nonnegative(value, `${key} priority`);
  if (!(weights.machines > 0)) throw new Error('The machine priority must be positive to exclude unused allocations.');
  const objective = new Map();
  const constraints = [];
  const bounds = ['zero = 0'];
  const integers = [];
  const lines = [];
  const exclusions = [];
  const periodicLines = [];
  const recipeIds = new Set();
  const routeCandidates = new Map();
  for (const recipe of dataset.recipes) {
    if (recipeIds.has(recipe.id)) throw new Error(`Duplicate recipe ID: ${recipe.id}.`);
    recipeIds.add(recipe.id);
    if (!resources.has(recipe.primary)) throw new Error(`Unknown primary output for ${recipe.id}.`);
    for (const flow of [...recipe.inputs, ...recipe.outputs]) {
      const choices = flow.choices ?? [flow.resource];
      if (!Array.isArray(choices) || !choices.length || new Set(choices).size !== choices.length) throw new Error(`Invalid ingredient alternatives in ${recipe.id}.`);
      for (const resource of choices) if (!resources.has(resource)) throw new Error(`Unknown resource ${resource} in ${recipe.id}.`);
      nonnegative(flow.amount, 'Recipe amount');
    }
    for (const output of recipe.outputs) if (!output.resource) throw new Error('Recipe outputs need a concrete resource.');
    const reason = recipe.unsupported ||
      ((recipe.requires_obtained ?? []).some(resource => !request.obtained_resources?.includes(resource)) ? 'This route requires an item the player has already obtained.' : '') ||
      (recipe.replication && !request.replication ? 'Replication is disabled.' : '') ||
      (request.disabled_recipes?.includes(recipe.id) ? 'The recipe is disabled.' : '');
    if (reason) {
      exclusions.push({recipe: recipe.id, reason});
      continue;
    }
    let hasConfiguration = false;
    for (const configuration of recipe.configurations) {
      if (request.disabled_machines?.includes(configuration.machine)) continue;
      if (request.construction) {
        const {error} = constructionBill(configuration, resources);
        if (error) { exclusions.push({recipe: recipe.id, configuration: configuration.id, reason: error}); continue; }
      }
      const configurations = own(request.configurations, recipe.id);
      if (configurations && !(Array.isArray(configurations) ? configurations : [configurations]).includes(configuration.id)) continue;
      const capacity = nonnegative(configuration.operations_per_second, 'Machine capacity');
      if (!capacity) throw new Error(`Zero capacity in ${configuration.id}.`);
      const energy = nonnegative(configuration.eu_per_operation ?? 0, 'Operation energy');
      const idle = nonnegative(configuration.idle_eu_per_tick ?? 0, 'Idle power');
      if ((energy || idle) && !resources.has(ENERGY)) throw new Error('Machine power needs an energy resource.');
      const index = lines.length;
      const operation = `x${index}`;
      const machine = `n${index}`;
      const buildCost = nonnegative(configuration.build_cost ?? 1, 'Build cost');
      if (!buildCost) throw new Error('Build costs must be positive.');
      add(objective, operation, weights.energy * energy);
      add(objective, machine, weights.machines * buildCost);
      constraints.push(`capacity_${index}: ${operation} - ${capacity} ${machine} <= 0`);
      if (own(routeChoices, recipe.id) === false) constraints.push(`excluded_route_${index}: ${operation} = 0`);
      bounds.push(`${operation} >= 0`, `${machine} >= 0`);
      integers.push(machine);
      const inputTerms = [], inputChecks = [];
      const allInputs = [...recipe.inputs, ...(configuration.inputs ?? [])].map(flow => ({flow, variable: operation}));
      if (configuration.operating_points) {
        const allocations = new Map([[machine, -1]]);
        const production = new Map([[operation, -1]]);
        for (const [pointIndex, point] of configuration.operating_points.entries()) {
          const variable = `p${index}_${pointIndex}`;
          bounds.push(`${variable} >= 0`);
          allocations.set(variable, 1);
          production.set(variable, point.operations_per_second);
          for (const flow of point.inputs) allInputs.push({flow, variable});
        }
        constraints.push(`operating_machines_${index}: ${expression(allocations)} = 0`);
        constraints.push(`operating_output_${index}: ${expression(production)} = 0`);
      }
      for (const [slot, {flow, variable: consumption}] of allInputs.entries()) {
        nonnegative(flow.amount, 'Configured input amount');
        for (const resource of flow.choices ?? [flow.resource]) if (!resources.has(resource)) throw new Error(`Unknown configured input ${resource}.`);
        const selected = own(request.ingredients, `${recipe.id}#${slot}`);
        if (selected && !(flow.choices ?? [flow.resource]).includes(selected)) throw new Error(`The pinned ingredient is unavailable in ${recipe.id}, slot ${slot + 1}.`);
        const choices = selected ? [selected] : flow.choices ?? [flow.resource];
        if (choices.length === 1) {
          add(rows.get(choices[0]), consumption, -flow.amount);
          inputTerms.push({resource: choices[0], variable: consumption, coefficient: flow.amount, slot});
        } else {
          const alternatives = new Map([[consumption, -flow.amount]]);
          choices.forEach((resource, choice) => {
            const variable = `a${index}_${slot}_${choice}`;
            alternatives.set(variable, 1);
            bounds.push(`${variable} >= 0`);
            add(rows.get(resource), variable, -1);
            inputTerms.push({resource, variable, coefficient: 1, slot});
          });
          constraints.push(`ingredient_${index}_${slot}: ${expression(alternatives)} = 0`);
          inputChecks.push({slot, terms: alternatives});
        }
      }
      const returnTerms = [];
      for (const term of inputTerms) {
        const returns = own(allInputs[term.slot].flow.returns, term.resource) ?? [];
        for (const returned of returns) {
          if (!resources.has(returned.resource) || returned.resource === ENERGY) throw new Error(`Invalid returned material in ${recipe.id}.`);
          nonnegative(returned.amount, 'Returned amount per input unit');
          const coefficient = term.coefficient * returned.amount;
          add(rows.get(returned.resource), term.variable, coefficient);
          returnTerms.push({resource: returned.resource, variable: term.variable, coefficient});
        }
      }
      for (const flow of recipe.outputs) add(rows.get(flow.resource), operation, flow.amount);
      if (energy) add(rows.get(ENERGY), operation, -energy);
      if (idle) add(rows.get(ENERGY), machine, -idle * 20);
      const installed = own(request.installed, configuration.id);
      if (installed !== undefined) {
        nonnegative(installed, 'Installed count');
        if (!Number.isInteger(installed)) throw new Error('Installed counts must be whole machines.');
        constraints.push(`installed_${index}: ${machine} = ${installed}`);
      }
      const limit = own(request.limits, configuration.id);
      if (limit !== undefined) {
        nonnegative(limit, 'Machine limit');
        if (!Number.isInteger(limit)) throw new Error('Machine limits must be whole numbers.');
        constraints.push(`limit_${index}: ${machine} <= ${limit}`);
      }
      const dispatch = own(request.dispatch, configuration.id);
      if (dispatch !== undefined) {
        if (dispatch.minimum !== undefined) constraints.push(`dispatch_min_${index}: ${operation} >= ${nonnegative(dispatch.minimum, 'Minimum operation rate')}`);
        if (dispatch.maximum !== undefined) constraints.push(`dispatch_max_${index}: ${operation} <= ${nonnegative(dispatch.maximum, 'Maximum operation rate')}`);
      }
      lines.push({recipe, configuration, operation, machine, inputTerms, inputChecks, returnTerms});
      if (configuration.periodic_generation) {
        if (configuration.operations_per_second !== 1 ||
            recipe.outputs.filter(flow => flow.resource === ENERGY).length !== 1) {
          throw new Error(`Periodic generation in ${configuration.id} needs one operation per machine per second and one energy output.`);
        }
        const profile = expandPowerProfile(configuration.periodic_generation);
        const average = profile.reduce((sum, value) => sum + value, 0) / profile.length;
        const gap = nonnegative(configuration.periodic_generation.one_event_loss_eu_per_period ?? 0,
          'Periodic event loss');
        const output = recipe.outputs.find(flow => flow.resource === ENERGY).amount;
        if (Math.abs(output / 20 - (average - gap / profile.length)) > Math.max(1e-9, average * 1e-9)) {
          throw new Error(`Periodic generation energy disagrees with the output in ${recipe.id}.`);
        }
        constraints.push(`periodic_machine_${index}: ${operation} - ${machine} = 0`);
        periodicLines.push({variable: machine, operation, output_eu_per_second: output, values: profile,
          recipe: recipe.id, configuration: configuration.id, machine: configuration.machine,
          one_event_loss_eu_per_period: gap,
          ...(configuration.periodic_generation.cell_cycle ? {cell_cycle: configuration.periodic_generation.cell_cycle} : {}),
          assumptions: configuration.periodic_generation.assumptions ?? []});
      }
      hasConfiguration = true;
    }
    if (hasConfiguration) {
      for (const resource of new Set(recipe.outputs.map(flow => flow.resource))) {
        if (!routeCandidates.has(resource)) routeCandidates.set(resource, []);
        routeCandidates.get(resource).push(recipe.id);
      }
    }
  }
  for (const [resource, recipeId] of Object.entries(request.routes ?? {})) {
    if (!routeCandidates.get(resource)?.includes(recipeId)) {
      const reason = exclusions.find(value => value.recipe === recipeId)?.reason;
      throw new Error(`Pinned route is unavailable: ${recipeId}.${reason ? ` ${reason}` : ''}`);
    }
  }
  for (const [recipe, minimum] of Object.entries(request.recipe_minimum_rates ?? {})) {
    const terms = new Map(lines.filter(line => line.recipe.id === recipe).map(line => [line.operation, 1]));
    if (!terms.size) {
      const reason = exclusions.find(value => value.recipe === recipe)?.reason;
      throw new Error(`Goal recipe is unavailable: ${recipe}.${reason ? ` ${reason}` : ''}`);
    }
    constraints.push(`recipe_goal_${constraints.length}: ${expression(terms)} >= ${nonnegative(minimum, 'Recipe goal operation rate')}`);
  }
  const supplies = [];
  for (const supply of request.external ?? []) {
    if (!resources.has(supply.resource)) throw new Error(`Unknown external resource: ${supply.resource}.`);
    const name = `s${supplies.length}`;
    add(rows.get(supply.resource), name, 1);
    add(objective, name, weights.external * nonnegative(supply.cost ?? 1, 'External supply cost'));
    bounds.push(`${name} >= 0`);
    if (supply.limit !== undefined) bounds.push(`${name} <= ${nonnegative(supply.limit, 'External supply limit')}`);
    supplies.push({...supply, name});
  }
  const reserve = nonnegative(request.reserve_fraction ?? 0, 'Generation reserve');
  if (reserve) {
    if (!resources.has(ENERGY)) throw new Error('Generation reserve needs an energy resource.');
    const terms = new Map();
    for (const line of lines) {
      const output = line.recipe.outputs.filter(flow => flow.resource === ENERGY).reduce((sum, flow) => sum + flow.amount, 0);
      add(terms, line.machine, output * line.configuration.operations_per_second - (1 + reserve) * (line.configuration.idle_eu_per_tick ?? 0) * 20);
      add(terms, line.operation, -(1 + reserve) * (line.configuration.eu_per_operation ?? 0));
      for (const input of line.inputTerms) if (input.resource === ENERGY) add(terms, input.variable, -(1 + reserve) * input.coefficient);
    }
    const firmExternal = supplies.filter(supply => supply.resource === ENERGY).reduce((sum, supply) => sum + nonnegative(supply.firm_capacity ?? 0, 'Firm external power capacity'), 0);
    constraints.push(`generation_reserve: ${expression(terms)} >= ${(1 + reserve) * demands.get(ENERGY) - firmExternal}`);
  }
  let index = 0;
  for (const [resource, terms] of rows) {
    constraints.push(`balance_${index++}: ${expression(terms)} >= ${demands.get(resource)}`);
  }
  let periodic = null;
  const selectedStorage = [];
  if (periodicLines.length) {
    if (!Array.isArray(request.periodic_storage ?? [])) throw new Error('Periodic storage selections must be a list.');
    const firm = new Map(rows.get(ENERGY));
    for (const line of periodicLines) add(firm, line.operation, -line.output_eu_per_second);
    if (reserve) for (const line of lines) {
      add(firm, line.operation, -reserve * (line.configuration.eu_per_operation ?? 0));
      add(firm, line.machine, -reserve * (line.configuration.idle_eu_per_tick ?? 0) * 20);
      for (const input of line.inputTerms) if (input.resource === ENERGY) {
        add(firm, input.variable, -reserve * input.coefficient);
      }
    }
    for (const id of request.periodic_storage ?? []) {
      const machine = dataset.machines?.find(candidate => candidate.id === id);
      if (machine?.mechanic !== 'energy_storage' || machine.status !== 'infrastructure') {
        throw new Error(`Periodic storage is unavailable: ${id}.`);
      }
      if (request.disabled_machines?.includes(id) ||
          request.available_machines && !request.available_machines.includes(id)) {
        throw new Error(`Periodic storage is disabled: ${id}.`);
      }
      if (selectedStorage.some(unit => unit.id === id)) throw new Error(`Periodic storage is selected twice: ${id}.`);
      selectedStorage.push({id, variable: `periodic_storage_${selectedStorage.length}`,
        resource: `item:${id}`, ...machine.storage,
        build_cost: weights.machines * nonnegative(machine.build_cost ?? 1, 'Storage build cost'),
        ...((own(request.periodic_storage_limits, id) !== undefined) ?
          {max_count: own(request.periodic_storage_limits, id)} : {}),
        ...((own(request.periodic_storage_installed, id) !== undefined) ?
          {installed_count: own(request.periodic_storage_installed, id)} : {})});
    }
    periodic = appendPeriodicDispatch({objective, constraints, bounds, integers}, {
      profiles: periodicLines, firm_terms: firm, demand_eu_per_tick: demands.get(ENERGY) * (1 + reserve) / 20,
      storage: selectedStorage});
  }
  const fixed_builds = request.construction ? infrastructure.entries.map((entry, index) => {
    const variable = `ib${index}`;
    bounds.push(`${variable} = ${entry.count}`);
    return {machine: variable, configuration: {structure: entry.structure, build_requirements: entry.structure.build_requirements}};
  }) : [];
  if (request.construction) for (const unit of selectedStorage) {
    if (!resources.has(unit.resource)) throw new Error(`Storage construction item is missing: ${unit.resource}.`);
    fixed_builds.push({machine: unit.variable, configuration: {build_requirements: [{resource: unit.resource, amount: 1}]}});
  }
  const construction = addConstruction({lines, fixed_builds, objective, constraints, bounds, integers}, resources, request,
    new Map(dataset.resources.map(resource => [resource.id, resource])));
  for (const route of construction?.routes ?? []) if (own(routeChoices, route.recipe) === false) {
    constraints.push(`excluded_construction_${route.variable}: ${route.variable} = 0`);
  }
  const text = ['Minimize', `cost: ${expression(objective)}`, 'Subject To', ...constraints,
    'Bounds', ...bounds, ...(integers.length ? ['Generals', integers.join(' ')] : []), 'End'].join('\n');
  return {text, lines, supplies, rows, demands, routeCandidates, exclusions, reserve, construction, integers, request,
    infrastructure, periodic: periodic && {...periodic, lines: periodicLines, storage: selectedStorage}};
}

export class FactoryBalanceError extends Error {
  constructor(resource, demand, net, tolerance, magnitude, terms, value) {
    super(`The numerical solution failed the resource balance check for ${resource}: deficit ${diagnosticNumber(demand - net)}, tolerance ${diagnosticNumber(tolerance)}.`);
    this.balance = {resource, demand, net, tolerance, magnitude, terms: [...terms]
      .map(([variable, coefficient]) => ({variable, coefficient, value: value(variable)})).filter(term => term.value !== 0)};
  }
}

export function decodeFactory(model, solution) {
  const value = name => solution.Columns[name]?.Primal ?? 0;
  for (const variable of model.integers) {
    const amount = value(variable);
    if (!Number.isSafeInteger(Math.round(amount)) || Math.abs(amount - Math.round(amount)) > 1e-6) {
      throw new Error(`The solver returned a non-integral build or batch quantity: ${variable}.`);
    }
  }
  for (const line of model.lines) {
    for (const {slot, terms} of line.inputChecks ?? []) {
      let residual = 0, magnitude = 0;
      for (const [variable, coefficient] of terms) {
        const amount = coefficient * value(variable);
        residual += amount;
        magnitude += Math.abs(amount);
      }
      const tolerance = balanceTolerance(magnitude);
      if (Math.abs(residual) > tolerance) throw new FactoryBalanceError(`${line.recipe.id}, ingredient ${slot + 1}`,
        Math.abs(residual), 0, tolerance, magnitude, terms, value);
    }
    const count = value(line.machine);
    if (!Number.isSafeInteger(Math.round(count)) || Math.abs(count - Math.round(count)) > 1e-6) {
      throw new Error(`The solver returned a non-integral machine count for ${line.configuration.id}.`);
    }
    const capacity = Math.round(count) * line.configuration.operations_per_second;
    const tolerance = capacity > 0 ? balanceTolerance(Math.abs(capacity)) : 0;
    if (value(line.operation) > capacity + tolerance) {
      throw new FactoryBalanceError(`machine capacity for ${line.configuration.id}`, value(line.operation), capacity,
        tolerance, capacity, new Map([[line.operation, 1], [line.machine, -line.configuration.operations_per_second]]), value);
    }
  }
  const lines = model.lines.filter(line => value(line.machine) > 0.5).map(line => ({
    recipe: line.recipe.id,
    primary: line.recipe.primary,
    configuration: line.configuration.id,
    machine: line.configuration.machine,
    machines: Math.round(value(line.machine)),
    operations_per_second: value(line.operation),
    capacity_per_second: Math.round(value(line.machine)) * line.configuration.operations_per_second,
    capacity_per_second_exact: exactInstalledCapacity(line.configuration, Math.round(value(line.machine))),
    utilization: value(line.operation) / (Math.round(value(line.machine)) * line.configuration.operations_per_second),
    inputs: combineFlows(line.inputTerms.map(term => ({resource: term.resource, rate: term.coefficient * value(term.variable)}))),
    ingredient_choices: line.inputTerms.map(term => ({resource: term.resource, rate: term.coefficient * value(term.variable), slot: term.slot})).filter(flow => flow.rate > 0),
    outputs: combineFlows([...line.recipe.outputs.map(flow => ({resource: flow.resource, rate: flow.amount * value(line.operation)})),
      ...line.returnTerms.map(term => ({resource: term.resource, rate: term.coefficient * value(term.variable)}))]),
    power_eu_per_tick: value(line.operation) * (line.configuration.eu_per_operation ?? 0) / 20 + Math.round(value(line.machine)) * (line.configuration.idle_eu_per_tick ?? 0),
    generation_capacity_eu_per_tick: line.recipe.outputs.filter(flow => flow.resource === ENERGY).reduce((sum, flow) => sum + flow.amount, 0) * Math.round(value(line.machine)) * line.configuration.operations_per_second / 20,
    configuration_details: line.configuration,
  }));
  const balances = [];
  for (const [resource, terms] of model.rows) {
    let net = 0;
    let magnitude = 0;
    for (const [name, coefficient] of terms) {
      net += value(name) * coefficient;
      magnitude += Math.abs(value(name) * coefficient);
    }
    const demand = model.demands.get(resource);
    const tolerance = balanceTolerance(Math.max(magnitude, Math.abs(demand)));
    if (net < demand - tolerance) {
      throw new FactoryBalanceError(resource, demand, net, tolerance, magnitude, terms, value);
    }
    balances.push({resource, demand, net, surplus: net - demand, numerical_tolerance: tolerance});
  }
  const external = model.supplies.map(supply => ({resource: supply.resource, rate: value(supply.name)}));
  const gross = lines.reduce((sum, line) => sum + line.outputs.filter(flow => flow.resource === ENERGY).reduce((amount, flow) => amount + flow.rate / 20, 0), 0);
  const generationCapacity = lines.reduce((sum, line) => sum + line.generation_capacity_eu_per_tick, 0);
  const consumption = lines.reduce((sum, line) => sum + line.power_eu_per_tick + line.inputs.filter(flow => flow.resource === ENERGY).reduce((amount, flow) => amount + flow.rate / 20, 0), 0);
  const demand = (model.demands.get(ENERGY) ?? 0) / 20;
  const externalPower = external.filter(supply => supply.resource === ENERGY).reduce((sum, supply) => sum + supply.rate / 20, 0);
  const firmExternal = model.supplies.filter(supply => supply.resource === ENERGY).reduce((sum, supply) => sum + (supply.firm_capacity ?? 0) / 20, 0);
  const reserveRequired = (1 + model.reserve) * (consumption + demand);
  if (model.reserve && generationCapacity + firmExternal < reserveRequired - Math.max(1e-7, reserveRequired * Number.EPSILON * 16)) throw new Error('The numerical solution failed the generation reserve check.');
  const flows = allocateFlows(lines, external, model.demands);
  const attribution = generationSupport(lines, flows.connections);
  const power = {...attribution, infrastructure: model.infrastructure, gross_generation_eu_per_tick: gross, installed_generation_eu_per_tick: generationCapacity,
    net_generation_eu_per_tick: gross - attribution.generation_related_consumption_eu_per_tick,
    consumption_eu_per_tick: consumption, infrastructure_and_goal_eu_per_tick: demand,
    external_eu_per_tick: externalPower, operating_margin_eu_per_tick: gross + externalPower - consumption - demand,
    installed_margin_eu_per_tick: generationCapacity + firmExternal - consumption - demand, reserve_fraction: model.reserve,
    reserve_basis: 'Installed generation capacity. Standby fuel and bootstrap stocks are separate requirements.'};
  const construction = decodeConstruction(model.construction, value);
  const periodic = decodePeriodicDispatch(model.periodic, value);
  const startup = startupRequirements(lines);
  if (periodic) {
    power.periodic = periodic;
    startup.energy_storage_initial_charge_eu = periodic.storage.reduce((sum, unit) => sum + unit.initial_charge_eu, 0);
  }
  const result = {lines, balances, power, startup, steady_state_only: true, external,
    ...(construction ? {construction} : {}), ...(periodic ? {periodic_power: periodic} : {}), ...flows};
  if (model.request.exact_production) {
    try {
      const exact = recoverExactProduction(model, solution, result);
      const quantity = record => {
        const rate = Q.ratio(BigInt(record.numerator), BigInt(record.denominator));
        const numeric = Q.number(rate);
        if (!Number.isFinite(numeric) || rate.n !== 0n && numeric === 0) {
          throw new Error('An exact positive flow is outside the graph numeric range.');
        }
        return numeric;
      };
      const perTick = record => Q.record(Q.divide(Q.ratio(BigInt(record.numerator), BigInt(record.denominator)), Q.decimal(20)));
      const matched = new Map(exact.lines.map(line => [line.configuration, line]));
      for (const line of result.lines) {
        const source = matched.get(line.configuration);
        if (!source) continue;
        line.operations_per_second = quantity(source.operations_per_second);
        line.operations_per_second_exact = source.operations_per_second;
        line.inputs = source.inputs.map(flow => ({resource: flow.resource, rate: quantity(flow.rate), rate_exact: flow.rate,
          ...(flow.resource === ENERGY ? {rate_eu_per_tick_exact: perTick(flow.rate)} : {})}));
        line.outputs = source.outputs.map(flow => ({resource: flow.resource, rate: quantity(flow.rate), rate_exact: flow.rate,
          ...(flow.resource === ENERGY ? {rate_eu_per_tick_exact: perTick(flow.rate)} : {})}));
        line.power_eu_per_tick = quantity(source.power_eu_per_second) / 20;
        line.power_eu_per_second_exact = source.power_eu_per_second;
        line.power_eu_per_tick_exact = perTick(source.power_eu_per_second);
        line.utilization = line.operations_per_second / line.capacity_per_second;
        let capacity = line.capacity_per_second_exact;
        if (!capacity && Number.isSafeInteger(line.configuration_details.operations_per_second)) {
          capacity = Q.record(Q.multiply(Q.decimal(line.machines), Q.decimal(line.configuration_details.operations_per_second)));
          line.capacity_per_second_exact = capacity;
        }
        if (capacity) {
          const utilization = Q.divide(Q.ratio(BigInt(source.operations_per_second.numerator), BigInt(source.operations_per_second.denominator)),
            Q.ratio(BigInt(capacity.numerator), BigInt(capacity.denominator)));
          line.utilization_exact = Q.record(utilization);
          line.utilization_percent_exact = Q.record(Q.multiply(utilization, Q.decimal(100)));
        }
      }
      result.balances = exact.balances.map(balance => ({resource: balance.resource,
        demand: quantity(balance.demand), net: quantity(balance.net), surplus: quantity(balance.surplus),
        demand_exact: balance.demand, net_exact: balance.net, surplus_exact: balance.surplus,
        numerical_tolerance: 0}));
      result.external = exact.external.map(flow => ({resource: flow.resource, rate: quantity(flow.rate), rate_exact: flow.rate}));
      result.connections = exact.connections.map(flow => ({source: flow.source, destination: flow.destination,
        resource: flow.resource, rate: quantity(flow.rate), rate_exact: flow.rate,
        ...(flow.resource === ENERGY ? {rate_eu_per_tick_exact: perTick(flow.rate)} : {})}));
      result.retained = exact.retained.map(flow => ({resource: flow.resource, source: flow.source,
        rate: quantity(flow.rate), rate_exact: flow.rate}));
      result.flow_roundoff = [];
      result.flow_roundoff_links = [];
      const attribution = generationSupport(result.lines, result.connections);
      const gross = result.lines.reduce((sum, line) => sum + line.outputs.filter(flow => flow.resource === ENERGY)
        .reduce((amount, flow) => amount + flow.rate / 20, 0), 0);
      const consumption = result.lines.reduce((sum, line) => sum + line.power_eu_per_tick + line.inputs
        .filter(flow => flow.resource === ENERGY).reduce((amount, flow) => amount + flow.rate / 20, 0), 0);
      const externalPower = result.external.filter(flow => flow.resource === ENERGY)
        .reduce((sum, flow) => sum + flow.rate / 20, 0);
      result.power = {...result.power, ...attribution, gross_generation_eu_per_tick: gross,
        net_generation_eu_per_tick: gross - attribution.generation_related_consumption_eu_per_tick,
        consumption_eu_per_tick: consumption, external_eu_per_tick: externalPower,
        operating_margin_eu_per_tick: gross + externalPower - consumption - demand};
      for (const [field, amount] of Object.entries(exact.power)) {
        result.power[field] = quantity(amount);
        result.power[`${field}_exact`] = amount;
      }
      result.startup = {resources: [], build_requirements: [], incomplete: [],
        preview_omitted: true, method: 'Warm-up stock requirements are not included in this production preview.'};
      result.exact_production = {status: 'exact', ...exact};
    }
    catch (error) {result.exact_production = {status: 'unavailable', reason: error.message};}
  }
  let peak = Q.ZERO;
  let missingPeaks = 0;
  for (const line of result.lines) {
    const rating = line.configuration_details?.capacity?.peak_eu_per_tick;
    if (rating == null) {
      if (line.power_eu_per_tick > 0) missingPeaks++;
      continue;
    }
    peak = Q.add(peak, Q.multiply(Q.decimal(rating), Q.decimal(line.machines)));
  }
  result.power.production_peak_eu_per_tick = Q.number(peak);
  result.power.production_peak_eu_per_tick_exact = Q.record(peak);
  result.power.production_peak_missing_lines = missingPeaks;
  return result;
}

export function solveFactory(highs, dataset, request, onProgress = () => {}) {
  const duration = nonnegative(request.time_limit_ms ?? (request.construction ? 180000 : 60000), 'Calculation time limit');
  const deadline = Date.now() + duration;
  validateDataset(dataset);
  infrastructurePower(dataset, request);
  const exhausted = new Error('The configuration search reached its time limit.');
  const refine = new Error('Compare large construction orders separately.');
  const source = dataset;
  if (source.recipes.length > 2000 && (request.available_machines?.length ?? 0) > 70 &&
      request.production_only && request.exact_production &&
      !request.full_catalog_search && !request.construction) {
    return solveStagedProduction(highs, source, request, deadline, exhausted, onProgress);
  }
  let configurations = 0;
  try {
    dataset = prepareDataset(dataset, request, () => { if (Date.now() >= deadline) throw exhausted; },
      {recordConfiguration: () => {if (request.construction && ++configurations > 5000) throw refine;}});
    if (request.construction && dataset.recipes.reduce((sum, recipe) => sum + recipe.configurations.length, 0) > 2000) throw refine;
  } catch (error) {
    if (error === refine) return refineMaterialPlan(highs, source, request,
      (data, selection) => solveFactory(highs, data, selection, onProgress), deadline, onProgress);
    if (error !== exhausted) throw error;
    return {status: 'limit', phase: 'configuration', optimal: false, incumbent: null, branches: 0};
  }
  return solveWithPreferences(highs, dataset, request, deadline, onProgress);
}

function solveWithPreferences(highs, dataset, request, deadline, onProgress) {
  const preferred = preferredRecipes(dataset, request);
  if (preferred.applied.length) {
    const firstDeadline = Date.now() + Math.max(0, deadline - Date.now()) * 0.9;
    const first = solvePreparedFactory(highs, preferred.dataset, request, firstDeadline, onProgress);
    if (first.lines) return describePreferences(first, preferred.applied);
    onProgress({phase: 'route_preference_fallback'});
    const fallback = solvePreparedFactory(highs, dataset, request, deadline, onProgress);
    if (fallback.lines && first.status !== 'infeasible') {
      fallback.status = 'feasible';
      fallback.optimal = false;
      fallback.optimization = {...fallback.optimization, lower_bound: null, relative_gap: null,
        explanation: 'The fallback plan is verified, but the preferred equivalent-material routes were not established within the search.'};
    }
    return describePreferences(fallback, preferred.applied, true);
  }
  return solvePreparedFactory(highs, dataset, request, deadline, onProgress);
}

function solveStagedProduction(highs, source, request, deadline, exhausted, onProgress) {
  let seedDataset;
  try {
    seedDataset = prepareDataset(source, request, () => {if (Date.now() >= deadline) throw exhausted;},
      {seedOnly: true});
  } catch (error) {
    if (error !== exhausted) throw error;
    return {status: 'limit', phase: 'configuration', optimal: false, incumbent: null, branches: 0};
  }
  onProgress({phase: 'catalog_support', recipes: seedDataset.recipes.length});
  const seedModel = compileFactory(seedDataset, request);
  const relaxed = highs.createModel({format: 'lp', data: seedModel.text.replace(/\nGenerals\n[^]*?\nEnd$/, '\nEnd')});
  let selectedIds;
  const ingredientScores = new Map();
  const equivalentIngredients = new Map();
  try {
    relaxed.options.set({output_flag: false, time_limit: Math.max(0.001, (deadline - Date.now()) / 1000)});
    relaxed.run();
    const status = relaxed.getModelStatus();
    if (status !== highs.constants.modelStatus.optimal) {
      if (status !== highs.constants.modelStatus.infeasible) {
        return {status: 'limit', optimal: false, phase: 'catalog_support',
          reason: 'The catalog support search did not finish within its calculation limit.'};
      }
      const unavailable = new Set(seedModel.exclusions.map(entry => entry.recipe));
      const blocked = seedDataset.recipes.filter(recipe => unavailable.has(recipe.id));
      const siteRoutes = blocked.filter(recipe => (recipe.requires_obtained ?? [])
        .some(resource => resource.startsWith('site:')));
      const missing = [...new Set((siteRoutes.length ? siteRoutes : blocked)
        .flatMap(recipe => recipe.requires_obtained ?? [])
        .filter(resource => !request.obtained_resources?.includes(resource)))].sort((a, b) =>
        Number(b.startsWith('site:')) - Number(a.startsWith('site:')) || a.localeCompare(b));
      const names = new Map(source.resources.map(resource => [resource.id, resource.name ?? resource.id]));
      return {status: 'unresolved', optimal: false, phase: 'catalog_support',
        reason: 'The available configurations did not establish a production route.' + (missing.length ?
          ` Unavailable source routes require previously obtained resources, including ${missing.slice(0, 3)
            .map(resource => names.get(resource)).join(', ')}. Mark only resources you own as obtained in Factory settings.` : ''),
        exclusions: seedModel.exclusions};
    }
    const values = relaxed.getSolution().colValue;
    const reducedCosts = relaxed.getSolution().colDual;
    const activeLines = seedModel.lines.filter(line => values[relaxed.getColByName(line.operation)] > 0);
    selectedIds = new Set(activeLines.map(line => line.recipe.id));
    const activeSupplies = new Set([...activeLines.flatMap(line => line.recipe.outputs.map(output => output.resource)),
      ...(request.external ?? []).map(supply => supply.resource)]);
    for (const line of seedModel.lines) {
      if (values[relaxed.getColByName(line.operation)] <= 0) continue;
      for (const check of line.inputChecks) {
        const key = `${line.recipe.id}#${check.slot}`;
        const terms = line.inputTerms.filter(value => value.slot === check.slot);
        for (const term of terms) {
          if (!ingredientScores.has(key)) ingredientScores.set(key, new Map());
          const score = values[relaxed.getColByName(term.variable)];
          ingredientScores.get(key).set(term.resource, (ingredientScores.get(key).get(term.resource) ?? 0) + score);
        }
        const equal = terms.filter(term => activeSupplies.has(term.resource) &&
          Math.abs(reducedCosts[relaxed.getColByName(term.variable)]) <= 1e-9)
          .map(term => term.resource).sort((a, b) => a.length - b.length || a.localeCompare(b));
        if (equal.length) {
          const prior = equivalentIngredients.get(key);
          if (!prior || equal[0].length < prior.length || (equal[0].length === prior.length && equal[0] < prior))
            equivalentIngredients.set(key, equal[0]);
        }
      }
    }
  } finally { relaxed.dispose(); }
  const chosenIngredients = {};
  for (const [key, scores] of ingredientScores) if (!Object.hasOwn(request.ingredients ?? {}, key)) {
    chosenIngredients[key] = equivalentIngredients.get(key) ??
      [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  }
  const selectedRequest = {...request, ingredients: {...request.ingredients, ...chosenIngredients},
    remove_unused_seed_machines: true};
  for (const goal of request.goals ?? []) if (goal.recipe) selectedIds.add(goal.recipe);
  for (const recipe of Object.values(request.routes ?? {})) selectedIds.add(recipe);
  const seedSelected = withRecipes(seedDataset, seedDataset.recipes.filter(recipe => selectedIds.has(recipe.id)));
  const selected = withRecipes(source, source.recipes.filter(recipe => selectedIds.has(recipe.id)));
  const scoped = (result, seedOnly = false) => ({...result, status: 'feasible', optimal: false,
    search: {...result.search, method: seedOnly ? 'catalog_seed_plan' : 'catalog_seed_refinement', selected_recipes: selectedIds.size,
      automatic_ingredients: chosenIngredients},
    optimization: {...result.optimization, lower_bound: null, relative_gap: null,
      explanation: 'The production rates and material balances are exact. The preview searched recipes selected by a catalog-wide relaxation; it has not proved the lowest route or machine cost.'}});
  if (Date.now() >= deadline) return {status: 'limit', phase: 'catalog_support', optimal: false};
  onProgress({phase: 'catalog_refinement', recipes: selectedIds.size});
  let refined;
  try {
    const refinedDataset = prepareDataset(selected, selectedRequest, () => {if (Date.now() >= deadline) throw exhausted;});
    const refinedDeadline = Date.now() + Math.max(0, deadline - Date.now()) * 0.7;
    refined = solveWithPreferences(highs, refinedDataset, selectedRequest, refinedDeadline, onProgress);
    if (refined.lines) return scoped(refined);
  } catch (error) {
    if (error !== exhausted) throw error;
    refined = {status: 'limit', phase: 'catalog_refinement', optimal: false};
  }
  if (Date.now() >= deadline) return refined;
  onProgress({phase: 'catalog_seed_plan', recipes: selectedIds.size});
  const baseline = solveWithPreferences(highs, seedSelected,
    {...selectedRequest, honor_route_preferences: false}, deadline, onProgress);
  if (baseline.lines) return scoped(baseline, true);
  const fallback = solveProgressionFallback(highs, source, request, deadline, exhausted, onProgress);
  return fallback?.lines ? fallback : refined;
}

function solveProgressionFallback(highs, source, request, deadline, exhausted, onProgress) {
  if (Object.keys(request.configurations ?? {}).length || Object.keys(request.installed ?? {}).length) return null;
  const preset = (source.progression ?? []).filter(stage => stage.available_machines?.length >= 20 &&
    stage.available_machines.length <= 50).map(stage => ({...stage,
      allowed: stage.available_machines.filter(machine => request.available_machines.includes(machine))}))
    .filter(stage => stage.allowed.length >= 20)
    .sort((a, b) => b.allowed.length - a.allowed.length)[0];
  if (!preset) return null;
  onProgress({phase: 'progression_fallback', preset: preset.name ?? preset.id});
  const reduced = {...request, available_machines: preset.allowed, full_catalog_search: true};
  let prepared;
  try {
    prepared = prepareDataset(source, reduced, () => {if (Date.now() >= deadline) throw exhausted;});
  } catch (error) {
    if (error !== exhausted) throw error;
    return null;
  }
  if (request.goals?.some(goal => goal.recipe && !prepared.recipes.some(recipe =>
    recipe.id === goal.recipe && recipe.configurations.length))) return null;
  const result = solveWithPreferences(highs, prepared, reduced, deadline, onProgress);
  if (!result.lines) return null;
  return {...result, status: 'feasible', optimal: false,
    search: {...result.search, method: 'catalog_progression_fallback', progression: preset.id},
    optimization: {...result.optimization, lower_bound: null, relative_gap: null,
      explanation: 'The production rates and balances are exact. A smaller available-machine set established this plan; other enabled machines may yield a lower cost.'}};
}

function solvePreparedFactory(highs, dataset, request, deadline, onProgress) {
  const resolved = resolveGoals(dataset, request);
  request = resolved.request;
  const branches = [{}];
  const recipes = new Map(dataset.recipes.map(recipe => [recipe.id, recipe]));
  let best = null, lowerBound = null, completeSearch = true;
  let visited = 0, numericalRetries = 0, periodicRetries = 0;
  let lastExclusions = [];
  const finish = (status) => {
    if (!best) return {status, optimal: false, exclusions: lastExclusions, branches: visited};
    attachStructureBills(best, dataset, {allowed_parts: request.available_parts});
    if (best.exact_production?.status !== 'exact') best.startup = startupRequirements(best.lines);
    if (best.periodic_power) best.startup.energy_storage_initial_charge_eu =
      best.periodic_power.storage.reduce((sum, unit) => sum + unit.initial_charge_eu, 0);
    const proven = status === 'optimal' && completeSearch;
    return {...best, status: proven ? 'optimal' : 'feasible', optimal: proven, branches: visited,
      optimization: {lower_bound: lowerBound, objective: best.objective,
        relative_gap: proven ? 0 : lowerBound === null ? null : Math.max(0, (best.objective - lowerBound) / Math.max(1e-12, Math.abs(best.objective))),
        explanation: proven ? 'The complete search proved this objective.' : 'This plan meets its goals. The search has not proved the lowest cost.'}};
  };
  while (branches.length) {
    if (Date.now() >= deadline) return finish('limit');
    const choices = branches.pop();
    const model = compileFactory(dataset, request, choices);
    if (Date.now() >= deadline) return finish('limit');
    lastExclusions = model.exclusions;
    if (!visited && model.lines.length > 2000 && !request.construction) {
      const seed = findFactorySeed(highs, model, request, deadline, candidate => {
        try {
          const decoded = decodeFactory(model, candidate);
          return decoded.exact_production?.status !== 'unavailable';
        }
        catch (error) {
          if (error instanceof FactoryBalanceError || error instanceof PeriodicBalanceError) return false;
          throw error;
        }
      }, onProgress);
      if (seed) {
        const decoded = decodeFactory(model, seed);
        const ownership = productionRouteOwnership(decoded, request);
        if (!ownership.conflict.length) {
          lowerBound = seed.lower_bound;
          best = {...decoded, primary_routes: ownership.assignments, targets: resolved.targets, objective: seed.objective,
            exclusions: model.exclusions, search: {method: 'relaxed_route_repair', attempts: seed.attempts,
              ...(seed.numerical_retries ? {numerical_retries: seed.numerical_retries} : {}),
              elapsed_ms: seed.elapsed_ms, temporarily_excluded_recipes: seed.excluded_recipes}};
          visited = seed.attempts;
          return finish('limit');
        }
      }
      if (Date.now() >= deadline) return finish('limit');
    }
    let solution = runSolver(highs, model.text, {time_limit: Math.max(0.001, (deadline - Date.now()) / 1000)});
    visited++;
    if (visited === 1) lowerBound = solution.optimal ? solution.objective : solution.lower_bound;
    let periodicRecovery = false;
    if (solution.status === 'infeasible' && model.periodic && request.goals.some(goal =>
      goal.kind === 'capacity' && model.periodic.lines.some(line => line.recipe === goal.recipe)) && Date.now() < deadline) {
      onProgress({phase: 'periodic_precision'});
      const retry = runSolver(highs, model.text, {time_limit: Math.max(0.001, (deadline - Date.now()) / 1000),
        mip_feasibility_tolerance: 1e-8});
      if (retry.feasible) {
        for (const line of model.lines) {
          const count = retry.columns[line.machine];
          if (Math.abs(count) > 1e-8) continue;
          if (Math.abs(retry.columns[line.operation]) > 1e-8 * Math.max(1, line.configuration.operations_per_second)) continue;
          retry.columns[line.machine] = 0;
          retry.columns[line.operation] = 0;
        }
        solution = retry;
        periodicRecovery = true;
        numericalRetries++;
        periodicRetries++;
        completeSearch = false;
        lowerBound = null;
      }
    }
    if (solution.status === 'infeasible') continue;
    if (!solution.feasible) return finish('limit');
    if (best && solution.objective >= best.objective - 1e-9 && solution.optimal) continue;
    const decode = () => decodeFactory(model, {Columns: Object.fromEntries(Object.entries(solution.columns).map(([name, Primal]) => [name, {Primal}]))});
    let decoded;
    try {decoded = decode();}
    catch (error) {
      if (!(error instanceof FactoryBalanceError) && !(error instanceof ConstructionBalanceError) &&
          !(error instanceof PeriodicBalanceError)) throw error;
      if (periodicRecovery) return best ? finish('limit') : {status: 'numerical_error', optimal: false, reason: error.message};
      onProgress({phase: 'production_precision', resource: error.balance.resource});
      numericalRetries++;
      if (Date.now() >= deadline) return best ? finish('limit') : {status: 'numerical_error', optimal: false, reason: error.message};
      solution = runSolver(highs, scaleConstraintRows(model.text), {time_limit: Math.max(0.001, (deadline - Date.now()) / 1000)});
      if (!solution.feasible) return best ? finish('limit') : {status: 'numerical_error', optimal: false, reason: error.message};
      try {decoded = decode();}
      catch (retryError) {
        if (!(retryError instanceof FactoryBalanceError) && !(retryError instanceof ConstructionBalanceError) &&
            !(retryError instanceof PeriodicBalanceError)) throw retryError;
        return best ? finish('limit') : {status: 'numerical_error', optimal: false, reason: retryError.message};
      }
      completeSearch = false;
      lowerBound = null;
    }
    if (decoded.exact_production?.status === 'unavailable') {
      return best ? finish('limit') : {status: 'numerical_error', optimal: false,
        reason: decoded.exact_production.reason};
    }
    const ownership = productionRouteOwnership(decoded, request);
    if (ownership.conflict.length) {
      // Omitting a conflicting route is a heuristic when future consumers could make another coproduct useful.
      if (ownership.conflict.length < 2 || ownership.conflict.some(id => {
        const recipe = recipes.get(id);
        return recipe.outputs.length !== 1 || [...recipe.inputs, ...recipe.configurations.flatMap(value => value.inputs ?? [])]
          .some(flow => (flow.choices ?? [flow.resource]).includes(recipe.outputs[0].resource) || flow.returns);
      })) completeSearch = false;
      for (const id of ownership.conflict) {
        if (own(choices, id) === false) continue;
        if (Object.values(request.routes ?? {}).includes(id) || request.goals.some(goal => goal.recipe === id)) continue;
        branches.push({...choices, [id]: false});
      }
    } else if (!best || solution.objective < best.objective) {
      best = {...decoded, primary_routes: ownership.assignments, targets: resolved.targets,
        objective: solution.objective, exclusions: model.exclusions,
        ...(numericalRetries ? {search: {method: periodicRetries ? 'periodic_precision_recovery' : 'precision_recovery',
          numerical_retries: numericalRetries}} : {})};
    }
    if (!solution.optimal) return finish('limit');
  }
  return finish(best ? 'optimal' : completeSearch ? 'infeasible' : 'unresolved');
}
