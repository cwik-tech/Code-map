import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareSchemas } from '../lib/schemas/compare.mjs';
import { inventory } from './schemas-fixtures.mjs';

const changes = (result) => result.changes.map((change) => [change.class, change.change, change.entity, change.member]);
const prisma = (before, after) => compareSchemas(inventory({ 'prisma/schema.prisma': before }), inventory({ 'prisma/schema.prisma': after }));
const user = (body) => `model User {\n  id Int @id\n  ${body.join('\n  ')}\n}\n`;
const drizzle = (before, after) => {
  const file = (columns) => `import { pgTable, text, integer, serial, pgEnum } from 'drizzle-orm/pg-core';\nexport const users = pgTable('users', { ${columns} });\n`;
  return compareSchemas(inventory({ 'src/db.ts': file(before) }), inventory({ 'src/db.ts': file(after) }));
};
const json = (before, after, renames) => compareSchemas(inventory({ 'a.schema.json': JSON.stringify(before) }), inventory({ [renames ? 'b.schema.json' : 'a.schema.json']: JSON.stringify(after) }), renames ?? []);
const object = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });

test('Prisma: each breaking change of the brief is breaking', () => {
  const cases = [
    [`${user([])}model Post {\n  id Int @id\n}\n`, user([]), ['breaking', 'entity-removed', 'Post', null]],
    [user(['name String']), user([]), ['breaking', 'field-removed', 'User', 'name']],
    [user(['name String']), user(['name Int']), ['breaking', 'type-changed', 'User', 'name']],
    [user(['name String']), user(['name String[]']), ['breaking', 'type-changed', 'User', 'name']],
    [user(['name String?']), user(['name String']), ['breaking', 'field-required', 'User', 'name']],
    [user([]), user(['name String']), ['breaking', 'field-added-required', 'User', 'name']],
    [user(['name String']), user(['name String @map("full_name")']), ['breaking', 'name-changed', 'User', 'name']],
    [user([]), user(['@@map("users")']), ['breaking', 'name-changed', 'User', null]],
    ['enum Role {\n  USER\n  ADMIN\n}\n', 'enum Role {\n  USER\n}\n', ['breaking', 'value-removed', 'Role', 'ADMIN']],
    ['enum Role {\n  USER\n}\n', 'enum Role {\n  USER @map("user")\n}\n', ['breaking', 'name-changed', 'Role', 'USER']],
    [`${user([])}enum Role {\n  USER\n}\n`, user([]), ['breaking', 'entity-removed', 'Role', null]],
  ];
  for (const [before, after, expected] of cases) assert.deepEqual(changes(prisma(before, after)), [expected], `${before} -> ${after}`);
  const removed = prisma(user(['name String']), user(['name Int'])).changes[0];
  assert.deepEqual([removed.from, removed.to, removed.kind, removed.type, removed.path, removed.line, removed.side], ['String', 'Int', 'prisma', 'model', 'prisma/schema.prisma', 3, 'head']);
  assert.match(removed.text, /User/);
});

