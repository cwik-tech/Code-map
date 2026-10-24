// Python package evidence joins the shared package report. No npm checks run on Python.
import { posix } from 'node:path';
import { ignored } from '../project.mjs';
import { configPath, readPythonDeclarations } from './declarations.mjs';
import { distributionImports } from './distribution-names.mjs';
import { installedPythonDistributions } from './installed.mjs';
import { pythonOrphans } from './orphans.mjs';

const tool = /^(?:types-|pytest[-_]|flake8[-_])|^(?:pytest|mypy|ruff|black|isort|tox|nox|coverage|setuptools|wheel|hatchling|hatch|poetry-core|pdm-backend|flit-core|uv|build|twine|pip|pip-tools|flake8|pyright|pylint|autopep8|bandit)$|-stubs$/;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, name) => new RegExp(`(?:^|[^\\w.-])${escape(name)}(?:$|[^\\w-])`, 'i').test(text);
export function analyzePythonPackages({ repository, texts, files, sources, tests, interpreter, startedPaths, inputUnknown = [], paths = [] }) {
  const declarations = readPythonDeclarations(texts, interpreter);
  declarations.unknown.push(...inputUnknown);
  const installed = installedPythonDistributions(repository);
  const metadata = new Map();
  for (const d of installed.distributions) metadata.set(d.name, [...new Set([...(metadata.get(d.name) ?? []), ...d.imports])]);
  const distributionNames = [...new Set([...declarations.locked, ...metadata.keys(), ...Object.keys(distributionImports)])];
  const importsOf = (name) => [...new Set([name.replace(/-/g, '_'), ...(Object.hasOwn(distributionImports, name) ? distributionImports[name] : []), ...(metadata.get(name) ?? [])])];
  const matches = (specifier, name) => importsOf(name).some((n) => specifier === n || specifier.startsWith(n + '.'));
  const directEdgeMatches = (edge, name) => matches(edge.specifier, name)
    || (edge.python?.names ?? []).some((n) => n !== '*' && matches(`${edge.specifier}.${n}`, name));
  const edgeMatches = (edge, name) => {
    const imported = (edge.python?.names ?? []).filter((n) => n !== '*').map((n) => `${edge.specifier}.${n}`);
    return directEdgeMatches(edge, name)
      || (imported.length ? imported : [edge.specifier]).some((prefix) => importsOf(name).some((n) => n.startsWith(prefix + '.')));
  };
  const inFolder = (path, folder) => folder === '.' || path.startsWith(folder + '/');
  const manifests = declarations.manifests;
  const nearest = (path) => declarations.scopes.filter((s) => inFolder(path, s.folder)).sort((a, b) => b.folder.length - a.folder.length)[0]?.path;
  const testPaths = new Set(tests.map((f) => f.path));
  const leads = { undeclared: [], devOnly: [], unused: [], orphaned: [] }, unusedUnknown = [];
  const unknown = [...declarations.unknown, ...installed.unknown];
  const incomplete = inputUnknown.length > 0 || files.some((f) => f.syntax?.errors) || paths.some((p) => p.endsWith('.py') && !files.some((f) => f.path === p) && !ignored(p));
  if (!manifests.length) unknown.push({ path: null, reason: 'no-declarations' });
  for (const file of files) {
    const manifest = nearest(file.path);
    if (!manifest) continue;
    const scope = declarations.declarations.filter((d) => inFolder(file.path, d.folder));
    const uncertain = declarations.unknown.some((u) => !u.reason.includes('cycle') && (u.path === null || inFolder(file.path, posix.dirname(u.owner ?? u.path))));
    const groups = new Map();
    for (const edge of file.edges ?? []) {
      if (edge.classification !== 'third-party' || edge.optional || file.python?.packageSites?.suppressed.includes(edge.line)) continue;
      const specifier = edge.specifier;
      if (!specifier) continue;
      if ((file.python?.packageSites?.optional ?? []).some((s) => s.line === edge.line && s.module === edge.python?.module)) continue;
      if ((file.python?.packageSites?.mocked ?? []).some((s) => s.line === edge.line && s.module === edge.python?.module)) {
        unknown.push({ path: file.path, line: edge.line, state: 'UNKNOWN', reason: 'module-cache-interception', specifier }); continue;
      }
      const declared = scope.filter((d) => edgeMatches(edge, d.name));
      const isTest = testPaths.has(file.path) || /(?:^|\/)(?:scripts|bin)\/|(?:^|\/)(?:conftest|setup|noxfile|fabfile)\.py$/.test(file.path);
      const kind = !declared.length ? 'undeclared' : !isTest && declared.every((d) => d.group === 'development') ? 'devOnly' : null;
      if (!kind) continue;
      if (uncertain || inputUnknown.length || installed.unknown.length) { unknown.push({ path: file.path, reason: 'dependency-declarations-incomplete', specifier }); continue; }
      const inferred = distributionNames.filter((name) => directEdgeMatches(edge, name));
      if (!declared.length && inferred.length > 1) { unknown.push({ path: file.path, reason: 'ambiguous-distribution-name', specifier }); continue; }
      const name = declared[0]?.name ?? inferred[0];
      if (name === undefined) { unknown.push({ path: file.path, line: edge.line, state: 'UNKNOWN', reason: 'import-name-not-mapped', specifier }); continue; }
      const key = `${kind}:${name}`;
      if (!groups.has(key)) {
        const lead = { path: file.path, package: name, manifest, language: 'python', specifiers: [], lines: [], test: isTest, typeOnly: false, declaredBy: declared[0]?.path ?? null };
        groups.set(key, lead); leads[kind].push(lead);
      }
      const lead = groups.get(key);
      if (!lead.specifiers.includes(specifier)) lead.specifiers.push(specifier);
      if (!lead.lines.includes(edge.line)) lead.lines.push(edge.line);
    }
  }
  for (const d of declarations.declarations) {
    if (d.group !== 'main' || tool.test(d.name)) continue;
    const folder = d.folder, scoped = files.filter((f) => inFolder(f.path, folder));
    const names = importsOf(d.name);
    if (scoped.some((f) => f.edges.some((e) => e.specifier && edgeMatches(e, d.name)))) continue;
    if (scoped.some((f) => (f.python?.packageSites?.references ?? []).some((ref) => [d.name, ...names].some((n) => mentions(ref, n))))) continue;
    if (declarations.entries.some((e) => inFolder(e.path, folder) && names.some((n) => mentions(e.target, n)))) continue;
    if ([...texts].some(([path, text]) => inFolder(path, folder) && !manifests.includes(path) && configPath(path) && !path.endsWith('.py') && [d.name, ...names].some((n) => mentions(text, n)))) continue;
    if (declarations.references.some((r) => inFolder(r.path, folder) && [d.name, ...names].some((n) => mentions(r.text, n)))) continue;
    const sites = scoped.flatMap((f) => (f.python?.packageSites?.dynamic ?? []).filter((s) => !s.prefix || names.some((n) => n.startsWith(s.prefix) || s.prefix.startsWith(n))).map((s) => ({ path: f.path, line: s.line })));
    if (incomplete || unknown.length || sites.length) unusedUnknown.push({ package: d.name, manifest: d.path, state: 'UNKNOWN', reason: 'dependency-use-incomplete', sites });
    else leads.unused.push({ package: d.name, manifest: d.path, line: null, language: 'python' });
  }
  const orphans = pythonOrphans({ files, sources, declarations, startedPaths, texts, incomplete, manifestOf: nearest });
  leads.orphaned = orphans.orphaned;
  unknown.push(...orphans.entryUnknown);
  return { leads, unusedUnknown, orphans, report: { declarations: declarations.declarations, entries: declarations.entries,
    manifests: declarations.manifests, scopes: declarations.scopes, skipped: declarations.skipped, locked: declarations.locked,
    installed: installed.distributions, unknown } };
}
