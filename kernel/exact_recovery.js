import * as Q from './rational.js';
import {exactInstalledCapacity} from './exact_capacity.js';

function addTo(map, key, amount) {
  const next = Q.add(map.get(key) ?? Q.ZERO, amount);
  if (next.n === 0n) map.delete(key);
  else map.set(key, next);
}

function sourceTerms(line, value) {
  const terms = [];
  for (const output of line.recipe.outputs) terms.push({resource: output.resource,
    variable: line.operation, amount: Q.decimal(output.amount), kind: 'output'});
  const inputs = [...line.recipe.inputs, ...(line.configuration.inputs ?? [])]
    .map(flow => ({flow, variable: line.operation}));
  for (const [pointIndex, point] of (line.configuration.operating_points ?? []).entries()) {
    const variable = `p${line.operation.slice(1)}_${pointIndex}`;
    for (const flow of point.inputs) inputs.push({flow, variable});
  }
  for (const [slot, {flow, variable}] of inputs.entries()) {
    if (value(variable) <= 0) continue;
    const candidates = line.inputTerms.filter(term => term.slot === slot && value(term.variable) > 0);
    if (candidates.length !== 1) throw new Error(`Exact ingredient selection is unavailable for ${line.recipe.id}, slot ${slot + 1}.`);
    const resource = candidates[0].resource;
    const amount = Q.decimal(flow.amount);
    terms.push({resource, variable, amount: Q.multiply(amount, Q.decimal(-1)), kind: 'input'});
    for (const returned of flow.returns?.[resource] ?? []) {
      terms.push({resource: returned.resource, variable, amount: Q.multiply(amount, Q.decimal(returned.amount)), kind: 'output'});
    }
  }
  if (line.configuration.eu_per_operation) terms.push({resource: 'energy:eu', variable: line.operation,
    amount: Q.decimal(-line.configuration.eu_per_operation), kind: 'power'});
  return terms;
}

function solveSparse(rows, count, deadline) {
  const pivots = new Map();
  let rank = 0;
  for (let column = 0; column < count; column++) {
    if (Date.now() >= deadline) throw new Error('Exact rate recovery reached its time limit.');
    let selected = -1;
    for (let index = rank; index < rows.length; index++) {
      if (!rows[index].terms.has(column)) continue;
      if (selected < 0 || rows[index].terms.size < rows[selected].terms.size) selected = index;
    }
    if (selected < 0) continue;
    [rows[rank], rows[selected]] = [rows[selected], rows[rank]];
    const pivot = rows[rank];
    const divisor = pivot.terms.get(column);
    for (const [key, amount] of pivot.terms) pivot.terms.set(key, Q.divide(amount, divisor));
    pivot.rhs = Q.divide(pivot.rhs, divisor);
    for (let index = 0; index < rows.length; index++) {
      if (index === rank) continue;
      const factor = rows[index].terms.get(column);
      if (!factor) continue;
      rows[index].terms.delete(column);
      for (const [key, amount] of pivot.terms) {
        if (key !== column) addTo(rows[index].terms, key, Q.multiply(Q.decimal(-1), Q.multiply(factor, amount)));
      }
      rows[index].rhs = Q.subtract(rows[index].rhs, Q.multiply(factor, pivot.rhs));
    }
    pivots.set(column, rank++);
  }
  for (const row of rows) if (!row.terms.size && row.rhs.n !== 0n) {
    throw new Error(`The selected resource equalities disagree at ${row.resource}.`);
  }
  if (rank !== count) throw new Error(`The selected material balances determine ${rank} of ${count} process rates.`);
  return Array.from({length: count}, (_, column) => rows[pivots.get(column)].rhs);
}

