// Adapt Python public facts and stub precedence to the shared export interface.
import { digestOf } from '../api-signatures.mjs';

export function pythonBindings(raw, resolve) {
  return raw.publicApi.bindings.map((b) => {
    const edge = resolve(raw.path, { module: b.module, level: b.level, names: b.name === '*' ? [] : [b.name] })[0];
    return { ...b, target: edge?.target ?? null, importedName: edge?.pythonNamespace ? '*' : b.name };
  });
}

export function pythonApi(raw, resolve) {
  const api = raw.publicApi, bindings = pythonBindings(raw, resolve);
  const signatures = [...api.exports, ...api.hidden].map((e) => {
    if (e.kind === 'reexport') {
      const b = bindings.find((binding) => binding.local === e.binding.local && binding.line === e.binding.line);
      const from = { target: b.target, specifier: '.'.repeat(b.level) + b.module, name: b.importedName };
      return { name: e.name, kind: 'reexport', from, text: e.name, digest: digestOf(JSON.stringify(from)), inferred: false };
    }
    const text = JSON.stringify(e.shape), overloads = e.shape.signatures?.length ?? 0;
    return { name: e.name, kind: e.kind, ...(api.hidden.includes(e) ? { hidden: true } : {}), text: text.slice(0, 300), digest: digestOf(text), inferred: false,
      ...(text.length > 300 ? { truncated: true } : {}), ...(overloads > 1 ? { overloads } : {}), python: e.shape };
  });
  for (const name of api.unknownNames) signatures.push({ name, kind: 'unknown', text: name, digest: digestOf(name), inferred: true, pythonUnknown: 'undefined-__all__-name' });
  const exportDetails = api.exports.map((e) => ({ name: e.name, category: 'value', typeOnly: false,
    localName: e.name, line: e.line, localReferences: e.localReferences ?? 0 }));
  return { exports: api.exports.map((e) => e.name), exportDetails, signatures,
    reexports: signatures.filter((s) => s.from).map((s) => ({ ...s.from, name: s.name, imported: s.from.name })) };
}

export function applyPythonStubs(files) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const used = new Set();
  for (const file of files.filter((f) => f.path.endsWith('.py'))) {
    const adjacent = file.path.replace(/\.py$/, '.pyi');
    const matching = files.filter((f) => f.path.endsWith('.pyi') && f.path.includes('-stubs/') && f.python.module === file.python.module);
    const stub = byPath.get(adjacent) ?? (matching.length === 1 ? matching[0] : null);
    if (!stub && matching.length > 1) file.python.publicApi = { ...file.python.publicApi, state: 'UNKNOWN', reason: 'ambiguous-stub' };
    if (!stub) continue;
    used.add(stub.path);
    const overrides = new Map(stub.signatures.map((s) => [s.name, s]));
    file.signatures = file.signatures.map((s) => overrides.has(s.name)
      ? { ...overrides.get(s.name), hidden: s.hidden ?? false, signatureSource: stub.path } : { ...s, kind: 'unknown', pythonUnknown: 'stub-name-missing', signatureSource: stub.path });
    if (stub.syntax.errors || stub.python.publicApi.state === 'UNKNOWN') {
      file.python.publicApi = { ...file.python.publicApi, state: 'UNKNOWN', reason: 'stub-unavailable' };
    }
  }
  return files.filter((f) => !used.has(f.path));
}

/** null is compatible. Annotation changes are textual leads, never a type verdict. */
export function pythonChange(before, after) {
  if (before.pythonUnknown || after.pythonUnknown) return { status: 'UNKNOWN', reasons: ['python-signature-unknown'] };
  if (!before.python || !after.python) return undefined;
  if (before.kind !== after.kind) return { status: 'CHANGED', reasons: ['kind'] };
  if (JSON.stringify(before.python) === JSON.stringify(after.python)) return null;
  if (before.kind === 'class' && compatibleClass(before.python, after.python)) return null;
  const a = before.python.signatures, b = after.python.signatures;
  if (a && b && a.every((old) => b.some((now) => compatibleSignature(old, now)))) return null;
  return { status: 'CHANGED', reasons: ['python-signature'] };
}

