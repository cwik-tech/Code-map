// Validate isolated parser output before symbolic operands enter the graph.
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');
const line = (v) => Number.isInteger(v) && v > 0;
export const validFailure = (v) => record(v) && line(v.line) && ['throws', 'error-value', 'ok-false', 'status'].includes(v.kind)
  && strings(v.targets) && strings(v.expectedTargets);
const exit = (v) => record(v) && line(v.line) && ['throw', 'catch', 'exit'].includes(v.kind)
  && (!Object.hasOwn(v, 'probe') || v.probe === null || line(v.probe));
const binding = (v) => record(v) && typeof v.module === 'string' && Number.isInteger(v.level) && v.level >= 0 && typeof v.imported === 'string';
const call = (v) => record(v) && typeof v.callee === 'string' && Array.isArray(v.arguments) && v.arguments.every(strings)
  && record(v.keywords) && Object.values(v.keywords).every(strings);
export const validFailureBindings = (v) => record(v) && Object.values(v).every(binding);
export const validFailureFacts = (v) => Array.isArray(v) && v.every((f) => record(f) && typeof f.name === 'string' && line(f.line)
  && (f.factory === null || typeof f.factory === 'string') && strings(f.parameters) && record(f.bindings) && Object.values(f.bindings).every(binding) && strings(f.blocked)
  && typeof f.fixture === 'boolean' && Number.isInteger(f.assertions) && f.assertions >= 0 && strings(f.references)
  && Array.isArray(f.failures) && f.failures.every(validFailure) && Array.isArray(f.exits) && f.exits.every(exit)
  && Array.isArray(f.calls) && f.calls.every(call) && strings(f.smells) && f.smells.every((s) => ['swallowed-error', 'fixed-wait'].includes(s)));
