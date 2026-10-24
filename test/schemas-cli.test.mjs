import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));

/** A Git repository with one commit for each step, and a private store. A step maps paths to texts. Null deletes a file, and a [from] array moves one with git mv. */
function repository(t, ...steps) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-schemas-')), store = mkdtempSync(join(tmpdir(), 'code-map-schemas-store-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  git('init', '-q');
  for (const step of steps) {
    for (const [path, text] of Object.entries(step)) {
      if (text === null) git('rm', '-q', path);
      else if (Array.isArray(text)) { mkdirSync(dirname(join(root, path)), { recursive: true }); git('mv', text[0], path); }
      else put(path, text);
    }
    git('add', '-A'); git('commit', '-qm', 'step');
  }
  return { root, store, git, put };
}
const run = (root, args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
function json(root, args) {
  const output = run(root, args);
  assert.equal(output.status, 0, output.stderr);
  return JSON.parse(output.stdout);
}
const words = (command) => [...command.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map((match) => match[1] !== undefined ? match[1].replaceAll("'\\''", "'") : match[2]);
function follow(root, command) {
  const [program, ...args] = words(command);
  assert.equal(program, 'code-map');
  return json(root, args);
}
const compared = ({ root, store }) => json(root, ['inspect', '--summary', '--ref', 'HEAD', '--base', 'HEAD~1', '--store', store]);

const user = (fields) => `model User {\n  id Int @id\n  ${fields.join('\n  ')}\n}\n`;
const code = { 'package.json': '{"name":"app"}', 'src/app.ts': 'export const app = 1;\n' };
const drizzle = "import { pgTable, serial, text } from 'drizzle-orm/pg-core';\nexport const notes = pgTable('notes', { id: serial('id').primaryKey(), body: text('body') });\n";
const jsonSchema = JSON.stringify({ type: 'object', required: ['id'], properties: { id: { type: 'string' }, tags: { type: 'array', items: { $ref: '#/$defs/tag' } } } });

test('the summary shows the schema inventory: counts, sources, what Code-map did not read, migration folders, and a paged list', (t) => {
  const repo = repository(t, { ...code, 'prisma/schema.prisma': `${user(['name String'])}enum Role {\n  USER\n}\nmodel Broken {\n  ??\n}\n`,
    'prisma/migrations/20261001_init/migration.sql': 'CREATE TABLE x();\n', 'src/db/schema.ts': drizzle, 'contracts/user.schema.json': jsonSchema });
  const summary = json(repo.root, ['inspect', '--summary', '--ref', 'HEAD', '--store', repo.store]);
  const { schemas } = summary;
  assert.deepEqual(schemas.kinds, [
    { kind: 'prisma', files: 1, entities: { model: 2, enum: 1 }, unknown: 1, unread: 0 },
    { kind: 'drizzle', files: 1, entities: { table: 1 }, unknown: 0, unread: 0 },
    { kind: 'json-schema', files: 1, entities: { schema: 1 }, unknown: 0, unread: 0 }]);
  assert.deepEqual(schemas.sources.items.map((source) => [source.kind, source.path, source.state, source.entities]), [
    ['prisma', 'prisma/schema.prisma', 'partial', 3], ['drizzle', 'src/db/schema.ts', 'read', 1], ['json-schema', 'contracts/user.schema.json', 'read', 1]]);
  assert.deepEqual(schemas.unread.items.map((item) => [item.kind, item.path, item.entity, item.reason]), [
    ['prisma', 'prisma/schema.prisma', 'Broken', 'unknown-statement'], ['json-schema', 'contracts/user.schema.json', null, 'keywords-not-compared']]);
  assert.match(schemas.unread.items[1].text, /\$ref/);
  assert.deepEqual(schemas.migrations, [{ kind: 'prisma', package: '', folder: 'prisma/migrations', files: 1 }, { kind: 'drizzle', package: '', folder: 'drizzle', files: 0 }]);
  const page = follow(repo.root, schemas.next);
  assert.equal(page.reportType, 'code-map-schemas');
  assert.deepEqual(Object.keys(page.page), ['total', 'offset', 'limit', 'items', 'next'], 'the page shape of the other pages');
  assert.deepEqual(page.page.items.map((item) => [item.state, item.name]), [['unread', 'contracts/user.schema.json'], ['unknown', 'Broken'],
    ['read', 'User'], ['read', 'Role'], ['read', 'notes'], ['read', 'contracts/user.schema.json']]);
  assert.equal(repo.git('status', '--porcelain'), '');
});

test('a comparison classifies the schema changes, shows at most five, gives the full list in pages, and reports a missing migration', (t) => {
  const base = { ...code, 'prisma/schema.prisma': user(['a String', 'b String', 'c String?', 'd String', 'e String', 'f String']), 'prisma/migrations/1_init/migration.sql': 'x' };
  const repo = repository(t, base, { 'prisma/schema.prisma': user(['c String', 'g String?', 'h String @default("x")']) });
  const { comparison } = compared(repo);
  assert.equal(comparison.state, 'COMPARABLE');
  const { schemas } = comparison;
  assert.deepEqual(schemas.counts, { breaking: 6, compatible: 2, unknown: 0 });
  assert.equal(schemas.items.length, 5);
  assert.deepEqual(schemas.items.map((item) => [item.class, item.change, item.member]), [['breaking', 'field-removed', 'a'], ['breaking', 'field-removed', 'b'],
    ['breaking', 'field-required', 'c'], ['breaking', 'field-removed', 'd'], ['breaking', 'field-removed', 'e']]);
  assert.deepEqual(schemas.migrations.map((entry) => [entry.kind, entry.state, entry.added]), [['prisma', 'MIGRATION_MISSING', []]]);
  const first = follow(repo.root, schemas.next);
  assert.equal(first.reportType, 'code-map-schema-changes');
  assert.deepEqual([first.comparison.state, first.schemas.counts, first.page.total], ['COMPARABLE', schemas.counts, 8]);
  assert.deepEqual(first.page.items.map((item) => item.change).slice(-2), ['field-added', 'field-added']);
  const one = json(repo.root, [...words(schemas.next).slice(1), '--limit', '3']);
  assert.match(one.page.next, /--offset 3 --limit 3/);
  assert.deepEqual(follow(repo.root, one.page.next).page.items.map((item) => item.member), ['d', 'e', 'f']);
});

test('a schema change with a new migration in the same change is MIGRATION_ADDED', (t) => {
  const repo = repository(t, { ...code, 'prisma/schema.prisma': user([]), 'prisma/migrations/1_init/migration.sql': 'x' },
    { 'prisma/schema.prisma': user(['name String?']), 'prisma/migrations/2_name/migration.sql': 'ALTER TABLE x;\n' });
  const { schemas } = compared(repo).comparison;
  assert.deepEqual(schemas.items.map((item) => [item.class, item.change, item.entity, item.member]), [['compatible', 'field-added', 'User', 'name']]);
  assert.deepEqual(schemas.migrations, [{ kind: 'prisma', package: '', folders: ['prisma/migrations'], schemaChanged: true, added: ['prisma/migrations/2_name/migration.sql'], addedTotal: 1, state: 'MIGRATION_ADDED' }]);
});

test('a schema file that Git renames keeps its identity, also when the Prisma schema moves to the path that package.json names', (t) => {
  const repo = repository(t, { ...code, 'schemas/user.schema.json': jsonSchema, 'prisma/schema.prisma': user(['name String']) },
    { 'contracts/user.schema.json': ['schemas/user.schema.json'], 'db/schema.prisma': ['prisma/schema.prisma'], 'package.json': '{"name":"app","prisma":{"schema":"db/schema.prisma"}}' });
  const { schemas } = compared(repo).comparison;
  assert.deepEqual(schemas.counts, { breaking: 0, compatible: 0, unknown: 0 });
  assert.deepEqual(schemas.migrations.map((entry) => [entry.state, entry.folders]), [['NO_SCHEMA_CHANGE', ['db/migrations', 'prisma/migrations']]]);
});

test('a project without schemas keeps its summary and comparison unchanged, and its schema page is empty', (t) => {
  const repo = repository(t, { ...code, 'data/settings.json': '{"a":1}' }, { 'src/app.ts': 'export const app = 2;\n' });
  const summary = compared(repo);
  assert.equal(Object.hasOwn(summary, 'schemas'), false);
  assert.equal(Object.hasOwn(summary.comparison, 'schemas'), false);
  const page = json(repo.root, ['inspect', '--analysis', summary.analysis.id, '--schemas', '--store', repo.store]);
  assert.deepEqual([page.schemas, page.page.total, page.page.items, page.page.next], [null, 0, [], null]);
  const changes = json(repo.root, ['inspect', '--analysis', summary.analysis.id, '--base-analysis', summary.comparison.base.id, '--schemas', '--store', repo.store]);
  assert.deepEqual([changes.reportType, changes.schemas, changes.page.total], ['code-map-schema-changes', null, 0]);
});

test('an edit of a .prisma file in the working tree changes the analysis ID, and --schemas needs --analysis and no other view', (t) => {
  const repo = repository(t, { ...code, 'prisma/schema.prisma': user([]) });
  const before = json(repo.root, ['inspect', '--summary', '--worktree', '--store', repo.store]);
  repo.put('prisma/schema.prisma', user(['name String?']));
  const after = json(repo.root, ['inspect', '--summary', '--worktree', '--store', repo.store]);
  assert.notEqual(after.analysis.id, before.analysis.id);
  assert.equal(after.analysis.reused, false);
  const fails = (args, pattern) => {
    const output = run(repo.root, ['inspect', ...args]);
    assert.notEqual(output.status, 0, `${args.join(' ')} must fail`);
    assert.equal(output.stdout, '');
    assert.match(output.stderr, pattern);
  };
  fails(['--schemas', '--ref', 'HEAD'], /--schemas needs --analysis/);
  fails(['--analysis', after.analysis.id, '--schemas', '--findings', '--store', repo.store], /not both/);
  fails(['--analysis', after.analysis.id, '--schemas', '--file', 'src/app.ts', '--store', repo.store], /not both/);
  assert.equal(json(repo.root, ['inspect', '--analysis', after.analysis.id, '--schemas', '--limit', '1', '--store', repo.store]).page.limit, 1);
});