test('Prisma: each compatible change of the brief is compatible, and other changes are unknown', () => {
  const cases = [
    [user([]), `${user([])}model Post {\n  id Int @id\n}\n`, ['compatible', 'entity-added', 'Post', null]],
    [user([]), user(['name String?']), ['compatible', 'field-added', 'User', 'name']],
    [user([]), user(['tags String[]']), ['compatible', 'field-added', 'User', 'tags']],
    [user([]), user(['createdAt DateTime @default(now())']), ['compatible', 'field-added', 'User', 'createdAt']],
    ['enum Role {\n  USER\n}\n', 'enum Role {\n  USER\n  ADMIN\n}\n', ['compatible', 'value-added', 'Role', 'ADMIN']],
    [user(['name String']), user(['name String?']), ['compatible', 'field-optional', 'User', 'name']],
    [user(['name String?']), user(['name String @default("x")']), ['unknown', 'field-required-default', 'User', 'name']],
    [user(['name String']), user(['name String @default("x")']), ['unknown', 'default-changed', 'User', 'name']],
    [user(['name String']), user(['name String @unique']), ['unknown', 'constraint-changed', 'User', 'name']],
    [user(['name String']), user(['name String @db.VarChar(20)']), ['unknown', 'attributes-changed', 'User', 'name']],
    [user([]), user(['@@index([id])']), ['unknown', 'attributes-changed', 'User', null]],
    [user(['name String']), user(['name String', '+ strange']), ['unknown', 'not-parsed', 'User', null]],
  ];
  for (const [before, after, expected] of cases) assert.deepEqual(changes(prisma(before, after)), [expected], `${before} -> ${after}`);
  assert.deepEqual(changes(prisma(user(['name String']), `// note\n${user(['name   String // the name'])}`)), [], 'a comment or a space is no change');
  const order = prisma(user(['a String', 'b String', 'e String']), user(['b String?', 'c String', 'e String @unique']));
  assert.deepEqual(order.changes.map((change) => change.class), ['breaking', 'breaking', 'unknown', 'compatible'], 'breaking first, then unknown, then compatible');
  assert.deepEqual(order.counts, { breaking: 2, compatible: 1, unknown: 1 });
});

test('Drizzle: a removed table or column, a changed builder, a new required column and a changed database name are breaking', () => {
  const base = "id: serial('id').primaryKey(), name: text('name')";
  const cases = [
    ["id: serial('id').primaryKey()", ['breaking', 'field-removed', 'users', 'name']],
    ["id: serial('id').primaryKey(), name: integer('name')", ['breaking', 'type-changed', 'users', 'name']],
    ["id: serial('id').primaryKey(), name: text('name').notNull()", ['breaking', 'field-required', 'users', 'name']],
    ["id: serial('id').primaryKey(), name: text('full_name')", ['breaking', 'name-changed', 'users', 'name']],
    [`${base}, age: integer('age').notNull()`, ['breaking', 'field-added-required', 'users', 'age']],
    [`${base}, age: integer('age')`, ['compatible', 'field-added', 'users', 'age']],
    [`${base}, age: integer('age').notNull().default(0)`, ['compatible', 'field-added', 'users', 'age']],
    [`${base}, key: serial('key').notNull()`, ['compatible', 'field-added', 'users', 'key']],
    ["id: serial('id').primaryKey(), name: text('name').unique()", ['unknown', 'constraint-changed', 'users', 'name']],
    ["id: serial('id').primaryKey(), name: text('name').array()", ['breaking', 'type-changed', 'users', 'name']],
  ];
  for (const [after, expected] of cases) assert.deepEqual(changes(drizzle(base, after)), [expected], after);
  const removed = compareSchemas(inventory({ 'src/db.ts': "import { pgTable, text } from 'drizzle-orm/pg-core';\nexport const a = pgTable('a', { id: text('id') });\n" }), inventory({}));
  assert.deepEqual(changes(removed), [['breaking', 'entity-removed', 'a', null]]);
  const enums = (values) => inventory({ 'src/e.ts': `import { pgEnum } from 'drizzle-orm/pg-core';\nexport const s = pgEnum('status', [${values}]);\n` });
  assert.deepEqual(changes(compareSchemas(enums("'a', 'b'"), enums("'a', 'c'"))), [['breaking', 'value-removed', 'status', 'b'], ['compatible', 'value-added', 'status', 'c']]);
});

