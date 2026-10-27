// No importer and no known entry is a lead only when loaders cannot reach the module.
import { posix } from 'node:path';
import { configPath } from './declarations.mjs';
import { pythonEntries } from './entries.mjs';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function pythonOrphans({ files, sources, declarations, startedPaths, texts, incomplete = false, manifestOf = () => null }) {
  const { entries, unknown: entryUnknown } = pythonEntries(files, declarations, startedPaths);
  const importers = new Set(files.flatMap((f) => f.imports));
  const dynamic = files.flatMap((f) => (f.python?.packageSites?.dynamic ?? []).map((site) => {
    const dots = /^\.+/.exec(site.prefix)?.[0].length ?? 0;
    const own = (f.python?.module ?? '').split('.');
    if (!/(?:^|\/)__init__\.py$/.test(f.path)) own.pop();
    const prefix = dots ? [...own.slice(0, Math.max(0, own.length - dots + 1)), site.prefix.slice(dots)].filter(Boolean).join('.') : site.prefix;
    return { ...site, prefix, via: f.path };
  }));
  const configs = [...texts].filter(([path]) => configPath(path));
  const orphaned = [], unknown = [];
  let entryFiles = 0;
  for (const file of sources) {
    if (importers.has(file.path) || /(?:^|\/)__init__\.py$/.test(file.path)) continue;
    if (entries.has(file.path)) { entryFiles++; continue; }
    const module = file.python?.module ?? '';
    const site = dynamic.find((s) => !s.prefix || module.startsWith(s.prefix));
    const config = module ? configs.find(([, text]) => new RegExp(`(?:^|[^\\w.])${escape(module)}(?:$|[^\\w.]|:)`).test(text)
      || text.includes(file.path)) : null;
    const command = (startedPaths?.unknown ?? []).find((u) => u.reason === 'unresolved-python-start' && (u.target && posix.basename(u.target) === posix.basename(file.path) || u.module && module.endsWith('.' + u.module)));
    const reason = incomplete || files.some((f) => f.syntax?.errors) ? 'python-source-incomplete' : site?.reason ?? (config ? 'config-reference' : command || entryUnknown.length ? 'entry-not-mapped' : null);
    const manifest = manifestOf(file.path) ?? null;
    if (reason) unknown.push({ path: file.path, manifest, reason, via: site?.via ?? config?.[0] ?? command?.via ?? null });
    else orphaned.push({ path: file.path, manifest, language: 'python' });
  }
  return { orphaned, unknown, entryFiles, entryUnknown };
}
