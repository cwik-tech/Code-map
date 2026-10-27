import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maxJsonSchemas, maxSchemaBytes } from '../lib/schemas/collect.mjs';
import { hasSchemas } from '../lib/schemas/compare.mjs';
import { inventory } from './schemas-fixtures.mjs';

const model = (name, body = 'id Int @id') => `model ${name} {\n  ${body}\n}\n`;
const table = (name) => `import { pgTable, serial } from 'drizzle-orm/pg-core';\nexport const ${name} = pgTable('${name}', { id: serial('id').primaryKey() });\n`;
const names = (schemas) => schemas.entities.map((entity) => [entity.kind, entity.namespace, entity.type, entity.name, entity.path]);

test('a project without Prisma, Drizzle or JSON Schema files has an empty inventory', () => {
  const schemas = inventory({ 'package.json': '{"name":"x"}', 'src/a.ts': 'export const a = 1;\n', 'data/config.json': '{}' });
  assert.equal(hasSchemas(schemas), false);
  assert.deepEqual([schemas.sources, schemas.entities, schemas.unread, schemas.migrations], [[], [], [], []]);
});

test('the Prisma schema comes from the prisma.schema field of package.json, else prisma/schema.prisma, else the prisma/schema folder', () => {
  const field = inventory({ 'package.json': '{"prisma":{"schema":"db/main.prisma"}}', 'db/main.prisma': model('A'), 'prisma/schema.prisma': model('B'), 'db/migrations/1_init/migration.sql': 'x' });
  assert.deepEqual(names(field), [['prisma', '', 'model', 'A', 'db/main.prisma']]);
  assert.deepEqual(field.unread.map((entry) => [entry.path, entry.reason, entry.lost]), [['prisma/schema.prisma', 'not-selected', false]]);
  assert.deepEqual(field.migrations.map((entry) => [entry.kind, entry.folder, entry.files]), [['prisma', 'db/migrations', ['db/migrations/1_init/migration.sql']], ['prisma', 'prisma/migrations', []]]);
  const plain = inventory({ 'prisma/schema.prisma': model('B'), 'prisma/migrations/1_init/migration.sql': 'x', 'prisma/migrations/migration_lock.toml': 'x' });
  assert.deepEqual(names(plain), [['prisma', '', 'model', 'B', 'prisma/schema.prisma']]);
  assert.deepEqual(plain.migrations[0].files, ['prisma/migrations/1_init/migration.sql'], 'only migration.sql in a migration folder counts');
  const folder = inventory({ 'prisma/schema/base.prisma': model('C'), 'prisma/schema/more/user.prisma': model('D') });
  assert.deepEqual(names(folder).map((entry) => entry.slice(3)), [['C', 'prisma/schema/base.prisma'], ['D', 'prisma/schema/more/user.prisma']]);
  assert.deepEqual(folder.sources.map((source) => [source.path, source.state, source.entities]), [['prisma/schema/base.prisma', 'read', 1], ['prisma/schema/more/user.prisma', 'read', 1]]);
  // Prisma keeps the migrations next to the schema file with the datasource block, also in a schema folder.
  const beside = inventory({ 'prisma/schema/base.prisma': model('C'), 'prisma/schema/migrations/1_init/migration.sql': 'x' });
  assert.deepEqual(beside.migrations.map((entry) => [entry.folder, entry.files]), [['prisma/migrations', []], ['prisma/schema/migrations', ['prisma/schema/migrations/1_init/migration.sql']]]);
  const named = inventory({ 'package.json': '{"prisma":{"schema":"db"}}', 'db/schema.prisma': model('A'), 'db/migrations/1_init/migration.sql': 'x' });
  assert.deepEqual(named.migrations.map((entry) => entry.folder), ['db/migrations', 'prisma/migrations'], 'the migrations next to the schema file count, not a folder next to the schema folder');
});

test('each package of a workspace has its own Prisma and Drizzle namespace', () => {
  const schemas = inventory({ 'package.json': '{}', 'apps/web/package.json': '{}', 'apps/web/prisma/schema.prisma': model('A'), 'prisma/schema.prisma': model('A'),
    'apps/api/package.json': '{}', 'apps/api/src/db.ts': table('users') });
  assert.deepEqual(names(schemas), [['prisma', '', 'model', 'A', 'prisma/schema.prisma'], ['prisma', 'apps/web', 'model', 'A', 'apps/web/prisma/schema.prisma'],
    ['drizzle', 'apps/api', 'table', 'users', 'apps/api/src/db.ts']]);
  assert.deepEqual(schemas.migrations.map((entry) => [entry.kind, entry.namespace, entry.folder]), [['prisma', '', 'prisma/migrations'], ['prisma', 'apps/web', 'apps/web/prisma/migrations'], ['drizzle', 'apps/api', 'apps/api/drizzle']]);
});

