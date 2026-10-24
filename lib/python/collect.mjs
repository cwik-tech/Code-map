import { pythonApi, applyPythonStubs, pythonBindings } from './api.mjs';
// Converts isolated Python AST facts to the shared graph and declaration interface.
import { pythonFailureLinks } from './failure-links.mjs';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { lineCount } from '../git.mjs';
import { ignored, underRoots } from '../project.mjs';
import { findInterpreter } from './interpreter.mjs';
import { parsePython, pythonLimits } from './parse.mjs';
import { pythonRoots, pythonTestSelector } from './project.mjs';

export function collectPython(paths, texts, config, read, repository) {
  const candidates = paths.filter((p) => /\.pyi?$/.test(p) && !ignored(p));
  if (!candidates.length) return { files: [], testFacts: [], report: null, roots: [], outside: [] };
  const choice = findInterpreter(config.python?.interpreter, repository);
  if (choice.state !== 'KNOWN') return { files: [], testFacts: [], roots: [], outside: [], report: { ...choice, limits: pythonLimits } };
  for (const [path, text] of read(candidates)) texts.set(path, text);
  const configs = Object.fromEntries(['pytest.ini', 'pyproject.toml', 'setup.cfg'].filter((p) => texts.has(p)).map((p) => [p, texts.get(p)]));
  const parsed = parsePython(choice.interpreter, candidates.filter((path) => texts.has(path)).map((path) => ({ path, text: texts.get(path) })), configs);
  const roots = pythonRoots(paths, config, texts.get('pyproject.toml'));
  const { isTest, defaultCollected } = pythonTestSelector(parsed.settings), stdlib = new Set(parsed.stdlib);
  let optionalUnresolvedImports = 0;
  const modules = new Map(), namespaces = new Set();
  const names = new Map();
  for (const path of candidates) {
    for (const root of [...roots].sort((a, b) => b.length - a.length)) {
      if (!underRoots(path, [root])) continue;
      const name = posix.relative(root, path).replace(/\.pyi?$/, '').replace(/-stubs(?=\/|$)/g, '').replace(/(?:^|\/)__init__$/, '').split('/').filter(Boolean).join('.');
      if (!name) continue;
      if (!names.has(path)) names.set(path, name);
      if (!modules.has(name) || path.endsWith('.py') && modules.get(name).endsWith('.pyi')) modules.set(name, path);
      const parts = name.split('.');
      for (let i = 1; i < parts.length; i++) namespaces.add(parts.slice(0, i).join('.'));
    }
  }
  const local = new Set([...modules.keys(), ...namespaces].map((name) => name.split('.')[0]));
  const resolve = (path, item) => {
    if (item.module === null) return [{ target: null, specifier: null, classification: 'dynamic', unresolvedLocal: false }];
    let module = item.module, invalid = false;
    if (item.level) {
      const own = names.get(path) ?? '', parts = own.split('.');
      if (!/\/__init__\.pyi?$/.test(path)) parts.pop();
      invalid = item.level > parts.length;
      module = [...parts.slice(0, Math.max(0, parts.length - item.level + 1)), ...module.split('.').filter(Boolean)].join('.');
    }
    const specifier = '.'.repeat(item.level) + item.module;
    if (!invalid && !modules.has(module) && namespaces.has(module) && item.names.length) return item.names.map((name) => {
      const target = modules.get(`${module}.${name}`) ?? null;
      return { target, specifier, classification: 'local', unresolvedLocal: !target && name !== '*', pythonName: name, pythonNamespace: Boolean(target) };
    });
    const targets = item.names.filter((name) => name !== '*').map((name) => modules.get(`${module}.${name}`)).filter(Boolean);
    if (!targets.length && modules.has(module) && !invalid) targets.push(modules.get(module));
    const classification = item.level || local.has(module.split('.')[0]) ? 'local' : stdlib.has(module.split('.')[0]) ? 'stdlib' : 'third-party';
    return (invalid || !targets.length ? [null] : [...new Set(targets)]).map((target) => ({ target, specifier, classification,
      unresolvedLocal: classification === 'local' && !target && (invalid || item.names.length > 0 || !namespaces.has(module)),
      pythonNamespace: Boolean(target) && item.names.some((name) => modules.get(`${module}.${name}`) === target) }));
  };
  const convert = (raw) => {
    const path = raw.path, text = texts.get(path), uses = {}, valueUses = {};
    if (raw.errors.length) raw.publicApi = { ...raw.publicApi, state: 'UNKNOWN', reason: 'syntax-error' };
    const api = pythonApi(raw, resolve);
    const edges = raw.imports.flatMap((item) => {
      const resolved = resolve(path, item);
      if (item.optional && resolved.some((edge) => edge.unresolvedLocal)) optionalUnresolvedImports++;
      return resolved.filter((edge) => edge.target !== path).map((edge) => ({ ...edge,
        optional: item.optional, unresolvedLocal: edge.unresolvedLocal && !item.optional,
        kind: 'value', mode: item.dynamic ? 'dynamic' : 'static', line: item.line, typeNames: [], valueNames: edge.pythonNamespace ? ['*'] : item.names.length ? item.names : ['*'],
        python: { level: item.level, module: item.module, names: item.names } }));
    });
    for (const edge of edges) if (edge.target) { uses[edge.target] = [...new Set([...(uses[edge.target] ?? []), ...edge.valueNames])]; valueUses[edge.target] = uses[edge.target]; }
    const declaration = (d, top = false) => ({ name: d.name, kind: d.kind, start: d.start, end: d.end, exported: top && api.exports.includes(d.name), planned: false, comment: '', decorators: d.decorators,
      async: d.async, children: d.children.map((child) => declaration(child)), metrics: { lines: d.end - d.start + 1, internalDependencies: [], hookCalls: [], failureExits: [], references: [],
        ...(d.complexity ? { complexity: d.complexity } : {}) } });
    return { path, language: 'python', contentDigest: createHash('sha256').update(text).digest('hex'), lines: lineCount(text),
      header: '', imports: [...new Set(edges.map((e) => e.target).filter(Boolean))].sort(), edges, uses, valueUses,
      externals: [...new Set(edges.filter((e) => e.classification !== 'local' && e.specifier).map((e) => e.specifier))],
      ...api, declarations: raw.definitions.map((d) => declaration(d, true)), patterns: [],
      python: { module: names.get(path), all: raw.all, names: raw.names, publicApi: { ...raw.publicApi, bindings: pythonBindings(raw, resolve) }, apiCalls: raw.apiCalls, packageSites: raw.packageSites },
      syntax: { errors: raw.errors.length, diagnostics: raw.errors },
      ...(isTest(path) ? { testScan: { framework: 'pytest/unittest', defaultCollected: defaultCollected(path), cases: raw.cases, mocks: [], fetch: false } } : {}) };
  };
  const files = applyPythonStubs(parsed.files.map(convert));
  pythonFailureLinks(parsed.files, files, resolve, modules, isTest, texts);
  const unread = candidates.filter((path) => !texts.has(path)).map((path) => ({ path, reason: 'Python source text is unavailable.' }));
  return { allFiles: files, parsedPaths: parsed.files.map((f) => f.path), files: files.filter((f) => !isTest(f.path) && underRoots(f.path, roots)), testFacts: files.filter((f) => isTest(f.path)), roots, outside: candidates.filter((p) => !isTest(p) && !underRoots(p, roots)),
    report: { ...choice, roots, limits: pythonLimits, retries: parsed.retries, optionalUnresolvedImports, skipped: [...parsed.errors, ...unread],
      state: parsed.errors.length || unread.length ? 'UNKNOWN' : 'KNOWN', reason: parsed.errors.length ? 'Some Python files exceeded parser limits or failed parsing.' : null } };
}
