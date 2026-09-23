function gcd(left, right) {
  left = left < 0n ? -left : left;
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}

export function ratio(numerator, denominator = 1n) {
  if (denominator === 0n) throw new Error('An exact rate has a zero denominator.');
  if (denominator < 0n) {numerator = -numerator; denominator = -denominator;}
  const divisor = gcd(numerator, denominator);
  return {n: numerator / divisor, d: denominator / divisor};
}

export function decimal(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('An exact rate must be finite.');
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new Error(`An exact rate is not a decimal: ${value}.`);
  const [, sign, whole, fraction = '', exponent = '0'] = match;
  const shift = Number(exponent) - fraction.length;
  const numerator = BigInt(`${sign}${whole}${fraction}`);
  return shift >= 0 ? ratio(numerator * 10n ** BigInt(shift)) : ratio(numerator, 10n ** BigInt(-shift));
}

export const ZERO = ratio(0n);
export const add = (a, b) => ratio(a.n * b.d + b.n * a.d, a.d * b.d);
export const subtract = (a, b) => ratio(a.n * b.d - b.n * a.d, a.d * b.d);
export const multiply = (a, b) => ratio(a.n * b.n, a.d * b.d);
export const divide = (a, b) => ratio(a.n * b.d, a.d * b.n);
export const compare = (a, b) => a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
export function number(value) {
  if (value.n === 0n) return 0;
  const denominatorText = value.d.toString();
  if (/^10*$/.test(denominatorText)) return Number(`${value.n}e-${denominatorText.length - 1}`);
  const directNumerator = Number(value.n), directDenominator = Number(value.d);
  if (Number.isFinite(directNumerator) && Number.isFinite(directDenominator) && directDenominator !== 0) {
    return directNumerator / directDenominator;
  }
  const negative = value.n < 0n;
  const numerator = (negative ? -value.n : value.n).toString();
  const denominator = value.d.toString();
  const leading = text => Number(text.slice(0, 16)) / 10 ** Math.min(text.length, 16);
  const amount = leading(numerator) / leading(denominator) * 10 ** (numerator.length - denominator.length);
  return negative ? -amount : amount;
}
export const text = value => value.d === 1n ? value.n.toString() : `${value.n}/${value.d}`;
export const record = value => ({numerator: value.n.toString(), denominator: value.d.toString(), display: text(value)});