function exactGoalRate(model, goal) {
  if (goal.kind !== 'capacity') return goal.rate_ratio ?
    Q.ratio(BigInt(goal.rate_ratio.numerator), BigInt(goal.rate_ratio.denominator)) : Q.decimal(goal.rate);
  const line = model.lines.find(candidate => candidate.configuration.id === goal.configuration);
  if (!line) throw new Error(`Exact capacity goal configuration is unavailable: ${goal.configuration}.`);
  const installed = exactInstalledCapacity(line.configuration, goal.machines);
  if (!installed && !Number.isSafeInteger(line.configuration.operations_per_second)) {
    throw new Error(`Exact capacity-goal rate is unavailable for ${goal.configuration}.`);
  }
  const operations = installed ? Q.ratio(BigInt(installed.numerator), BigInt(installed.denominator)) :
    Q.multiply(Q.decimal(line.configuration.operations_per_second), Q.decimal(goal.machines));
  const output = line.recipe.outputs.filter(flow => flow.resource === goal.resource)
    .reduce((sum, flow) => Q.add(sum, Q.decimal(flow.amount)), Q.ZERO);
  return Q.multiply(operations, output);
}

function exactDemands(model) {
  const demands = new Map([...model.rows.keys()].map(resource => [resource, Q.ZERO]));
  for (const goal of model.request.goals ?? []) {
    demands.set(goal.resource, Q.add(demands.get(goal.resource), exactGoalRate(model, goal)));
  }
  if (model.infrastructure.total_eu_per_tick) {
    demands.set('energy:eu', Q.add(demands.get('energy:eu'),
      Q.multiply(Q.decimal(model.infrastructure.total_eu_per_tick), Q.decimal(20))));
  }
  return demands;
}

