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

function exactNumber(numerator, denominator) {
  const value = Number(numerator) / Number(denominator);
  if (!Number.isFinite(value) || value <= 0) return null;
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, value);
  const bits = bytes.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & 0x000fffffffffffffn;
  const significand = exponent ? (1n << 52n) + fraction : fraction;
  const shift = (exponent || 1) - 1023 - 52;
  const exact = shift >= 0 ? numerator === denominator * (significand << BigInt(shift))
    : (numerator << BigInt(-shift)) === denominator * significand;
  return exact ? value : null;
}

function grouped(value) { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

function exactInteger(value) {
  const digits = value.toString();
  const trailing = digits.match(/0+$/)?.[0].length ?? 0;
  if (digits.length > 60 && trailing > 20) {
    const coefficient = grouped(digits.slice(0, -trailing));
    return coefficient === '1' ? `10^${trailing}` : `${coefficient} × 10^${trailing}`;
  }
  return grouped(digits);
}

function exactDisplay(numerator, denominator) {
  const top = exactInteger(numerator);
  if (denominator === 1n) return `${top} seconds`;
  const bottom = exactInteger(denominator);
  return `${top.includes(' × ') ? `(${top})` : top}/${bottom.includes(' × ') ? `(${bottom})` : bottom} seconds`;
}

export function productionTime(quantity, rate) {
  if (!Number.isFinite(rate) || rate <= 0 || rate > Number.MAX_SAFE_INTEGER) throw new Error('Goal rate must be positive and within the supported numeric range.');
  const amount = decimal(quantity, 'Goal quantity'), speed = decimal(rate, 'Goal rate');
  let numerator = amount.numerator * speed.denominator, denominator = amount.denominator * speed.numerator;
  const divisor = gcd(numerator, denominator);
  numerator /= divisor; denominator /= divisor;
  return {quantity, steady_production_seconds: exactNumber(numerator, denominator),
    steady_production_seconds_exact: {numerator: numerator.toString(), denominator: denominator.toString()},
    completion_ticks_ceil: ((numerator * 20n + denominator - 1n) / denominator).toString(),
    time_display: exactDisplay(numerator, denominator),
    time_basis: 'After startup, this is the exact quantity-to-sustained-rate quotient. The whole-tick rate equivalent rounds upward and does not include recipe batching.'};
}
