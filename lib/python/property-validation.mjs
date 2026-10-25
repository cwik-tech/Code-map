// Validate the isolated parser's Hypothesis extension at the process boundary.
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.length <= 8192;
const fact = (v) => record(v) && (v.integerText === undefined || v.integerText === true && typeof v.value === 'string' && /^-?\d+$/.test(v.value)) && (v.state === 'UNKNOWN' ? text(v.reason) : v.state === 'literal'
  && (v.value === null || ['string', 'boolean'].includes(typeof v.value) || typeof v.value === 'number' && Number.isFinite(v.value)
    || Array.isArray(v.value) && v.value.every(text)));
const settings = (v) => record(v) && Object.values(v).every(fact);
export function validProperties(v) {
  return record(v) && Array.isArray(v.tests) && Array.isArray(v.profiles) && Array.isArray(v.loads) && v.loads.every(fact)
    && v.profiles.every((p) => record(p) && fact(p.name) && settings(p.settings))
    && v.tests.every((t) => record(t) && text(t.name) && text(t.suite) && text(t.invariant) && Number.isInteger(t.assertions) && t.assertions >= 0 && Number.isInteger(t.line)
      && ['given', 'stateful'].includes(t.kind) && settings(t.settings) && (t.seed === null || fact(t.seed))
      && Array.isArray(t.generators) && t.generators.every((g) => record(g) && text(g.argument) && text(g.source))
      && Array.isArray(t.examples) && t.examples.every(text)
      && Array.isArray(t.rules) && t.rules.every((r) => record(r) && text(r.name) && text(r.source) && Number.isInteger(r.line)));
}