function compatibleClass(before, after) {
  if (['bases', 'keywords', 'decorators', 'fields'].some((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))) return false;
  const bind = (s) => ({ ...s, parameters: s.decorators.some((d) => /(?:^|\.)staticmethod$/.test(d)) || s.parameters[0]?.kind.startsWith('var-') ? s.parameters : s.parameters.slice(1) });
  const empty = { parameters: [], returns: null, async: false, decorators: [] };
  const constructors = (shape) => shape.methods.__init__?.map(bind) ?? [empty];
  if (!constructors(before).every((old) => constructors(after).some((now) => compatibleSignature(old, now)))) return false;
  return Object.entries(before.methods).filter(([name]) => name !== '__init__').every(([name, signatures]) => {
    const current = Object.hasOwn(after.methods, name) ? after.methods[name] : undefined;
    return current && signatures.every((old) => current.some((now) => compatibleSignature(bind(old), bind(now))));
  });
}

function compatibleSignature(before, after) {
  if (before.returns !== after.returns || before.async !== after.async || JSON.stringify(before.decorators) !== JSON.stringify(after.decorators)) return false;
  const old = before.parameters, now = after.parameters;
  // An optional positional addition is safe only after all existing positional parameters.
  const matched = new Set();
  for (let i = 0; i < old.length; i++) {
    const a = old[i], b = a.kind === 'positional-only' ? now[i] : a.kind.startsWith('var-') ? now.find((p) => p.kind === a.kind) : now.find((p) => p.name === a.name);
    if (b) matched.add(b);
    if (!b || a.annotation !== b.annotation || a.default.exists && !b.default.exists) return false;
    if (a.kind !== b.kind && !(['positional-only', 'keyword-only'].includes(a.kind) && b.kind === 'positional-or-keyword')) return false;
    if (['positional-only', 'positional-or-keyword'].includes(a.kind) && now.indexOf(b) !== i) return false;
  }
  return now.every((p) => matched.has(p) || p.default.exists || ['var-positional', 'var-keyword'].includes(p.kind));
}

/** Argument binding for one statically known call. */
export function pythonCall(site, record) {
  const shape = record?.python;
  let signatures = shape?.signatures ?? shape?.methods?.__init__?.map((s) => ({ ...s, parameters: s.parameters.slice(1) }));
  const dataclass = shape?.decorators?.find((d) => /(?:^|\.)dataclass\b/.test(d));
  const uncertainClass = shape?.keywords?.length || shape?.methods?.__new__ || dataclass && (/init\s*=\s*False/.test(dataclass) || shape.bases.length
    || /kw_only\s*=/.test(dataclass) && !/kw_only\s*=\s*(?:True|False)\b/.test(dataclass)
    || shape.fields.some((f) => f.default.exists && !Object.hasOwn(f.default, 'literal')));
  if (uncertainClass) return { compatibility: 'UNKNOWN', reason: 'dynamic-constructor', likelyBreak: null };
  if (!signatures && record?.kind === 'class' && shape?.fields?.length && dataclass) {
    const keyword = shape.decorators.some((d) => /kw_only\s*=\s*True/.test(d));
    signatures = [{ parameters: shape.fields.map((f) => ({ ...f, kind: keyword ? 'keyword-only' : 'positional-or-keyword' })) }];
  }
  if (!signatures && record?.kind === 'class' && shape && !shape.bases.length && !shape.decorators.length) signatures = [{ parameters: [] }];
  const variadicConstructor = shape?.methods?.__init__?.some((s) => s.parameters.some((p) => p.kind.startsWith('var-')));
  if (site.reason || variadicConstructor || !signatures || signatures.some((s) => s.parameters.some((p) => p.kind.startsWith('var-')))) return { compatibility: 'UNKNOWN', reason: site.reason ?? 'dynamic-signature', likelyBreak: null };
  const accepts = (s) => {
    const positional = s.parameters.filter((p) => p.kind !== 'keyword-only');
    if (site.positional > positional.length) return false;
    const bound = new Set(positional.slice(0, site.positional).map((p) => p.name));
    for (const keyword of site.keywords) {
      if (bound.has(keyword) || !s.parameters.some((p) => p.name === keyword && p.kind !== 'positional-only')) return false;
      bound.add(keyword);
    }
    return s.parameters.every((p) => p.default.exists || bound.has(p.name));
  };
  const likelyBreak = !signatures.some(accepts);
  return { compatibility: likelyBreak ? 'INCOMPATIBLE' : 'COMPATIBLE', likelyBreak };
}
