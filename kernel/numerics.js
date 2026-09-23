// An absolute allowance must not erase the entire demand of a small flow.
export function balanceTolerance(magnitude) {
  return Math.max(Math.min(1e-7, magnitude * 1e-7), magnitude * Number.EPSILON * 16);
}

export function diagnosticNumber(value) {
  return String(Number(value.toPrecision(6)));
}

// Scale equations, not variables or integer counts. Bound coefficient growth to avoid
// turning a small-rate recovery into an ill-conditioned model with huge coefficients.
export function scaleConstraintRows(text, requestedScale = 1e6) {
  let constraints = false;
  return text.split('\n').map(line => {
    if (line === 'Subject To') {constraints = true; return line;}
    if (line === 'Bounds') {constraints = false; return line;}
    if (!constraints) return line;
    const match = line.match(/^([^:]+): (.+) (<=|>=|=) (\S+)$/);
    if (!match) throw new Error('The generated constraint could not be scaled.');
    const [, label, expression, relation, right] = match;
    const tokens = expression.trim().split(/\s+/), terms = [];
    for (let index = 0; index < tokens.length;) {
      let sign = 1;
      if (tokens[index] === '-' || tokens[index] === '+') sign = tokens[index++] === '-' ? -1 : 1;
      const numeric = Number(tokens[index]);
      const coefficient = Number.isFinite(numeric) ? numeric * sign : sign;
      if (Number.isFinite(numeric)) index++;
      const variable = tokens[index++];
      if (!variable || !/^[a-z][a-z0-9_]*$/i.test(variable)) throw new Error('The generated variable could not be scaled.');
      terms.push([variable, coefficient]);
    }
    const rhs = Number(right);
    const largest = terms.reduce((maximum, [, coefficient]) => Math.max(maximum, Math.abs(coefficient)), Math.abs(rhs));
    const scale = Math.max(1, Math.min(requestedScale, largest ? 1e12 / largest : 1));
    return `${label}: ${terms.map(([variable, coefficient]) => `${coefficient < 0 ? '-' : '+'} ${Math.abs(coefficient) * scale} ${variable}`).join(' ')} ${relation} ${rhs * scale}`;
  }).join('\n');
}
