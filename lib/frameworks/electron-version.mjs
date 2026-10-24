// Conservative npm range lower bounds. Prereleases, tags, URLs and unsupported syntax stay UNKNOWN.
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const partial = (text) => {
  const match = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i.exec(text);
  if (!match || (/[x*]/i.test(match[2] ?? '') && /^\d+$/.test(match[3] ?? ''))) return null;
  const precision = !match[2] || /[x*]/i.test(match[2]) ? 1 : !match[3] || /[x*]/i.test(match[3]) ? 2 : 3;
  const value = [Number(match[1]), precision >= 2 ? Number(match[2]) : 0, precision === 3 ? Number(match[3]) : 0];
  return value.every(Number.isSafeInteger) ? { value, precision } : null;
};
const increment = (value, index) => value.map((part, i) => i < index ? part : i === index ? part + 1 : 0);

/** Lowest major allowed by every range alternative. An unreadable alternative makes the result unknown. */
export function electronMajor(range) {
  if (typeof range !== 'string') return null;
  const minima = [];
  for (const alternative of range.trim().split(/\s*\|\|\s*/)) {
    let lower = [0, 0, 0], upper = null, inclusive = false;
    const setLower = (value) => { if (compare(value, lower) > 0) lower = value; };
    const setUpper = (value, closed = false) => {
      if (!upper || compare(value, upper) < 0) { upper = value; inclusive = closed; }
      else if (compare(value, upper) === 0) inclusive = inclusive && closed;
    };
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(alternative);
    const text = hyphen ? `>=${hyphen[1]} <=${hyphen[2]}` : alternative;
    for (const token of text.replace(/([<>]=?|[=~^])\s+/g, '$1').split(/\s+/)) {
      if (token === '*' || /^x$/i.test(token)) continue;
      const match = /^(>=|>|<=|<|=|~|\^)?(.+)$/.exec(token), parsed = partial(match?.[2] ?? '');
      if (!parsed) return null;
      const { value, precision } = parsed, operator = match[1] ?? '';
      if (operator === '<') setUpper(value);
      else if (operator === '<=') setUpper(precision === 3 ? value : increment(value, precision - 1), precision === 3);
      else if (operator === '>') setLower(increment(value, precision - 1));
      else {
        setLower(value);
        if (operator === '~') setUpper(increment(value, precision === 1 ? 0 : 1));
        else if (operator === '^') setUpper(increment(value, value[0] > 0 || precision === 1 ? 0 : value[1] > 0 || precision === 2 ? 1 : 2));
        else if (operator !== '>=') setUpper(precision === 3 ? value : increment(value, precision - 1), precision === 3);
      }
    }
    if (!upper || compare(lower, upper) < 0 || (inclusive && compare(lower, upper) === 0)) minima.push(lower[0]);
  }
  return minima.length ? Math.min(...minima) : null;
}
