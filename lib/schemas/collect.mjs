// Finds and reads the schema files of one snapshot: Prisma schemas, Drizzle table definitions and JSON Schema files, and
// the migration folders of Prisma and Drizzle. Schema files are untrusted input, so each file has a size limit, and the
// number of JSON Schema files has a limit. Pure: the caller gives the file list and a function that reads files.
import { posix } from 'node:path';
import { ignored, isCode, isTest } from '../project.mjs';
import { drizzleOut, mentionsDrizzle, parseDrizzle } from './drizzle.mjs';
import { parseJsonSchema } from './json-schema.mjs';
import { parseSqlSchema } from './sql.mjs';
import { parsePrisma } from './prisma.mjs';
import { digest } from './shared.mjs';

const inventoryVersion = 1;
/** A larger schema file is not read. */
export const maxSchemaBytes = 1024 * 1024;
/** At most this many JSON Schema files are read, in path order. */
export const maxJsonSchemas = 500;
/** JSON Schema files in these folders are test data, not contracts. */
const testFolder = /(^|\/)(__tests__|__mocks__|__fixtures__|tests?|fixtures?)\//;
const configExtensions = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'];

const within = (root, path) => root === '' || path.startsWith(`${root}/`);
/** A path relative to a package folder as a repository path, or null when it leaves the repository. */
function inside(root, path) {
  if (posix.isAbsolute(path)) return null;
  const joined = posix.normalize(root ? `${root}/${path}` : path).replace(/\/+$/, '');
  return joined === '..' || joined.startsWith('../') ? null : joined === '.' ? '' : joined;
}
/** The `prisma.schema` field of a package.json text: absent, or present with its value. */
function prismaField(text) {
  try { const prisma = JSON.parse(text ?? 'null')?.prisma; return prisma && typeof prisma === 'object' && Object.hasOwn(prisma, 'schema') ? { present: true, value: prisma.schema } : { present: false }; }
  catch { return { present: false }; }
}

/**
 * The schema inventory of a snapshot. `paths` lists its files and `read(paths)` returns a Map of the texts that it can read.
 * Prisma and Drizzle definitions belong to the namespace of their package (the folder of the nearest package.json, or ''
 * for the root). A JSON Schema file is its own namespace. `unread` entries with `lost` mean that definitions can be missing.
 */
