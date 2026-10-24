// Bind syntax-only operands through phase 1 import resolution. No project code executes.
import { posix } from 'node:path';

const own = (value, key) => Object.hasOwn(value, key) ? value[key] : undefined;
const unique = (values) => [...new Set(values)].sort();
export function pythonFailureLinks(rawFiles, files, resolve, modules, isTest, texts) {
  const rawByPath = new Map(rawFiles.map((f) => [f.path, f]));
  const definitions = rawFiles.flatMap((file) => file.failureFacts.map((fn) => ({ ...fn, path: file.path })));
  const functions = new Map(definitions.map((fn) => [`${fn.path}#${fn.name}`, fn]));
  const byLine = new Map(definitions.map((fn) => [`${fn.path}:${fn.line}`, fn]));
  const eligible = new Set(files.filter((f) => isTest(f.path) || posix.basename(f.path) === 'conftest.py').map((f) => f.path));
  const incoming = new Map(), declared = new Map(), moduleNames = new Map();
  for (const file of files) for (const target of file.imports) {
    if (!incoming.has(target)) incoming.set(target, []);
    incoming.get(target).push(file.path);
  }
  for (const file of rawFiles) declared.set(file.path, new Set(file.definitions.map((d) => d.name)));
  for (const [name, path] of modules) if (!moduleNames.has(path)) moduleNames.set(path, name);
  // A helper module must have importers, and every importer must already be test-only.
  for (let depth = 0; depth < 4; depth++) for (const file of files) {
    const importers = incoming.get(file.path) ?? [];
    if (importers.length && importers.every((path) => eligible.has(path))) eligible.add(file.path);
  }
  const declarationNames = (path) => declared.get(path) ?? new Set();
  const reference = (path, fn, token, depth = 0) => {
    if (token.startsWith('$')) return token;
    if (token.startsWith('!')) return `${path}#${token.slice(1)}`;
    const [head, ...tail] = token.split('.');
    const binding = own(fn.bindings, head);
    if (fn.blocked.includes(head) && !binding) return null;
    if (!binding) return declarationNames(path).has(head) ? `${path}#${head}` : null;
    const item = { module: binding.module, level: binding.level, names: binding.imported === '*' ? [] : [binding.imported] };
    let edges = resolve(path, item).filter((e) => e.target), consumed = 0;
    if (binding.imported === '*') for (let count = tail.length - 1; count > 0; count--) {
      const nested = resolve(path, { module: [binding.module, ...tail.slice(0, count)].join('.'), level: binding.level, names: [] }).filter((e) => e.target);
      if (nested.length === 1) { edges = nested; consumed = count; break; }
    }
    if (edges.length !== 1) return null;
    let target = edges[0].target, name = binding.imported === '*' ? tail.slice(consumed).join('.') : [binding.imported, ...tail].join('.');
    if (binding.imported !== '*' && resolve(path, { module: [binding.module, binding.imported].filter(Boolean).join('.'), level: binding.level, names: [] }).some((e) => e.target === target)) name = tail.join('.');
    // import package.module as alias, and from package import module.
    for (let count = name.split('.').length - 1; count >= 1; count--) {
      const prefix = name.split('.').slice(0, count).join('.');
      const module = moduleNames.get(target);
      const child = module && modules.get(`${module}.${prefix}`);
      if (child) { target = child; name = name.split('.').slice(count).join('.'); break; }
    }
    if (!name) return null;
    const declaredName = name.split('.')[0];
    if (functions.has(`${target}#${name}`)) return declarationNames(target).has(declaredName) ? `${target}#${declaredName}` : `${target}#${name}`;
    if (declarationNames(target).has(declaredName)) return `${target}#${declaredName}`;
    // Follow explicit import re-exports. Stars and computed members stay unknown.
    const bindings = rawByPath.get(target)?.failureBindings;
    if (depth < 8 && bindings && Object.hasOwn(bindings, declaredName)) return reference(target, { bindings, blocked: [] }, name, depth + 1);
    return null;
  };
  const refs = (fn, tokens) => unique(tokens.map((token) => reference(fn.path, fn, token)).filter(Boolean));
  const direct = (fn) => ({ assertions: fn.assertions, references: refs(fn, fn.references), failures: fn.failures.map((f) => ({ ...f, targets: refs(fn, f.targets), expectedTargets: refs(fn, f.expectedTargets) })) });
  const bind = (tokens, args) => unique(tokens.flatMap((token) => token.startsWith('$') ? args[Number(token.slice(1))] ?? [] : [token]));
  const factoryFor = (fn, token) => {
    if (!token?.startsWith('$')) return null;
    const name = fn.parameters[Number(token.slice(1))], folder = posix.dirname(fn.path);
    if (!name) return null;
    const imported = reference(fn.path, { ...fn, blocked: [] }, name);
    const explicit = functions.get(imported);
    if (explicit?.fixture) return functions.get(`${explicit.path}#${explicit.factory}`);
    const fixtures = [...functions.values()].filter((f) => f.fixture && f.name === name && posix.basename(f.path) === 'conftest.py'
      && (folder === posix.dirname(f.path) || folder.startsWith(`${posix.dirname(f.path)}/`) || posix.dirname(f.path) === '.'));
    fixtures.sort((a, b) => b.path.length - a.path.length);
    const fixture = fixtures[0];
    return fixture?.factory ? functions.get(`${fixture.path}#${fixture.factory}`) : null;
  };
  const expand = (fn, active, seen, depth) => {
    const result = direct(fn);
    if (depth >= 4) return result;
    for (const call of fn.calls) {
      const target = reference(fn.path, fn, call.callee), helper = functions.get(target) ?? (depth === 0 ? factoryFor(fn, target) : null);
      const key = helper ? `${helper.path}#${helper.name}` : target;
      if (!helper || helper.fixture || !eligible.has(helper.path) || active.has(key) || texts.get(helper.path)?.length > 262144 || (!seen.has(key) && seen.size >= 32)) continue;
      seen.add(key);
      const child = expand(helper, new Set([...active, key]), seen, depth + 1);
      if (child.assertions === 0 && child.failures.length === 0) continue;
      const args = helper.parameters.map((name, i) => refs(fn, own(call.keywords, name) ?? call.arguments[i] ?? []));
      result.assertions += child.assertions;
      result.references.push(...bind(child.references, args));
      result.failures.push(...child.failures.map((f) => {
        const checked = new Set(f.targets.filter((token) => token.startsWith('$')).map((token) => Number(token.slice(1))));
        return { ...f, targets: bind(f.targets, args),
          expectedTargets: unique([...bind(f.expectedTargets, args), ...args.flatMap((arg, index) => checked.has(index) ? [] : arg)]) };
      }));
    }
    result.references = unique(result.references);
    return result;
  };
  for (const file of files) {
    const raw = rawByPath.get(file.path);
    const metrics = (d, prefix = '') => {
      const name = prefix + d.name, fn = byLine.get(`${file.path}:${d.start}`);
      const children = d.children.map((child) => metrics(child, `${name}.`));
      const references = unique([...(fn ? refs(fn, fn.references) : []), ...children.flatMap((c) => c.references)])
        .filter((r) => !r.startsWith('$') && r !== `${file.path}#${name}`);
      // The shared quality model summarizes top-level declaration ranges, including nested functions.
      const failureExits = [...new Map([...(fn?.exits ?? []), ...children.flatMap((c) => c.failureExits)].map((exit) => [exit.line, exit])).values()]
        .sort((a, b) => a.line - b.line);
      Object.assign(d.metrics, { references, failureExits });
      return { references, failureExits };
    };
    file.declarations.forEach((d) => metrics(d));
    if (!file.testScan) continue;
    file.testScan.cases = raw.cases.map((item) => {
      const fn = raw.failureFacts.find((f) => f.line === item.line);
      if (!fn) return item;
      const key = `${file.path}#${fn.name}`, facts = expand(byLine.get(`${file.path}:${item.line}`), new Set([key]), new Set(), 0);
      const clean = (tokens) => tokens.filter((r) => !r.startsWith('$'));
      return { ...item, assertions: facts.assertions,
        references: clean(facts.references), failures: facts.failures.map((f) => ({ ...f, targets: clean(f.targets), expectedTargets: clean(f.expectedTargets) })), smells: fn.smells };
    });
  }
}
