function gcd(left, right) {
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}

function grouped(value) {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function exactInstalledCapacity(configuration, machines) {
  const ticks = configuration.capacity?.ticks_per_batch;
  const batch = configuration.setup?.batch ?? 1;
  const contained = configuration.setup?.contained_count ?? 1;
  if (![ticks, batch, contained, machines].every(Number.isSafeInteger) ||
      ticks <= 0 || batch <= 0 || contained <= 0 || machines < 0) return null;
  let numerator = 20n * BigInt(batch) * BigInt(contained) * BigInt(machines);
  let denominator = BigInt(ticks);
  const divisor = gcd(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;
  return {numerator: numerator.toString(), denominator: denominator.toString(),
    display: denominator === 1n ? grouped(numerator) : `${grouped(numerator)}/${grouped(denominator)}`};
}
