// Deterministic corpus mutations and combined coverage and outcome feedback.
import { generate } from './generator.mjs';
/** Mutates a retained input within its generator domain with an injected random source. */
export function mutate(schema, value, random) {
  if (schema.type === 'boolean') return !value;
  if (schema.type === 'integer') return Math.max(schema.min, Math.min(schema.max, value + (random() < 0.5 ? -1 : 1)));
  if (schema.type === 'string') {
    const at = Math.floor(random() * Math.max(1, value.length));
    const char = schema.alphabet[Math.floor(random() * schema.alphabet.length)];
    return value.length ? value.slice(0, at) + char + value.slice(at + 1) : generate(schema, random);
  }
  if (schema.type === 'array') {
    if (!value.length) return generate(schema, random);
    const at = Math.floor(random() * value.length);
    return value.map((item, index) => index === at ? mutate(schema.items, item, random) : item);
  }
  const keys = Object.keys(schema.properties);
  if (!keys.length) return value;
  const key = keys[Math.floor(random() * keys.length)];
  return { ...value, [key]: mutate(schema.properties[key], value[key], random) };
}
/** Outcome identity includes the error class, output type and touched paths. Pure. */
export function outcomeClass(result) {
  const output = result.output;
  const type = output === null ? 'null' : Array.isArray(output) ? 'array' : typeof output === 'object' ? output.$type ?? 'object' : typeof output;
  return JSON.stringify({ status: result.status, error: result.error?.name ?? null, rejections: [...new Set((result.effects?.rejections ?? []).map((error) => error.name))].sort(), type: result.status === 'returned' ? type : null,
    files: (result.effects?.files ?? []).map(({ path, change }) => [path, change]) });
}

/** Retains an input when it adds a block or an outcome class. Pure. */
export function retainCoverage(corpus, input, result) {
  const outcome = outcomeClass(result), classes = new Set(corpus.classes), blocks = new Set(corpus.blocks);
  const addedBlocks = (result.coverage?.blocks ?? []).filter(block => !blocks.has(block));
  const newClass = !classes.has(outcome);
  if (!newClass && !addedBlocks.length) return corpus;
  addedBlocks.forEach(block => blocks.add(block));
  if (blocks.size > 10000) throw new Error('Fuzz coverage exceeds 10000 blocks');
  classes.add(outcome);
  const seeds = [...corpus.seeds, { input, outcome }];
  return { ...corpus, size: seeds.length, seeds, classes: [...classes], blocks: [...blocks].sort() };
}