test('JSON Schema: a property that became required, a removed property and a changed type are breaking, and a removed required entry is compatible', () => {
  const base = object({ id: { type: 'string' }, address: object({ street: { type: 'string' } }) }, ['id']);
  const cases = [
    [object({ id: { type: 'string' }, address: object({ street: { type: 'string' } }) }, ['id', 'address']), ['breaking', 'field-required', 'a.schema.json', '/properties/address']],
    [object({ id: { type: 'string' } }, ['id']), ['breaking', 'field-removed', 'a.schema.json', '/properties/address']],
    [object({ id: { type: 'number' }, address: object({ street: { type: 'string' } }) }, ['id']), ['breaking', 'type-changed', 'a.schema.json', '/properties/id']],
    [object({ id: { type: 'string' }, address: object({ street: { type: 'string' } }) }), ['compatible', 'field-optional', 'a.schema.json', '/properties/id']],
    [object({ id: { type: 'string' }, address: object({ street: { type: 'string' }, zip: { type: 'string' } }) }, ['id']), ['compatible', 'field-added', 'a.schema.json', '/properties/address/properties/zip']],
    [object({ id: { type: 'string' }, address: object({ street: { type: 'string' }, zip: { type: 'string' } }, ['zip']) }, ['id']), ['breaking', 'field-added-required', 'a.schema.json', '/properties/address/properties/zip']],
    [object({ id: { type: 'string', minLength: 2 }, address: object({ street: { type: 'string' } }) }, ['id']), ['unknown', 'keywords-changed', 'a.schema.json', '/properties/id']],
  ];
  for (const [after, expected] of cases) assert.deepEqual(changes(json(base, after)), [expected], JSON.stringify(after));
  const enumOf = (values) => object({ role: { enum: values } });
  assert.deepEqual(changes(json(enumOf(['a', 'b']), enumOf(['a', 'c']))), [['breaking', 'value-removed', 'a.schema.json', '/properties/role'], ['compatible', 'value-added', 'a.schema.json', '/properties/role']]);
  assert.deepEqual(json(enumOf(['a', 'b']), enumOf(['a'])).changes[0].from, '"b"');
  assert.deepEqual(changes(compareSchemas(inventory({ 'a.schema.json': '{"type":"object"}' }), inventory({}))), [['breaking', 'entity-removed', 'a.schema.json', null]]);
});

test('a Git rename keeps the identity of a JSON Schema file, and an incomplete rename list makes a removed or new file unknown', () => {
  const schema = object({ id: { type: 'string' } });
  assert.deepEqual(changes(json(schema, schema, [{ from: 'a.schema.json', to: 'b.schema.json', similarity: 100 }])), []);
  const added = object({ id: { type: 'string' }, name: { type: 'string' } });
  assert.deepEqual(changes(json(schema, added, [{ from: 'a.schema.json', to: 'b.schema.json', similarity: 80 }])), [['compatible', 'field-added', 'b.schema.json', '/properties/name']]);
  const before = inventory({ 'a.schema.json': JSON.stringify(schema) }), after = inventory({ 'b.schema.json': JSON.stringify(schema) });
  assert.deepEqual(changes(compareSchemas(before, after)), [['breaking', 'entity-removed', 'a.schema.json', null], ['compatible', 'entity-added', 'b.schema.json', null]]);
  assert.deepEqual(changes(compareSchemas(before, after, [], false)), [['unknown', 'not-compared', 'a.schema.json', null], ['unknown', 'not-compared', 'b.schema.json', null]]);
});

