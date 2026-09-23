function gcd(left, right) {
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}

function grouped(value) {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function exactInstalledCapacity(configuration, machines) {
  if (!Number.isSafeInteger(machines) || machines < 0) return null;
  const expected = configuration.capacity?.expected_operations_per_second_ratio;
  if (expected) {
    if (!/^\d+$/.test(String(expected.numerator)) || !/^[1-9]\d*$/.test(String(expected.denominator))) return null;
    let numerator = BigInt(expected.numerator) * BigInt(machines);
    let denominator = BigInt(expected.denominator);
    if (configuration.operations_per_second !== undefined &&
        Math.abs(configuration.operations_per_second - Number(expected.numerator) / Number(expected.denominator)) >
          1e-12 * Math.max(1, configuration.operations_per_second)) return null;
    const divisor = gcd(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
    return {numerator: numerator.toString(), denominator: denominator.toString(),
      display: denominator === 1n ? grouped(numerator) : `${grouped(numerator)}/${grouped(denominator)}`};
  }
  const ticks = configuration.capacity?.ticks_per_batch;
  const batch = configuration.setup?.batch ?? configuration.setup?.contained_count ?? 1;
  if (![ticks, batch].every(Number.isSafeInteger) || ticks <= 0 || batch <= 0) return null;
  const rate = 20 * batch / ticks;
  if (configuration.operations_per_second !== undefined &&
      Math.abs(configuration.operations_per_second - rate) > 1e-12 * Math.max(1, rate)) return null;
  let numerator = 20n * BigInt(batch) * BigInt(machines);
  let denominator = BigInt(ticks);
  const divisor = gcd(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;
  return {numerator: numerator.toString(), denominator: denominator.toString(),
    display: denominator === 1n ? grouped(numerator) : `${grouped(numerator)}/${grouped(denominator)}`};
}