test('Drizzle tables come from any code file that is not a test, and the out field of drizzle.config.ts names the migration folder', () => {
  const schemas = inventory({ 'drizzle.config.ts': "export default { schema: './db', out: './db/migrations' };\n", 'db/schema.ts': table('users'),
    'src/a.ts': 'export const a = 1;\n', 'test/fixture.test.ts': table('fake'), 'node_modules/x/index.js': table('vendor'), 'db/migrations/0000_init.sql': 'x', 'db/migrations/meta/_journal.json': '{}' });
  assert.deepEqual(names(schemas), [['drizzle', '', 'table', 'users', 'db/schema.ts']]);
  assert.deepEqual(schemas.migrations.map((entry) => [entry.kind, entry.folder, entry.files]), [['drizzle', 'db/migrations', ['db/migrations/0000_init.sql']]]);
  const fallback = inventory({ 'drizzle.config.ts': 'export default { out: dir };\n', 'db/schema.ts': table('users') });
  assert.deepEqual(fallback.migrations.map((entry) => entry.folder), ['drizzle']);
  assert.deepEqual(fallback.unread.map((entry) => [entry.path, entry.reason]), [['drizzle.config.ts', 'out-not-literal']]);
});

test('JSON Schema files are read in any folder that the map reads, but not in test, fixture or ignored folders', () => {
  const schema = '{"type":"object","properties":{"id":{"type":"string"}}}';
  const schemas = inventory({ 'user.schema.json': schema, 'api/order.schema.json': schema, 'test/fake.schema.json': schema, 'fixtures/a.schema.json': schema,
    'dist/b.schema.json': schema, '.cache/c.schema.json': schema, 'other.json': schema });
  assert.deepEqual(names(schemas), [['json-schema', 'api/order.schema.json', 'schema', 'api/order.schema.json', 'api/order.schema.json'], ['json-schema', 'user.schema.json', 'schema', 'user.schema.json', 'user.schema.json']]);
});

test('a schema file over the size limit is unread and marks its namespace as incomplete, and a code file over the limit is skipped only when it names Drizzle', () => {
  const big = 'x'.repeat(maxSchemaBytes);
  const schemas = inventory({ 'prisma/schema.prisma': `${model('A')}// ${big}\n`, 'big.schema.json': `{"type":"object","description":"${big}"}`,
    'src/db.ts': `${table('users')}// ${big}\n`, 'src/other.ts': `export const a = 1; // ${big}\n` });
  assert.deepEqual(schemas.entities, []);
  assert.deepEqual(schemas.unread.map((entry) => [entry.kind, entry.path, entry.reason, entry.lost]),
    [['prisma', 'prisma/schema.prisma', 'too-large', true], ['drizzle', 'src/db.ts', 'too-large', true], ['json-schema', 'big.schema.json', 'too-large', true]]);
  assert.deepEqual(schemas.sources.map((source) => [source.path, source.state]), [['prisma/schema.prisma', 'unread'], ['src/db.ts', 'unread'], ['big.schema.json', 'unread']]);
});

test('the reader reads at most a fixed number of JSON Schema files and counts the others', () => {
  const files = Object.fromEntries(Array.from({ length: maxJsonSchemas + 2 }, (_, index) => [`s/${String(index).padStart(4, '0')}.schema.json`, '{"type":"object"}']));
  const schemas = inventory(files);
  assert.equal(schemas.entities.length, maxJsonSchemas);
  assert.deepEqual(schemas.unread.map((entry) => [entry.reason, entry.count, entry.namespace, entry.lost]), [['too-many-files', 2, null, true]]);
});

test('a Prisma path outside the repository, a missing schema and prisma.config.ts are reported, not guessed', () => {
  const outside = inventory({ 'package.json': '{"prisma":{"schema":"../other/schema.prisma"}}', 'prisma/schema.prisma': model('A') });
  assert.deepEqual(outside.unread.map((entry) => [entry.reason, entry.lost]), [['schema-path-outside', true], ['not-selected', false]]);
  const missing = inventory({ 'package.json': '{"prisma":{"schema":"db/none.prisma"}}' });
  assert.deepEqual(missing.unread.map((entry) => [entry.path, entry.reason, entry.lost]), [['db/none.prisma', 'schema-not-found', true]]);
  const config = inventory({ 'prisma.config.ts': 'export default {};\n', 'prisma/schema.prisma': model('A') });
  assert.deepEqual(config.unread.map((entry) => [entry.path, entry.reason, entry.lost]), [['prisma.config.ts', 'prisma-config-not-read', false]]);
});

test('a model that two files of one schema define is UNKNOWN', () => {
  const schemas = inventory({ 'prisma/schema/a.prisma': model('A'), 'prisma/schema/b.prisma': model('A', 'name String') });
  assert.deepEqual(schemas.entities.map((entity) => [entity.name, entity.state, entity.reason]), [['A', 'unknown', 'duplicate']]);
});
