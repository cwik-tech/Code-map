// Reads schema metadata without executing SQL or project code on the host.
import { sourceReader } from '../git.mjs';
import { collectSchemas } from '../schemas/collect.mjs';
import { fileBytes } from './files.mjs';
/** Selects changed SQL files in one schema package. The fixture supplies the base database. */
export function migrationMetadata(repository, workspace, inputs, spec) {
  const base = sourceReader(repository, spec.base), head = sourceReader(repository, inputs.selector.worktree ? null : inputs.sha);
  const paths = head.list(), texts = new Map();
  const read = (files) => {
    for (const path of files) if (!texts.has(path)) {
      try { texts.set(path, fileBytes(workspace, path, 1048576).toString('utf8')); }
      catch { /* The schema collector retains unread files as unknown. */ }
    }
    return new Map(files.filter((path) => texts.has(path)).map((path) => [path, texts.get(path)]));
  };
  const schemas = collectSchemas(paths, read), namespace = spec.package ?? '';
  const incomplete = (inventory) => inventory.unread.some((item) => item.namespace === namespace && (item.lost
    || ['out-not-literal', 'out-outside', 'prisma-config-not-read'].includes(item.reason)));
  const sources = schemas.sources.filter((item) => item.namespace === namespace && ['prisma', 'drizzle', 'sql'].includes(item.kind));
  const dialects = sources.flatMap((source) => ['drizzle', 'sql'].includes(source.kind)
    ? schemas.entities.filter((item) => item.path === source.path && item.type === 'table').map((item) => item.dialect)
    : [...(texts.get(source.path) ?? '').replace(/\/\/[^\n]*/g, '').matchAll(/\bdatasource\s+\w+\s*\{([^}]+)\}/g)]
      .flatMap((block) => [...block[1].matchAll(/\bprovider\s*=\s*"([^"\n]+)"/g)].map((match) => match[1])));
  const unknown = (reason) => ({ status: 'UNKNOWN', reason, files: [], base: base.sha, package: namespace });
  if (!dialects.length || dialects.some((dialect) => dialect !== 'sqlite')) return unknown('Only a detected SQLite database supports fixture migrations. Other or unknown databases are unsupported.');
  if (sources.some((source) => source.state !== 'read') || incomplete(schemas)) return unknown('The selected database schema is incomplete.');
  const files = [...new Set(schemas.migrations.filter((item) => item.namespace === namespace).flatMap((item) => item.files))].sort();
  const oldPaths = new Set(base.list());
  const oldSchemas = collectSchemas([...oldPaths], (requested) => {
    const info = base.stat(requested);
    return base.read(requested.filter((path) => { const stat = info.get(path); return stat?.file && !stat.link && stat.size <= 1048576; }));
  });
  if (incomplete(oldSchemas)) return unknown('The base migration configuration or schema is incomplete.');
  const known = new Set(files);
  if (oldSchemas.migrations.filter((item) => item.namespace === namespace).some((item) => item.files.some((path) => !known.has(path)))) {
    return unknown('A historical migration was removed or moved. Fixture replay cannot validate that history change.');
  }
  const stats = base.stat(files.filter((file) => oldPaths.has(file))), changed = [];
  for (const path of files) {
    const bytes = fileBytes(workspace, path, 1048576);
    if (!oldPaths.has(path)) changed.push(path);
    else {
      const stat = stats.get(path);
      if (!stat?.file || stat.link || stat.size > 1048576) return unknown('A base migration is unreadable or exceeds 1 MiB.');
      if (base.read([path]).get(path) !== bytes.toString('utf8')) changed.push(path);
    }
  }
  if (!changed.length || changed.length > 100) return unknown('The change needs between one and 100 SQL migration files.');
  return { status: 'KNOWN', dialect: 'sqlite', files: changed, base: base.sha, package: namespace };
}
