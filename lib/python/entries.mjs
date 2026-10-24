// Python entries reuse shared path starts. Declaration strings are never executed.
import { posix } from 'node:path';

export function pythonEntries(files, declarations, startedPaths) {
  const entries = new Set(), unknown = declarations.unknown.filter((u) => /entry|setup keyword|dynamic project|packaging-parser|invalid packaging|input-unavailable/.test(u.reason)).map((u) => ({ ...u, reason: 'entry-not-mapped' }));
  const names = new Set([...declarations.declarations.map((d) => d.name), ...files.flatMap((f) => (f.edges ?? []).filter((e) => e.classification === 'third-party' && e.specifier).map((e) => e.specifier.split('.')[0]))]);
  const modules = new Map(files.map((f) => [f.python?.module, f.path]));
  for (const item of declarations.entries) {
    const module = /^([A-Za-z_]\w*(?:\.\w+)*)\s*(?::|$)/.exec(item.target)?.[1];
    const target = modules.get(module);
    if (target) entries.add(target);
    else unknown.push({ path: item.path, reason: 'entry-not-mapped', module: module ?? null });
  }
  for (const item of startedPaths?.entries ?? []) if (item.path.endsWith('.py')) entries.add(item.path);
  for (const file of files) {
    const path = file.path, base = posix.basename(path);
    if (['__main__.py', 'conftest.py', 'manage.py', 'setup.py', 'noxfile.py', 'fabfile.py', 'wsgi.py', 'asgi.py'].includes(base)
      || /(?:^|\/)(?:scripts|bin)\//.test(path) || file.python?.packageSites?.guards.length) entries.add(path);
    if (names.has('django') && /(?:^|\/)(?:(?:settings|urls|admin|apps|models)\.py|migrations\/.*\.py)$/.test(path)) entries.add(path);
    if (names.has('alembic') && /(?:^|\/)(?:alembic|migrations)\/(?:env\.py|versions\/.*\.py)$/.test(path)) entries.add(path);
  }
  return { entries, unknown };
}