export function collectSchemas(paths, read) {
  const visible = paths.filter((path) => !ignored(path)).sort(), present = new Set(visible);
  const packages = [...new Set(['', ...visible.filter((path) => posix.basename(path) === 'package.json').map((path) => inside(posix.dirname(path), ''))])].sort();
  const namespaceOf = (path) => packages.filter((root) => within(root, path)).reduce((a, b) => (b.length > a.length ? b : a), '');
  const prismaFiles = visible.filter((path) => path.endsWith('.prisma')), codeFiles = visible.filter((path) => isCode(path) && !isTest(path));
  const jsonFiles = visible.filter((path) => path.endsWith('.schema.json') && !testFolder.test(path)), manifests = packages.map((root) => inside(root, 'package.json'));
  const sqlFiles = visible.filter((path) => /(^|\/)schema\.sql$|\.schema\.sql$/.test(path) && !testFolder.test(path));
  const texts = read([...new Set([...manifests.filter((path) => present.has(path)), ...prismaFiles, ...sqlFiles, ...codeFiles, ...jsonFiles.slice(0, maxJsonSchemas)])]);
  const out = { version: inventoryVersion, sources: [], entities: [], unread: [], migrations: [] };
  const note = (kind, namespace, path, entry) => out.unread.push({ kind, namespace, path, line: null, entity: null, ...entry });
  /** Reads one source file. `keepEmpty` false skips a file without definitions, such as a code file that only names pgTable. */
  const source = (kind, namespace, path, parse, keepEmpty = true) => {
    const text = texts.get(path), unreadSource = (reason) => { note(kind, namespace, path, { reason, lost: true }); out.sources.push({ kind, namespace, path, state: 'unread', digest: text === undefined ? null : digest(text), entities: 0 }); };
    if (text === undefined) return unreadSource('unreadable');
    if (Buffer.byteLength(text, 'utf8') > maxSchemaBytes) return unreadSource('too-large');
    const { entities, unread } = parse(text);
    if (!keepEmpty && !entities.length && !unread.length) return;
    for (const entity of entities) out.entities.push({ kind, namespace, path, ...entity });
    for (const entry of unread) note(kind, namespace, path, entry);
    const lost = unread.some((entry) => entry.lost), unknown = entities.some((entity) => entity.state === 'unknown');
    out.sources.push({ kind, namespace, path, state: !entities.length && lost ? 'unread' : lost || unknown ? 'partial' : 'read', digest: digest(text), entities: entities.length });
  };
  const migrations = (kind, namespace, folders, pattern) => {
    for (const folder of [...new Set(folders)].sort()) {
      out.migrations.push({ kind, namespace, folder, files: visible.filter((path) => path.startsWith(`${folder}/`) && pattern.test(path.slice(folder.length + 1))) });
    }
  };
  const selected = new Set(), prismaMigration = /^[^/]+\/migration\.sql$/;
  const holdsMigrations = (folder) => visible.some((path) => path.startsWith(`${folder}/`) && prismaMigration.test(path.slice(folder.length + 1)));
  for (const root of packages) {
    const manifest = inside(root, 'package.json'), field = prismaField(texts.get(manifest)), folders = [inside(root, 'prisma/migrations')];
    let files = [];
    if (field.present) {
      const target = typeof field.value === 'string' && field.value ? inside(root, field.value) : undefined;
      if (target === undefined) note('prisma', root, manifest, { reason: 'schema-path-not-literal', lost: true });
      else if (target === null) note('prisma', root, manifest, { reason: 'schema-path-outside', lost: true });
      else {
        files = present.has(target) ? [target] : prismaFiles.filter((path) => path.startsWith(`${target}/`));
        if (files.length && present.has(target)) folders.push(inside(posix.dirname(target), 'migrations'));
        else if (!files.length) note('prisma', root, target, { reason: 'schema-not-found', lost: true });
      }
    } else {
      const single = inside(root, 'prisma/schema.prisma'), folder = inside(root, 'prisma/schema');
      files = present.has(single) ? [single] : prismaFiles.filter((path) => path.startsWith(`${folder}/`));
    }
    for (const extension of configExtensions) {
      const config = inside(root, `prisma.config.${extension}`);
      if (present.has(config)) note('prisma', root, config, { reason: 'prisma-config-not-read', lost: false });
    }
    for (const path of files) { selected.add(path); source('prisma', root, path, parsePrisma); }
    // Prisma keeps the migrations next to the schema file with the datasource block, for example prisma/schema/migrations.
    for (const path of files) { const folder = inside(posix.dirname(path), 'migrations'); if (holdsMigrations(folder)) folders.push(folder); }
    if (files.length || field.present || folders.some(holdsMigrations)) migrations('prisma', root, folders, prismaMigration);
  }
  for (const path of prismaFiles) if (!selected.has(path)) note('prisma', namespaceOf(path), path, { reason: 'not-selected', lost: false });
  for (const path of codeFiles) {
    if (texts.has(path) && mentionsDrizzle(texts.get(path))) source('drizzle', namespaceOf(path), path, (text) => parseDrizzle(path, text), false);
  }
  for (const root of packages) {
    const config = configExtensions.map((extension) => inside(root, `drizzle.config.${extension}`)).find((path) => present.has(path));
    if (!config && !out.sources.some((item) => item.kind === 'drizzle' && item.namespace === root)) continue;
    let folder = inside(root, 'drizzle');
    if (config) {
      const { out: configured, problem } = texts.has(config) ? drizzleOut(config, texts.get(config)) : { out: null, problem: 'unreadable' };
      const target = configured === null ? null : inside(root, configured);
      if (problem || (configured !== null && target === null)) note('drizzle', root, config, { reason: problem ?? 'out-outside', lost: false });
      if (target) folder = target;
    }
    migrations('drizzle', root, [folder], /^[^/]+\.sql$/);
  }
  for (const path of jsonFiles.slice(0, maxJsonSchemas)) {
    source('json-schema', path, path, (text) => { const parsed = parseJsonSchema(text); return { ...parsed, entities: parsed.entities.map((entity) => ({ ...entity, name: path })) }; });
  }
  if (jsonFiles.length > maxJsonSchemas) note('json-schema', null, null, { reason: 'too-many-files', count: jsonFiles.length - maxJsonSchemas, lost: true });
  for (const path of sqlFiles) {
    const namespace = namespaceOf(path);
    source('sql', namespace, path, parseSqlSchema);
    migrations('sql', namespace, [inside(posix.dirname(path), 'migrations')], /^[^/]+\.sql$/);
  }
  out.entities = withoutDuplicates(out.entities);
  return out;
}

/** Two definitions of one model, table or enum in one namespace become one UNKNOWN entity, because neither one is sure. */
function withoutDuplicates(entities) {
  const groups = new Map();
  for (const entity of entities) {
    const key = JSON.stringify([entity.kind, entity.namespace, entity.type, entity.name]);
    groups.set(key, [...(groups.get(key) ?? []), entity]);
  }
  return [...groups.values()].map((group) => group.length === 1 ? group[0]
    : { ...group[0], state: 'unknown', reason: 'duplicate', digest: digest(group.map((entity) => entity.digest).join(',')), ...(group[0].fields ? { fields: [] } : {}), ...(group[0].columns ? { columns: [] } : {}), ...(group[0].values ? { values: [] } : {}) });
}

/** The schema inventory of a snapshot from its source reader. `known` holds the texts that the collector already read. */
export function snapshotSchemas(reader, known) {
  return collectSchemas(reader.list(), (paths) => {
    const sql = paths.filter((path) => /(^|\/)schema\.sql$|\.schema\.sql$/.test(path));
    const parents = (path) => path.split('/').slice(0, -1).map((_, index) => path.split('/').slice(0, index + 1).join('/'));
    const stats = reader.stat([...new Set([...sql, ...sql.flatMap(parents)])]);
    const refused = new Set(sql.filter((path) => {
      const item = stats.get(path);
      return !item?.file || item.link || item.size > maxSchemaBytes || parents(path).some((parent) => stats.get(parent)?.link);
    }));
    const missing = paths.filter((path) => !known.has(path) && !refused.has(path)), texts = new Map();
    let extra;
    try { extra = reader.read(missing); } catch {
      extra = new Map();
      for (const path of missing) { try { const one = reader.read([path]); if (one.has(path)) extra.set(path, one.get(path)); } catch { /* the source reports it as unreadable */ } }
    }
    for (const path of paths) { if (refused.has(path)) continue; const text = known.get(path) ?? extra.get(path); if (text !== undefined) texts.set(path, text); }
    return texts;
  });
}