test('a schema change without a new migration is MIGRATION_MISSING, and a new migration in the same change is MIGRATION_ADDED', () => {
  const base = { 'prisma/schema.prisma': user([]), 'prisma/migrations/1_init/migration.sql': 'x' };
  const state = (head) => compareSchemas(inventory(base), inventory(head)).migrations.map((entry) => [entry.kind, entry.package, entry.schemaChanged, entry.added, entry.state]);
  assert.deepEqual(state({ ...base, 'prisma/schema.prisma': user(['name String?']) }), [['prisma', '', true, [], 'MIGRATION_MISSING']]);
  assert.deepEqual(state({ ...base, 'prisma/schema.prisma': user(['name String?']), 'prisma/migrations/2_name/migration.sql': 'x' }),
    [['prisma', '', true, ['prisma/migrations/2_name/migration.sql'], 'MIGRATION_ADDED']]);
  assert.deepEqual(state({ ...base, 'prisma/migrations/2_name/migration.sql': 'x' }), [['prisma', '', false, ['prisma/migrations/2_name/migration.sql'], 'NO_SCHEMA_CHANGE']]);
  const post = 'model Post {\n  id Int @id\n  authorId Int\n  author User @relation(fields: [authorId], references: [id])\n}\n';
  const result = compareSchemas(inventory({ 'prisma/schema.prisma': `${user([])}${post}` }), inventory({ 'prisma/schema.prisma': `${user(['posts Post[]'])}${post}` }));
  assert.deepEqual([changes(result), result.migrations[0].state], [[['compatible', 'field-added', 'User', 'posts']], 'NO_SCHEMA_CHANGE'], 'a relation field has no database column');
  const unread = compareSchemas(inventory(base), inventory({ ...base, 'prisma/schema.prisma': `${user([])}// ${'x'.repeat(1024 * 1024)}` }));
  assert.deepEqual([changes(unread), unread.migrations[0].state], [[['unknown', 'not-compared', 'User', null]], 'UNKNOWN'], 'an unread schema is not a removed model');
});

test('a relation field needs a migration when it holds the foreign key or is a list of a many-to-many relation', () => {
  const state = (before, after) => { const result = prisma(before, after); return [changes(result).map((change) => change.slice(1, 4)), result.migrations[0].state]; };
  const post = (options) => `model Post {\n  id Int @id\n  authorId Int\n  author User @relation(fields: [authorId], references: [id]${options})\n}\n`;
  assert.deepEqual(state(`${user(['posts Post[]'])}${post('')}`, `${user(['posts Post[]'])}${post(', onDelete: Cascade')}`),
    [[['relation-changed', 'Post', 'author']], 'MIGRATION_MISSING'], 'a new onDelete changes the foreign key');
  const tag = (fields) => `model Tag {\n  id Int @id\n  ${fields}\n}\n`;
  assert.deepEqual(state(`${user([])}${tag('')}`, `${user(['tags Tag[]'])}${tag('users User[]')}`),
    [[['field-added', 'Tag', 'users'], ['field-added', 'User', 'tags']], 'MIGRATION_MISSING'], 'two lists make a join table');
  const node = (fields) => `model Node {\n  id Int @id\n  parentId Int?\n  parent Node? @relation("tree", fields: [parentId], references: [id])\n  ${fields}\n}\n`;
  assert.deepEqual(state(node(''), node('children Node[] @relation("tree")')), [[['field-added', 'Node', 'children']], 'NO_SCHEMA_CHANGE'], 'the list of a one-to-many relation to the same model has no column');
});

test('a change of only the $ modifiers of a Drizzle column needs no migration', () => {
  const state = (before, after) => { const result = drizzle(before, after); return [changes(result).map((change) => change.slice(0, 2)), result.migrations[0]?.state]; };
  assert.deepEqual(state("name: text('name')", "name: text('name').$type<'a' | 'b'>()"), [[['unknown', 'attributes-changed']], 'NO_SCHEMA_CHANGE']);
  assert.deepEqual(state("name: text('name').$defaultFn(() => 'a')", "name: text('name').$defaultFn(() => 'b')"), [[['unknown', 'default-changed']], 'NO_SCHEMA_CHANGE']);
  assert.deepEqual(state("name: text('name')", "name: text('name').default('a')"), [[['unknown', 'default-changed']], 'MIGRATION_MISSING']);
});

test('JSON Schema changes need no migration, and two analyses without schemas have no change and no migration entry', () => {
  const result = json(object({ id: { type: 'string' } }), object({}));
  assert.deepEqual([result.counts.breaking, result.migrations], [1, []]);
  assert.deepEqual(compareSchemas(inventory({}), inventory({})), { counts: { breaking: 0, compatible: 0, unknown: 0 }, changes: [], migrations: [] });
  assert.deepEqual(compareSchemas(undefined, null), { counts: { breaking: 0, compatible: 0, unknown: 0 }, changes: [], migrations: [] }, 'an analysis without a schema inventory');
});
