function nonnegative(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${label} must be finite and nonnegative within the supported range.`);
  }
  return value;
}

function whole(value, label, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw new Error(`${label} must be a ${positive ? 'positive' : 'nonnegative'} whole number.`);
  }
  return value;
}

function add(terms, variable, coefficient) {
  terms.set(variable, (terms.get(variable) ?? 0) + coefficient);
}

function expression(terms) {
  const present = [...terms].filter(([, coefficient]) => coefficient !== 0);
  return present.length
    ? present.map(([variable, coefficient]) => `${coefficient < 0 ? '-' : '+'} ${Math.abs(coefficient)} ${variable}`).join(' ')
    : '0 zero';
}

export function constantPowerSegments(profiles) {
  if (!Array.isArray(profiles) || !profiles.length) throw new Error('Periodic generation needs at least one profile.');
  const length = profiles[0].values?.length;
  whole(length, 'Period length', true);
  const names = new Set();
  for (const profile of profiles) {
    if (typeof profile.variable !== 'string' || !profile.variable.length || names.has(profile.variable)) {
      throw new Error('Periodic profiles need distinct machine-count variables.');
    }
    names.add(profile.variable);
    if (profile.values?.length !== length) throw new Error('Periodic profiles need the same period length.');
    for (const value of profile.values) nonnegative(value, 'Periodic power');
  }
  const segments = [];
  let start = 0;
  for (let tick = 1; tick <= length; tick++) {
    if (tick < length && profiles.every(profile => profile.values[tick] === profile.values[start])) continue;
    segments.push({start, ticks: tick - start, power: profiles.map(profile => profile.values[start])});
    start = tick;
  }
  return segments;
}

export function expandPowerProfile(specification) {
  whole(specification?.period_ticks, 'Period length', true);
  if (specification.period_ticks > 1000000) throw new Error('Periodic generation exceeds the supported one-million-tick period.');
  if (!Array.isArray(specification?.segments) || !specification.segments.length) {
    throw new Error('Periodic generation needs nonempty constant-power segments.');
  }
  const values = new Float64Array(specification.period_ticks);
  let tick = 0;
  for (const segment of specification.segments) {
    const ticks = whole(segment.ticks, 'Segment length', true);
    const power = nonnegative(segment.eu_per_tick, 'Segment power');
    if (tick + ticks > values.length) throw new Error('Periodic generation exceeds its period.');
    values.fill(power, tick, tick + ticks);
    tick += ticks;
  }
  if (tick !== values.length) throw new Error('Periodic generation does not cover its period.');
  return values;
}

export function appendPeriodicDispatch(model, {profiles, firm_terms, demand_eu_per_tick, storage = []}) {
  const segments = constantPowerSegments(profiles);
  nonnegative(demand_eu_per_tick, 'Periodic demand');
  if (!(firm_terms instanceof Map) || !Array.isArray(storage)) throw new Error('Periodic firm power and storage need typed records.');
  const gaps = profiles.map(profile => nonnegative(profile.one_event_loss_eu_per_period ?? 0, 'Periodic event loss'));
  if (gaps.some(Boolean) && storage.length > 1) {
    throw new Error('An uncertain periodic event currently needs one selected storage tier.');
  }
  const gapRates = gaps.map(gap => gap / profiles[0].values.length);
  const name = 'periodic_firm_net';
  model.bounds.push(`${name} free`);
  const firm = new Map([[name, 1]]);
  for (const [variable, euPerSecond] of firm_terms) add(firm, variable, -euPerSecond / 20);
  model.constraints.push(`periodic_firm_balance: ${expression(firm)} = ${-demand_eu_per_tick}`);

  const builds = [];
  for (const [index, unit] of storage.entries()) {
    if (unit.loss_eu_per_tick !== 0) throw new Error('Periodic storage loss needs a verified dispatch adapter.');
    const variable = unit.variable ?? `periodic_storage_${index}`;
    if (typeof variable !== 'string' || !variable.length) throw new Error('Periodic storage needs a count variable.');
    for (const field of ['capacity_eu', 'charge_eu_per_tick', 'discharge_eu_per_tick']) whole(unit[field], field, true);
    if (unit.max_count !== undefined) whole(unit.max_count, 'Storage count limit');
    if (unit.installed_count !== undefined) whole(unit.installed_count, 'Installed storage count');
    const longestSegment = segments.reduce((maximum, segment) => Math.max(maximum, segment.ticks), 0);
    const safeCount = Math.floor(Number.MAX_SAFE_INTEGER / Math.max(unit.capacity_eu,
      longestSegment *
      Math.max(unit.charge_eu_per_tick, unit.discharge_eu_per_tick)));
    model.bounds.push(`${variable} >= 0`);
    model.bounds.push(`${variable} <= ${Math.min(unit.max_count ?? safeCount, safeCount)}`);
    if (unit.installed_count !== undefined) model.bounds.push(`${variable} = ${unit.installed_count}`);
    model.integers.push(variable);
    add(model.objective, variable, nonnegative(unit.build_cost ?? 1, 'Storage build cost'));
    builds.push({variable, resource: unit.resource});
    for (let step = 0; step <= segments.length; step++) {
      const state = `periodic_state_${index}_${step}`;
      model.bounds.push(`${state} >= 0`);
      const capacity = new Map([[state, 1], [variable, -unit.capacity_eu]]);
      if (index === 0) profiles.forEach((profile, source) => add(capacity, profile.variable, 2 * gaps[source]));
      model.constraints.push(`periodic_capacity_${index}_${step}: ${expression(capacity)} <= 0`);
    }
    model.constraints.push(`periodic_cycle_${index}: + 1 periodic_state_${index}_${segments.length} - 1 periodic_state_${index}_0 >= 0`);
  }

  for (const [step, segment] of segments.entries()) {
    const net = new Map([[name, -1]]);
    for (const [index, profile] of profiles.entries()) {
      const output = storage.length ? segment.power[index] - gapRates[index] :
        Math.max(0, segment.power[index] - gaps[index]);
      add(net, profile.variable, -output);
    }
    for (const [index, unit] of storage.entries()) {
      const machine = unit.variable ?? `periodic_storage_${index}`;
      const charge = `periodic_charge_${index}_${step}`;
      const discharge = `periodic_discharge_${index}_${step}`;
      model.bounds.push(`${charge} >= 0`, `${discharge} >= 0`);
      const chargeLimit = new Map([[charge, 1], [machine, -unit.charge_eu_per_tick]]);
      if (index === 0) profiles.forEach((profile, source) => add(chargeLimit, profile.variable, gapRates[source]));
      model.constraints.push(`periodic_charge_limit_${index}_${step}: ${expression(chargeLimit)} <= 0`);
      model.constraints.push(`periodic_discharge_limit_${index}_${step}: + 1 ${discharge} - ${unit.discharge_eu_per_tick} ${machine} <= 0`);
      model.constraints.push(`periodic_state_balance_${index}_${step}: + 1 periodic_state_${index}_${step + 1} - 1 periodic_state_${index}_${step} - ${segment.ticks} ${charge} + ${segment.ticks} ${discharge} = 0`);
      add(net, charge, 1);
      add(net, discharge, -1);
    }
    model.constraints.push(`periodic_net_${step}: ${expression(net)} <= 0`);
    if (storage.length && gaps.some(Boolean)) {
      const eventNet = new Map([[name, -1]]);
      profiles.forEach((profile, source) => add(eventNet, profile.variable,
        -Math.max(0, segment.power[source] - gaps[source])));
      storage.forEach((unit, index) => add(eventNet, unit.variable ?? `periodic_storage_${index}`,
        -unit.discharge_eu_per_tick));
      model.constraints.push(`periodic_event_peak_${step}: ${expression(eventNet)} <= 0`);
    }
  }
  return {period_ticks: profiles[0].values.length, segments, storage_builds: builds, gaps, gapRates,
    firm_terms, demand_eu_per_tick};
}

export class PeriodicBalanceError extends Error {
  constructor(reason, actual, limit) {
    super(`The numerical solution failed the periodic power check for ${reason}: ${actual} versus ${limit}.`);
    this.balance = {resource: `periodic power, ${reason}`, actual, limit};
  }
}

export function decodePeriodicDispatch(model, value) {
  if (!model) return undefined;
  const tolerance = magnitude => Math.max(Math.min(1e-6, Math.abs(magnitude) * 1e-7),
    Math.abs(magnitude) * Number.EPSILON * 16);
  const counts = model.storage.map(unit => {
    const count = Math.round(value(unit.variable));
    if (!Number.isSafeInteger(count) || count < 0) throw new PeriodicBalanceError('storage count', count, 'whole nonnegative');
    return count;
  });
  const firmNet = [...model.firm_terms].reduce((sum, [variable, coefficient]) =>
    sum + value(variable) * coefficient / 20, 0) - model.demand_eu_per_tick;
  if (Math.abs(value('periodic_firm_net') - firmNet) > tolerance(firmNet)) {
    throw new PeriodicBalanceError('firm balance', value('periodic_firm_net'), firmNet);
  }
  const generatedPerPeriod = model.lines.reduce((sum, line, index) =>
    sum + (line.values.reduce((total, amount) => total + amount, 0) - model.gaps[index]) * value(line.variable), 0);
  const firmPerPeriod = firmNet * model.period_ticks;
  const periodSurplus = generatedPerPeriod + firmPerPeriod;
  const periodRoundoff = (Math.abs(generatedPerPeriod) + Math.abs(firmPerPeriod)) * Number.EPSILON * 16;
  if (!Number.isFinite(periodSurplus) || periodSurplus < -periodRoundoff) {
    throw new PeriodicBalanceError('whole-period energy', periodSurplus, 0);
  }
  const generation = model.lines.map(line => {
    const machines = Math.round(value(line.variable));
    const dailyEnergy = line.values.reduce((sum, amount) => sum + amount, 0);
    const cycle = line.cell_cycle;
    return {recipe: line.recipe, configuration: line.configuration, machine: line.machine, machines,
      nominal_average_eu_per_tick: dailyEnergy / model.period_ticks * machines,
      guaranteed_average_eu_per_tick: (dailyEnergy - (line.one_event_loss_eu_per_period ?? 0)) /
        model.period_ticks * machines,
      ...(cycle ? {cell_cycle: cycle, long_run_average_eu_per_tick:
        cycle.energy_eu_per_repeating_cycle / (cycle.repeating_clear_days * model.period_ticks) * machines} : {}),
      assumptions: line.assumptions};
  });
  const eventBuffer = model.gaps.reduce((sum, gap, index) => sum + 2 * gap * value(model.lines[index].variable), 0);
  const storage = model.storage.map((unit, index) => ({machine: unit.id, machines: counts[index],
    capacity_eu: unit.capacity_eu * counts[index], charge_eu_per_tick: unit.charge_eu_per_tick * counts[index],
    discharge_eu_per_tick: unit.discharge_eu_per_tick * counts[index],
    initial_charge_eu: value(`periodic_state_${index}_0`) + (index === 0 ? eventBuffer : 0),
    ending_charge_eu: value(`periodic_state_${index}_${model.segments.length}`) + (index === 0 ? eventBuffer : 0)}));
  let curtailed = 0, minimumMargin = Infinity;
  for (const [step, segment] of model.segments.entries()) {
    const available = firmNet + model.lines.reduce((sum, line, index) =>
      sum + (model.storage.length ? segment.power[index] - model.gapRates[index] :
        Math.max(0, segment.power[index] - model.gaps[index])) * value(line.variable), 0);
    let net = available;
    for (const [index, unit] of model.storage.entries()) {
      const count = counts[index], charge = value(`periodic_charge_${index}_${step}`);
      const discharge = value(`periodic_discharge_${index}_${step}`);
      const first = value(`periodic_state_${index}_${step}`);
      const last = value(`periodic_state_${index}_${step + 1}`);
      const capacity = unit.capacity_eu * count - (index === 0 ? eventBuffer : 0);
      const chargeLimit = unit.charge_eu_per_tick * count - (index === 0 ? eventBuffer / 2 / model.period_ticks : 0);
      if (charge < -tolerance(charge) || charge > chargeLimit + tolerance(chargeLimit) ||
          discharge < -tolerance(discharge) || discharge > unit.discharge_eu_per_tick * count + tolerance(unit.discharge_eu_per_tick * count) ||
          first < -tolerance(first) || first > capacity + tolerance(capacity) ||
          last < -tolerance(last) || last > capacity + tolerance(capacity) ||
          Math.abs(last - first - segment.ticks * (charge - discharge)) > tolerance(capacity + segment.ticks * (charge + discharge))) {
        throw new PeriodicBalanceError(`storage ${unit.id} at tick ${segment.start}`, last, capacity);
      }
      net -= charge - discharge;
    }
    if (net < -tolerance(Math.abs(available) + model.storage.reduce((sum, unit, index) =>
      sum + unit.discharge_eu_per_tick * counts[index], 0))) {
      throw new PeriodicBalanceError(`supply at tick ${segment.start}`, net, 0);
    }
    if (model.storage.length && model.gaps.some(Boolean)) {
      const eventSupply = firmNet + model.lines.reduce((sum, line, index) =>
        sum + Math.max(0, segment.power[index] - model.gaps[index]) * value(line.variable), 0) +
        model.storage.reduce((sum, unit, index) => sum + unit.discharge_eu_per_tick * counts[index], 0);
      if (eventSupply < -tolerance(Math.abs(eventSupply))) {
        throw new PeriodicBalanceError(`event transfer at tick ${segment.start}`, eventSupply, 0);
      }
    }
    minimumMargin = Math.min(minimumMargin, net);
    curtailed += Math.max(0, net) * segment.ticks;
  }
  for (const unit of storage) if (unit.ending_charge_eu < unit.initial_charge_eu - tolerance(unit.initial_charge_eu)) {
    throw new PeriodicBalanceError(`cycle for ${unit.machine}`, unit.ending_charge_eu, unit.initial_charge_eu);
  }
  return {period_ticks: model.period_ticks, generation, storage,
    firm_net_eu_per_tick: firmNet, minimum_dispatch_margin_eu_per_tick: minimumMargin,
    energy_balance_surplus_eu_per_period: periodSurplus,
    energy_roundoff_bound_eu_per_period: periodRoundoff,
    curtailed_generation_eu_per_period: curtailed,
    event_buffer_eu: eventBuffer,
    assumptions: ['Each segment repeats with steady production demand, continuous fuel supply, and lossless storage.',
      'Initial storage charge is a bootstrap requirement; stored energy is not recurring generation.',
      ...(eventBuffer ? ['One uncertain generation gap per source and period is allowed at any phase. The plan loses its maximum gap energy each period and reserves two periods of that energy in storage.'] : []),
      ...new Set(generation.flatMap(line => line.assumptions))]};
}
