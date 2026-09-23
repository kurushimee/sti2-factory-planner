function finiteNonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${name} must be finite, nonnegative, and within the supported numeric range.`);
  }
  return value;
}

function maximumCircularDeficit(net) {
  const length = net.length;
  const prefix = new Float64Array(length * 2 + 1);
  for (let index = 1; index < prefix.length; index++) {
    prefix[index] = prefix[index - 1] + net[(index - 1) % length];
    if (Math.abs(prefix[index]) > Number.MAX_SAFE_INTEGER) throw new Error('The period energy exceeds the supported numeric range.');
  }
  const deque = new Int32Array(length * 2 + 1);
  let first = 0, last = 0, maximum = 0;
  deque[last++] = 0;
  for (let end = 1; end < prefix.length; end++) {
    while (first < last && deque[first] < end - length) first++;
    maximum = Math.max(maximum, prefix[deque[first]] - prefix[end]);
    while (first < last && prefix[deque[last - 1]] <= prefix[end]) last--;
    deque[last++] = end;
  }
  return maximum;
}

export function balancePeriodicPower(generation, demand, storage = {}) {
  if (!Array.isArray(generation) || !generation.length || !Array.isArray(demand) || generation.length !== demand.length) {
    throw new Error('Generation and demand need equally sized, nonempty tick profiles.');
  }
  const capacity = finiteNonnegative(storage.capacity_eu ?? 0, 'Storage capacity');
  const charge = finiteNonnegative(storage.charge_eu_per_tick ?? 0, 'Storage charge limit');
  const discharge = finiteNonnegative(storage.discharge_eu_per_tick ?? 0, 'Storage discharge limit');
  const net = new Float64Array(generation.length);
  let total = 0, initial = 0, prefix = 0, chargeLimited = 0;
  for (let tick = 0; tick < generation.length; tick++) {
    const produced = finiteNonnegative(generation[tick], `Generation at tick ${tick}`);
    const used = finiteNonnegative(demand[tick], `Demand at tick ${tick}`);
    const difference = produced - used;
    if (difference < -discharge) {
      return {status: 'infeasible', reason: 'discharge_limit', tick, shortfall_eu: -difference - discharge};
    }
    net[tick] = Math.min(difference, charge);
    chargeLimited += Math.max(0, difference - net[tick]);
    total += net[tick];
    prefix += net[tick];
    if (Math.abs(prefix) > Number.MAX_SAFE_INTEGER) throw new Error('The period energy exceeds the supported numeric range.');
    initial = Math.max(initial, -prefix);
  }
  if (total < 0) return {status: 'infeasible', reason: 'period_energy', shortfall_eu: -total};
  const required = maximumCircularDeficit(net);
  if (required > capacity) {
    return {status: 'infeasible', reason: 'storage_capacity', required_capacity_eu: required,
      available_capacity_eu: capacity, required_initial_charge_eu: initial};
  }
  let stored = initial, curtailed = 0, minimum = stored, maximum = stored;
  for (let tick = 0; tick < net.length; tick++) {
    const next = stored + net[tick];
    if (next < 0) throw new Error(`Periodic storage balance failed at tick ${tick}.`);
    curtailed += Math.max(0, next - capacity);
    stored = Math.min(capacity, next);
    minimum = Math.min(minimum, stored);
    maximum = Math.max(maximum, stored);
  }
  if (stored < initial) throw new Error('The periodic storage balance did not replenish its initial charge.');
  return {status: 'feasible', required_capacity_eu: required, available_capacity_eu: capacity,
    required_initial_charge_eu: initial, ending_charge_eu: stored, minimum_charge_eu: minimum,
    maximum_charge_eu: maximum, curtailed_generation_eu: chargeLimited + curtailed,
    charge_limited_eu: chargeLimited, capacity_limited_eu: curtailed, period_surplus_eu: total};
}

export function minimumStorageCount(generation, demand, storage, maximumCount) {
  for (const field of ['capacity_eu', 'charge_eu_per_tick', 'discharge_eu_per_tick']) {
    if (!Number.isSafeInteger(storage?.[field]) || storage[field] <= 0) {
      throw new Error(`Storage ${field} must be a positive whole number within the supported range.`);
    }
  }
  if (storage.loss_eu_per_tick !== 0) throw new Error('This storage sizing rule has no verified loss adapter.');
  if (!Number.isSafeInteger(maximumCount) || maximumCount < 0) throw new Error('The storage count limit must be a nonnegative whole number.');
  const safeCount = Math.min(maximumCount, ...['capacity_eu', 'charge_eu_per_tick', 'discharge_eu_per_tick']
    .map(field => Math.floor(Number.MAX_SAFE_INTEGER / storage[field])));
  const evaluate = count => balancePeriodicPower(generation, demand, {
    capacity_eu: count * storage.capacity_eu,
    charge_eu_per_tick: count * storage.charge_eu_per_tick,
    discharge_eu_per_tick: count * storage.discharge_eu_per_tick});
  const empty = evaluate(0);
  if (empty.status === 'feasible') return {status: 'feasible', count: 0, balance: empty};
  if (!safeCount) return {status: 'infeasible', maximum_count: 0, reason: empty.reason};
  let lower = 0, upper = 1, result = evaluate(upper);
  while (result.status !== 'feasible' && upper < safeCount) {
    lower = upper;
    upper = Math.min(safeCount, upper * 2);
    result = evaluate(upper);
  }
  if (result.status !== 'feasible') return {status: 'infeasible', maximum_count: safeCount,
    reason: result.reason, balance: result};
  while (upper - lower > 1) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const candidate = evaluate(middle);
    if (candidate.status === 'feasible') { upper = middle; result = candidate; }
    else lower = middle;
  }
  return {status: 'feasible', count: upper, balance: result};
}
