// Bounded stable JSON values. Ordinary objects have a tag to prevent special-value collisions.
/** Sorts object keys and tags values that JSON cannot preserve. Throws on excessive size or cycles. */
export function stable(value, ignoreFields = [], depth = 0, budget = { nodes: 0 }, seen = new Set()) {
  if (depth > 30 || ++budget.nodes > 10000) throw new Error('Output exceeds the normalization limit');
  if (value === undefined) return { $type: 'undefined' };
  if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) return { $type: 'number', value: Object.is(value, -0) ? '-0' : String(value) };
  if (typeof value === 'bigint') return { $type: 'bigint', value: String(value) };
  if (typeof value === 'function' || typeof value === 'symbol') throw new Error('Output contains an unsupported value');
  if (typeof value === 'string' && value.length > 65536) throw new Error('Output text exceeds 65536 characters');
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) throw new Error('Output contains a cycle');
  seen.add(value);
  const recur = (x) => stable(x, ignoreFields, depth + 1, budget, seen);
  let result;
  if (value instanceof Date) result = { $type: 'date', value: value.toISOString() };
  else if (value instanceof Error) result = { $type: 'error', name: recur(value.name), message: recur(value.message) };
  else if (Array.isArray(value)) {
    if (value.length > 10000) throw new Error('Output array exceeds 10000 values');
    result = value.map(recur);
  } else {
    const keys = Object.keys(value).filter((key) => !ignoreFields.includes(key)).sort();
    if (keys.length > 10000) throw new Error('Output object exceeds 10000 keys');
    result = { $type: 'object', value: Object.fromEntries(keys.map((key) => [key, recur(value[key])])) };
  }
  seen.delete(value);
  return result;
}
