// Validate the isolated parser's API boundary before any fact joins the graph.
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');
const nullable = (v) => v === null || typeof v === 'string';
const defaultValue = (v) => record(v) && typeof v.exists === 'boolean' && (!Object.hasOwn(v, 'literal') || typeof v.literal === 'string');
const parameter = (v) => record(v) && typeof v.name === 'string'
  && ['positional-only', 'positional-or-keyword', 'var-positional', 'keyword-only', 'var-keyword'].includes(v.kind)
  && nullable(v.annotation) && defaultValue(v.default);
const signature = (v) => record(v) && Array.isArray(v.parameters) && v.parameters.every(parameter)
  && nullable(v.returns) && typeof v.async === 'boolean' && strings(v.decorators);
const signatures = (v) => Array.isArray(v) && v.every(signature);
const binding = (v) => record(v) && ['local', 'name', 'module'].every((k) => typeof v[k] === 'string')
  && Number.isInteger(v.level) && Number.isInteger(v.line) && typeof v.explicit === 'boolean';
const shape = (v) => record(v) && (Object.hasOwn(v, 'signatures') ? signatures(v.signatures)
  : Object.hasOwn(v, 'annotation') ? nullable(v.annotation)
    : strings(v.bases) && strings(v.keywords) && strings(v.decorators) && record(v.methods) && Object.values(v.methods).every(signatures)
      && Array.isArray(v.fields) && v.fields.every((f) => record(f) && typeof f.name === 'string' && nullable(f.annotation) && defaultValue(f.default)));
export const validPublicApi = (v) => record(v) && ['KNOWN', 'UNKNOWN'].includes(v.state) && nullable(v.reason)
  && strings(v.unknownNames) && strings(v.uncertainty) && Array.isArray(v.bindings) && v.bindings.every(binding)
  && Array.isArray(v.hidden) && Array.isArray(v.exports) && [...v.exports, ...v.hidden].every((e) => record(e) && typeof e.name === 'string' && Number.isInteger(e.line)
    && (e.kind === 'reexport' ? binding(e.binding) : ['class', 'function', 'variable'].includes(e.kind) && shape(e.shape) && Number.isInteger(e.localReferences)));
export const validApiCalls = (v) => Array.isArray(v) && v.every((c) => record(c) && typeof c.name === 'string'
  && Number.isInteger(c.line) && Number.isInteger(c.column) && Number.isInteger(c.positional) && strings(c.keywords) && nullable(c.reason));
