// Seeded generation and bounded domain-preserving shrink candidates. Pure.
/** Mulberry32 version 1. The returned function yields numbers in [0, 1). */
export function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
/** Generates one value from a validated generator and an injected random source. */
export function generate(schema, random, budget = { nodes: 0 }) {
  if (++budget.nodes > 10000) throw new Error('Generated input exceeds 10000 values');
  const size = (min, max) => min + Math.floor(random() * (max - min + 1));
  if (schema.type === 'integer') return size(schema.min, schema.max);
  if (schema.type === 'boolean') return random() < 0.5;
  if (schema.type === 'string') return Array.from({ length: size(schema.minLength, schema.maxLength) }, () => schema.alphabet[size(0, schema.alphabet.length - 1)]).join('');
  if (schema.type === 'array') return Array.from({ length: size(schema.minLength, schema.maxLength) }, () => generate(schema.items, random, budget));
  return Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, generate(value, random, budget)]));
}
/** Small candidates only. Every candidate stays in the declared generator domain. */
export function shrink(schema, value) {
  if (schema.type === 'integer') {
    const target = Math.max(schema.min, Math.min(schema.max, 0));
    return [...new Set([target, Math.trunc((value + target) / 2)])].filter((x) => x !== value && Math.abs(x - target) < Math.abs(value - target));
  }
  if (schema.type === 'string' || schema.type === 'array') {
    const lengths = [...new Set([schema.minLength, Math.max(schema.minLength, Math.floor(value.length / 2))])];
    return lengths.filter((n) => n < value.length).map((n) => value.slice(0, n));
  }
  if (schema.type === 'object') return Object.entries(schema.properties).flatMap(([key, child]) => shrink(child, value[key]).map((x) => ({ ...value, [key]: x })));
  return value ? [false] : [];
}
