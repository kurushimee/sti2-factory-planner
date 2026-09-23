function decimal(value, label) {
  if (typeof value === 'number' && (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER)) throw new Error(`${label} must be positive; use decimal text for a large quantity.`);
  if (!['number', 'string'].includes(typeof value)) throw new Error(`${label} must be a positive decimal quantity.`);
  const text = String(value).trim();
  const match = text.match(/^\+?(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (!match || text.length > 2000) throw new Error(`${label} must be positive decimal text with at most 1,000 digits.`);
  const digits = match[1] + (match[2] ?? '');
  const exponent = Number(match[3] ?? 0) - (match[2]?.length ?? 0);
  if (digits.length > 1000 || !Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) throw new Error(`${label} exceeds the supported decimal length or exponent.`);
  const numerator = BigInt(digits);
  if (numerator === 0n) throw new Error(`${label} must be positive.`);
  return exponent >= 0 ? {numerator: numerator * 10n ** BigInt(exponent), denominator: 1n}
    : {numerator, denominator: 10n ** BigInt(-exponent)};
}

function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }

export function productionTime(quantity, rate) {
  if (!Number.isFinite(rate) || rate <= 0 || rate > Number.MAX_SAFE_INTEGER) throw new Error('Goal rate must be positive and within the supported numeric range.');
  const amount = decimal(quantity, 'Goal quantity'), speed = decimal(rate, 'Goal rate');
  let numerator = amount.numerator * speed.denominator, denominator = amount.denominator * speed.numerator;
  const divisor = gcd(numerator, denominator);
  numerator /= divisor; denominator /= divisor;
  const numeric = Number(numerator) / Number(denominator);
  const finite = Number.isFinite(numeric) && numeric > 0;
  const display = denominator === 1n ? numerator.toString() : `${numerator}/${denominator}`;
  return {quantity, steady_production_seconds: finite ? numeric : null,
    steady_production_seconds_exact: {numerator: numerator.toString(), denominator: denominator.toString()},
    completion_ticks_ceil: ((numerator * 20n + denominator - 1n) / denominator).toString(),
    time_display: `${display} seconds`,
    time_basis: 'After startup, at the requested sustained output rate. Whole-tick completion is rounded upward.'};
}