export function recoverExactProduction(model, solution, decoded, deadline = Date.now() + 3000) {
  const value = name => solution.Columns[name]?.Primal ?? 0;
  if (model.periodic || model.construction) throw new Error('Exact production recovery does not cover periodic generation or construction.');
  if (model.reserve || model.infrastructure.total_eu_per_tick) {
    throw new Error('Exact production recovery does not cover generation reserve or infrastructure power.');
  }
  const demands = exactDemands(model);
  const active = model.lines.filter(line => value(line.operation) > 0);
  if (active.some(line => line.recipe.outputs.some(flow => flow.resource === 'energy:eu'))) {
    throw new Error('Generator dispatch is outside the exact production preview.');
  }
  const variables = [];
  for (const line of active) {
    variables.push(line.operation);
    for (const pointIndex of (line.configuration.operating_points ?? []).keys()) {
      const variable = `p${line.operation.slice(1)}_${pointIndex}`;
      if (value(variable) > 0) variables.push(variable);
    }
  }
  const variableIndex = new Map(variables.map((variable, index) => [variable, index]));
  const resourceRows = new Map();
  for (const resource of model.rows.keys()) resourceRows.set(resource, new Map());
  const lineTerms = new Map();
  for (const line of active) {
    const terms = sourceTerms(line, value);
    lineTerms.set(line.configuration.id, terms);
    for (const {resource, variable, amount} of terms) {
      if (!variableIndex.has(variable)) throw new Error(`Exact source variable is missing: ${variable}.`);
      addTo(resourceRows.get(resource), variableIndex.get(variable), amount);
    }
  }
  const supplied = new Set(model.supplies.filter(supply => value(supply.name) > 0).map(supply => supply.resource));
  const equalities = [];
  for (const line of active) if (line.configuration.operating_points?.length) {
    const allocation = new Map(), output = new Map([[variableIndex.get(line.operation), Q.decimal(-1)]]);
    for (const [pointIndex, point] of line.configuration.operating_points.entries()) {
      const variable = `p${line.operation.slice(1)}_${pointIndex}`;
      if (!variableIndex.has(variable)) continue;
      const column = variableIndex.get(variable);
      allocation.set(column, Q.decimal(1));
      output.set(column, Q.decimal(point.operations_per_second));
    }
    equalities.push({resource: `${line.configuration.id} machine allocation`, terms: allocation,
      rhs: Q.decimal(Math.round(value(line.machine)))});
    equalities.push({resource: `${line.configuration.id} operating output`, terms: output, rhs: Q.ZERO});
  }
  for (const balance of decoded.balances) {
    if (supplied.has(balance.resource) || balance.surplus > balance.numerical_tolerance) continue;
    const terms = resourceRows.get(balance.resource);
    if (!terms?.size) continue;
    let rhs = demands.get(balance.resource);
    if (balance.resource === 'energy:eu') for (const line of model.lines) {
      const count = Math.round(value(line.machine));
      if (count && line.configuration.idle_eu_per_tick) {
        rhs = Q.add(rhs, Q.multiply(Q.decimal(20 * count), Q.decimal(line.configuration.idle_eu_per_tick)));
      }
    }
    equalities.push({resource: balance.resource, terms: new Map(terms), rhs});
  }
  const solutionRates = solveSparse(equalities, variables.length, deadline);
  for (const [index, line] of active.entries()) {
    const operation = solutionRates[variableIndex.get(line.operation)];
    if (operation.n < 0n) throw new Error(`Exact operation rate is negative for ${line.configuration.id}.`);
    const count = Math.round(value(line.machine));
    const installed = exactInstalledCapacity(line.configuration, count);
    if (!installed && !Number.isSafeInteger(line.configuration.operations_per_second)) {
      throw new Error(`Exact installed capacity is unavailable for ${line.configuration.id}.`);
    }
    const capacity = installed ? Q.ratio(BigInt(installed.numerator), BigInt(installed.denominator)) :
      Q.multiply(Q.decimal(count), Q.decimal(line.configuration.operations_per_second));
    if (Q.compare(operation, capacity) > 0) throw new Error(`Exact operation rate exceeds ${line.configuration.id} capacity.`);
  }
  for (const [index, variable] of variables.entries()) if (solutionRates[index].n < 0n) {
    throw new Error(`Exact operating rate is negative for ${variable}.`);
  }
  const recipeRequirements = new Map(), configurationRequirements = new Map();
  for (const goal of model.request.goals ?? []) if (goal.recipe) {
    const recipe = model.lines.find(line => line.recipe.id === goal.recipe)?.recipe;
    if (!recipe) throw new Error(`Exact goal recipe is unavailable: ${goal.recipe}.`);
    const output = recipe.outputs.filter(flow => flow.resource === goal.resource)
      .reduce((sum, flow) => Q.add(sum, Q.decimal(flow.amount)), Q.ZERO);
    const required = Q.divide(exactGoalRate(model, goal), output);
    if (!recipeRequirements.has(goal.recipe)) recipeRequirements.set(goal.recipe, new Map());
    addTo(recipeRequirements.get(goal.recipe), goal.resource, required);
    if (goal.kind === 'capacity') addTo(configurationRequirements, goal.configuration, required);
  }
  for (const [recipe, resources] of recipeRequirements) {
    const required = [...resources.values()].reduce((largest, rate) => Q.compare(rate, largest) > 0 ? rate : largest, Q.ZERO);
    let delivered = Q.ZERO;
    for (const line of active) if (line.recipe.id === recipe) {
      delivered = Q.add(delivered, solutionRates[variableIndex.get(line.operation)]);
    }
    if (Q.compare(delivered, required) < 0) throw new Error(`Exact goal recipe rate is short for ${recipe}.`);
  }
  for (const [configuration, minimum] of configurationRequirements) {
    const selected = active.find(line => line.configuration.id === configuration);
    if (!selected || Q.compare(solutionRates[variableIndex.get(selected.operation)], minimum) < 0) {
      throw new Error(`Exact installed capacity goal is short for ${configuration}.`);
    }
  }
  for (const line of active) {
    const dispatch = model.request.dispatch?.[line.configuration.id];
    if (!dispatch) continue;
    const operation = solutionRates[variableIndex.get(line.operation)];
    if (dispatch.maximum !== undefined && Q.compare(operation, Q.decimal(dispatch.maximum)) > 0) {
      throw new Error(`Exact dispatch exceeds ${line.configuration.id}'s maximum.`);
    }
    if (dispatch.minimum !== undefined && !configurationRequirements.has(line.configuration.id) &&
        Q.compare(operation, Q.decimal(dispatch.minimum)) < 0) {
      throw new Error(`Exact dispatch is short of ${line.configuration.id}'s minimum.`);
    }
  }
  const balances = [];
  const exactExternal = new Map();
  for (const [resource, terms] of resourceRows) {
    let net = Q.ZERO;
    for (const [column, amount] of terms) net = Q.add(net, Q.multiply(amount, solutionRates[column]));
    if (resource === 'energy:eu') for (const line of model.lines) {
      const count = Math.round(value(line.machine));
      if (count && line.configuration.idle_eu_per_tick) {
        net = Q.subtract(net, Q.multiply(Q.decimal(20 * count), Q.decimal(line.configuration.idle_eu_per_tick)));
      }
    }
    const demand = demands.get(resource);
    let external = Q.ZERO;
    if (supplied.has(resource) && Q.compare(net, demand) < 0) external = Q.subtract(demand, net);
    const allowed = model.supplies.filter(supply => supply.resource === resource);
    if (allowed.length && allowed.every(supply => supply.limit !== undefined)) {
      const limit = allowed.reduce((sum, supply) => Q.add(sum, Q.decimal(supply.limit)), Q.ZERO);
      if (Q.compare(external, limit) > 0) throw new Error(`Exact external supply exceeds the limit for ${resource}.`);
    }
    exactExternal.set(resource, external);
    net = Q.add(net, external);
    if (Q.compare(net, demand) < 0) throw new Error(`Exact resource balance is short for ${resource}.`);
    balances.push({resource, demand: Q.record(demand), net: Q.record(net), external: Q.record(external),
      surplus: Q.record(Q.subtract(net, demand))});
  }
  const exactLines = active.map(line => {
    const groups = {input: new Map(), output: new Map()};
    for (const term of lineTerms.get(line.configuration.id)) {
      if (term.kind === 'power') continue;
      const rate = Q.multiply(term.amount, solutionRates[variableIndex.get(term.variable)]);
      addTo(groups[term.kind], term.resource, term.kind === 'input' ? Q.multiply(rate, Q.decimal(-1)) : rate);
    }
    let power = Q.multiply(solutionRates[variableIndex.get(line.operation)], Q.decimal(line.configuration.eu_per_operation ?? 0));
    power = Q.add(power, Q.multiply(Q.decimal(20 * Math.round(value(line.machine))), Q.decimal(line.configuration.idle_eu_per_tick ?? 0)));
    return {recipe: line.recipe.id, configuration: line.configuration.id,
      operations_per_second: Q.record(solutionRates[variableIndex.get(line.operation)]),
      inputs: [...groups.input].map(([resource, rate]) => ({resource, rate: Q.record(rate)})),
      outputs: [...groups.output].map(([resource, rate]) => ({resource, rate: Q.record(rate)})),
      power_eu_per_second: Q.record(power)};
  });
  const available = new Map(), connections = [], retained = [];
  const addSupply = (resource, source, amount) => {
    if (amount.n <= 0n) return;
    if (!available.has(resource)) available.set(resource, []);
    available.get(resource).push({source, remaining: amount});
  };
  for (const line of exactLines) for (const output of line.outputs) addSupply(output.resource,
    `${line.recipe}|${line.configuration}`, Q.ratio(BigInt(output.rate.numerator), BigInt(output.rate.denominator)));
  for (const [resource, amount] of exactExternal) addSupply(resource, `external:${resource}`, amount);
  const take = (resource, destination, demand) => {
    let remaining = demand;
    for (const source of available.get(resource) ?? []) {
      if (remaining.n === 0n) break;
      const amount = Q.compare(source.remaining, remaining) < 0 ? source.remaining : remaining;
      if (amount.n === 0n) continue;
      connections.push({source: source.source, destination, resource, rate: Q.record(amount)});
      source.remaining = Q.subtract(source.remaining, amount);
      remaining = Q.subtract(remaining, amount);
    }
    if (remaining.n !== 0n) throw new Error(`Exact flow allocation is short for ${resource}.`);
  };
  for (const line of exactLines) {
    const destination = `${line.recipe}|${line.configuration}`;
    for (const input of line.inputs) take(input.resource, destination,
      Q.ratio(BigInt(input.rate.numerator), BigInt(input.rate.denominator)));
    const power = Q.ratio(BigInt(line.power_eu_per_second.numerator), BigInt(line.power_eu_per_second.denominator));
    if (power.n > 0n) take('energy:eu', destination, power);
  }
  for (const [resource, demand] of demands) if (demand.n > 0n) take(resource, `goal:${resource}`, demand);
  for (const [resource, sources] of available) for (const source of sources) {
    if (source.remaining.n > 0n) retained.push({resource, source: source.source, rate: Q.record(source.remaining)});
  }
  const endpoints = new Map();
  for (const [resource, rate] of exactExternal) if (rate.n > 0n) endpoints.set(`external:${resource}`, rate);
  for (const [resource, rate] of demands) if (rate.n > 0n) endpoints.set(`goal:${resource}`, rate);
  for (const flow of retained) {
    addTo(endpoints, `surplus:${flow.resource}`, Q.ratio(BigInt(flow.rate.numerator), BigInt(flow.rate.denominator)));
  }
  const fromRecord = record => Q.ratio(BigInt(record.numerator), BigInt(record.denominator));
  let productionEnergy = Q.ZERO;
  for (const line of exactLines) {
    productionEnergy = Q.add(productionEnergy, fromRecord(line.power_eu_per_second));
    for (const flow of line.inputs) if (flow.resource === 'energy:eu') {
      productionEnergy = Q.add(productionEnergy, fromRecord(flow.rate));
    }
  }
  const perTick = amount => Q.divide(amount, Q.decimal(20));
  const externalEnergy = perTick(exactExternal.get('energy:eu') ?? Q.ZERO);
  const productionUse = perTick(productionEnergy);
  const goalEnergy = perTick(demands.get('energy:eu') ?? Q.ZERO);
  const firmExternal = perTick(model.supplies.filter(supply => supply.resource === 'energy:eu')
    .reduce((sum, supply) => Q.add(sum, Q.decimal(supply.firm_capacity ?? 0)), Q.ZERO));
  const power = {
    gross_generation_eu_per_tick: Q.record(Q.ZERO),
    generation_related_consumption_eu_per_tick: Q.record(Q.ZERO),
    net_generation_eu_per_tick: Q.record(Q.ZERO),
    external_eu_per_tick: Q.record(externalEnergy),
    other_production_consumption_eu_per_tick: Q.record(productionUse),
    infrastructure_and_goal_eu_per_tick: Q.record(goalEnergy),
    operating_margin_eu_per_tick: Q.record(Q.subtract(Q.subtract(externalEnergy, productionUse), goalEnergy)),
    installed_generation_eu_per_tick: Q.record(Q.ZERO),
    installed_margin_eu_per_tick: Q.record(Q.subtract(Q.subtract(firmExternal, productionUse), goalEnergy)),
    consumption_eu_per_tick: Q.record(productionUse),
  };
  return {operations: active.map(line => ({configuration: line.configuration.id,
    rate: Q.record(solutionRates[variableIndex.get(line.operation)])})),
    operating_points: variables.filter(variable => variable.startsWith('p')).map(variable => ({variable,
      allocation: Q.record(solutionRates[variableIndex.get(variable)])})), balances,
    lines: exactLines, external: [...exactExternal].filter(([, rate]) => rate.n > 0n)
      .map(([resource, rate]) => ({resource, rate: Q.record(rate)})), connections, retained,
    endpoints: [...endpoints].map(([key, rate]) => ({key, rate: Q.record(rate),
      ...(key.endsWith('energy:eu') ? {rate_eu_per_tick: Q.record(Q.divide(rate, Q.decimal(20)))} : {})})), power};
}
