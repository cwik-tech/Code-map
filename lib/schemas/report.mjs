// The schema views of a stored analysis: the inventory and the support report for the summary, the schema change of a
// comparison, and the complete lists that `inspect --schemas` shows one page at a time. Pure: the caller gives the commands.
import { maxJsonSchemas, maxSchemaBytes } from './collect.mjs';
import { compareSchemas, hasSchemas } from './compare.mjs';

/** The summary shows at most this many sources, unread items, changes and new migration files. The pages have all of them. */
const schemasShown = 5;
const kinds = ['prisma', 'drizzle', 'sql', 'json-schema'];
/** Paths sort by code point, not by the locale of the computer, so that each computer gives the same order. */
const byKind = (a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || (String(a.path) < String(b.path) ? -1 : String(a.path) > String(b.path) ? 1 : 0) || (a.line ?? 0) - (b.line ?? 0);

/** One sentence for each reason why Code-map did not read a file, a block or a definition. */
const reasons = {
  'too-large': () => `The file is larger than ${maxSchemaBytes / 1024 / 1024} MiB, so Code-map did not read it.`,
  unreadable: () => 'Code-map cannot read the file.',
  'invalid-json': () => 'The file is not valid JSON.',
  'not-an-object': () => 'The file does not hold a JSON Schema object.',
  'too-deep': () => 'The schema is nested too deep for the reader.',
  'keywords-not-compared': (entry) => `Code-map compares these keywords only as text: ${entry.keys.join(', ')}.`,
  'too-many-files': (entry) => `Code-map reads at most ${maxJsonSchemas} JSON Schema files. It did not read ${entry.count} more files.`,
  'unknown-text': (entry) => `Code-map cannot read the text outside a block that starts at line ${entry.line}.`,
  'unknown-block': (entry) => `Code-map does not know the block kind "${entry.keyword}".`,
  'unbalanced-block': (entry) => `The block ${entry.entity} has no closing brace.`,
  'unsupported-block': (entity) => `Code-map does not compare a Prisma ${entity.type} block.`,
  'unknown-statement': (entity) => `Code-map cannot read line ${entity.problemLine}, so it does not compare the ${entity.type} ${entity.name}.`,
  duplicate: (entity) => `More than one definition has the ${entity.type} name ${entity.name}, so Code-map does not compare it.`,
  'not-selected': () => 'No prisma.schema field of package.json and no default path selects this Prisma file.',
  'schema-not-found': () => 'The prisma.schema field of package.json names this path, but the snapshot has no Prisma file there.',
  'schema-path-outside': () => 'The prisma.schema field of package.json names a path outside the repository.',
  'schema-path-not-literal': () => 'The prisma.schema field of package.json is not a path.',
  'prisma-config-not-read': () => 'Code-map does not read a prisma.config file. Such a file can name another schema path.',
  'columns-not-object': (entity) => `The columns of the table ${entity.name} are not an object literal.`,
  'spread-columns': (entity) => `The table ${entity.name} gets columns from a spread at line ${entity.problemLine}, so Code-map cannot read all of them.`,
  'column-not-builder': (entity) => `The column at line ${entity.problemLine} of the table ${entity.name} is not a builder call.`,
  'duplicate-column': (entity) => `The table ${entity.name} has the column at line ${entity.problemLine} two times.`,
  'table-name-not-literal': () => 'A table name is not a string literal, so Code-map cannot identify the table.',
  'enum-name-not-literal': () => 'An enum name is not a string literal, so Code-map cannot identify the enum.',
  'values-not-literal': (entity) => `The values of the enum ${entity.name} are not a list of string literals.`,
  'schema-tables': () => 'Code-map does not read the tables of a pgSchema or a mysqlSchema.',
  'parse-failed': () => 'The TypeScript parser cannot read the file.',
  'out-not-literal': () => 'The out field of the Drizzle configuration is not a string, so Code-map uses the drizzle folder.',
  'out-outside': () => 'The out field of the Drizzle configuration names a folder outside the repository, so Code-map uses the drizzle folder.',
};
const reasonText = (entry) => reasons[entry.reason]?.(entry) ?? entry.reason;

/** What Code-map did not read: the unread entries and the UNKNOWN definitions, each with a sentence. */
function unreadItems(schemas) {
  const entries = schemas.unread.map((entry) => ({ kind: entry.kind, path: entry.path, line: entry.line, entity: entry.entity, reason: entry.reason, text: reasonText(entry) }));
  const unknown = schemas.entities.filter((entity) => entity.state === 'unknown')
    .map((entity) => ({ kind: entity.kind, path: entity.path, line: entity.problemLine ?? entity.line, entity: entity.name, reason: entity.reason, text: reasonText(entity) }));
  return [...entries, ...unknown].sort(byKind);
}

/** The inventory for the summary, or undefined when the snapshot has no schema file and no migration folder. */
export function inventoryView(schemas, next) {
  if (!hasSchemas(schemas)) return undefined;
  const list = kinds.filter((kind) => [schemas.sources, schemas.unread, schemas.migrations].some((items) => items.some((item) => item.kind === kind))).map((kind) => {
    const entities = schemas.entities.filter((entity) => entity.kind === kind), sources = schemas.sources.filter((item) => item.kind === kind), counts = {};
    for (const entity of entities) counts[entity.type] = (counts[entity.type] ?? 0) + 1;
    return { kind, files: sources.length, entities: counts, unknown: entities.filter((entity) => entity.state === 'unknown').length, unread: sources.filter((item) => item.state === 'unread').length };
  });
  const unread = unreadItems(schemas);
  return { kinds: list, sources: { total: schemas.sources.length, items: schemas.sources.slice(0, schemasShown).map(({ kind, path, state, entities }) => ({ kind, path, state, entities })) },
    unread: { total: unread.length, items: unread.slice(0, schemasShown) },
    migrations: schemas.migrations.map(({ kind, namespace, folder, files }) => ({ kind, package: namespace, folder, files: files.length })), next };
}

/** Every item of the inventory for the page: the unread entries first, then the UNKNOWN definitions, then the read ones. */
export function inventoryEntries(schemas) {
  if (!hasSchemas(schemas)) return [];
  const members = (entity) => (entity.fields ?? entity.columns ?? entity.values ?? entity.nodes?.filter((node) => node.name !== null) ?? []).length;
  const item = (entity) => ({ kind: entity.kind, type: entity.type, name: entity.name, path: entity.path, line: entity.line, state: entity.state, reason: entity.reason ?? null,
    members: members(entity), text: entity.state === 'unknown' ? reasonText(entity) : null });
  const unread = schemas.unread.map((entry) => ({ kind: entry.kind, type: null, name: entry.entity ?? entry.path, path: entry.path, line: entry.line, state: 'unread', reason: entry.reason,
    members: null, text: reasonText(entry) })).sort(byKind);
  return [...unread, ...schemas.entities.filter((entity) => entity.state === 'unknown').map(item), ...schemas.entities.filter((entity) => entity.state !== 'unknown').map(item)];
}

/** The schema change of a comparison: undefined when neither analysis has a schema, null when the analyses are not comparable. */
export function schemaChange({ base, result, renames, complete }, headSchemas) {
  if (!hasSchemas(base.data.schemas) && !hasSchemas(headSchemas)) return undefined;
  return result.state === 'COMPARABLE' ? compareSchemas(base.data.schemas, headSchemas, renames, complete) : null;
}

/** The summary view of a schema change: the counts, at most `schemasShown` changes, the migration states and the command for all changes. */
export function changeView(compared, next) {
  if (!compared) return compared;
  return { counts: compared.counts, items: compared.changes.slice(0, schemasShown),
    migrations: compared.migrations.map((entry) => ({ ...entry, added: entry.added.slice(0, schemasShown) })), next };
}
