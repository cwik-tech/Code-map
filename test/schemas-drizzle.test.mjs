import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drizzleOut, mentionsDrizzle, parseDrizzle } from '../lib/schemas/drizzle.mjs';

const tables = `import { pgTable, serial, text, integer, varchar, pgEnum, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const status = pgEnum('status', ['active', 'closed']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: varchar('email_address', { length: 256 }).notNull().unique(),
  nickname: text(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  state: status('state').default(sql\`'active'\`),
}, (table) => [table.email]);

export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  authorId: integer('author_id').references(() => users.id, { onDelete: 'cascade' }),
  tags: text('tags').array(),
});
`;

const column = (table, name) => table.columns.find((item) => item.name === name);
const modifiers = (item) => item.modifiers.map((modifier) => modifier.name);

test('parseDrizzle reads pgTable calls: the table name, each column builder with its database name and arguments, and the chained modifiers', () => {
  const { entities, unread } = parseDrizzle('src/db/schema.ts', tables);
  assert.deepEqual(unread, []);
  assert.deepEqual(entities.map((entity) => [entity.type, entity.name, entity.variable, entity.state, entity.line]), [
    ['enum', 'status', 'status', 'read', 4], ['table', 'users', 'users', 'read', 6], ['table', 'posts', 'posts', 'read', 15]]);
  const [status, users, posts] = entities;
  assert.deepEqual(status.values.map((value) => value.name), ['active', 'closed']);
  assert.equal(users.dialect, 'pg');
  assert.deepEqual(users.columns.map((item) => [item.name, item.builder, item.column]), [
    ['id', 'serial', 'id'], ['name', 'text', 'name'], ['email', 'varchar', 'email_address'], ['nickname', 'text', null], ['createdAt', 'timestamp', 'created_at'], ['state', 'status', 'state']]);
  assert.deepEqual(modifiers(column(users, 'email')), ['notNull', 'unique']);
  assert.match(column(users, 'email').args, /length/);
  assert.deepEqual(modifiers(column(users, 'createdAt')), ['notNull', 'defaultNow']);
  assert.equal(column(users, 'name').line, 8);
  assert.notEqual(users.extra, null, 'the third argument (indexes and constraints) has a digest');
  assert.deepEqual(modifiers(column(posts, 'authorId')), ['references']);
  assert.deepEqual(modifiers(column(posts, 'tags')), ['array']);
  assert.doesNotMatch(JSON.stringify(entities), /cascade|'active'/, 'modifier arguments are kept as digests, not as source text');
});

test('parseDrizzle reads mysqlTable and sqliteTable, an alias of an imported function, and a namespace import', () => {
  const mysql = "import { mysqlTable as table, int } from 'drizzle-orm/mysql-core';\nexport const a = table('a', { id: int('id').primaryKey() });\n";
  const sqlite = "import * as s from 'drizzle-orm/sqlite-core';\nexport const b = s.sqliteTable('b', { id: s.integer('id') });\n";
  assert.deepEqual(parseDrizzle('a.ts', mysql).entities.map((entity) => [entity.name, entity.dialect, entity.state]), [['a', 'mysql', 'read']]);
  assert.deepEqual(parseDrizzle('b.ts', sqlite).entities.map((entity) => [entity.name, entity.dialect, column(entity, 'id').builder]), [['b', 'sqlite', 'integer']]);
  assert.deepEqual(parseDrizzle('c.ts', "import { text as pgTable } from 'drizzle-orm/pg-core';\nexport const c = pgTable('c');\n").entities, [], 'an alias of another function is no table');
});

test('a table whose columns are not an object literal, or whose column is not a builder call, is UNKNOWN', () => {
  const head = "import { pgTable, text } from 'drizzle-orm/pg-core';\n";
  const cases = {
    'columns-not-object': "export const a = pgTable('a', (t) => ({ id: t.text() }));\n",
    'spread-columns': "export const a = pgTable('a', { ...shared, id: text('id') });\n",
    'column-not-builder': "export const a = pgTable('a', { id: idColumn });\n",
    'duplicate-column': "export const a = pgTable('a', { id: text('id'), 'id': text('id2') });\n",
  };
  for (const [reason, body] of Object.entries(cases)) {
    const { entities } = parseDrizzle('a.ts', head + body);
    assert.deepEqual(entities.map((entity) => [entity.name, entity.state, entity.reason, entity.columns.length]), [['a', 'unknown', reason, 0]], reason);
  }
  // A chain that does not start with a builder name must not read as a builder called notNull.
  for (const column of ["(text('id')).notNull()", "text('id')!.notNull()", "make()('id').notNull()"]) {
    const { entities } = parseDrizzle('a.ts', `${head}export const a = pgTable('a', { id: ${column} });\n`);
    assert.deepEqual(entities.map((entity) => [entity.state, entity.reason]), [['unknown', 'column-not-builder']], column);
  }
});

test('a table or an enum without a literal name, a pgSchema and a file that does not parse are unread and mark the file as incomplete', () => {
  const text = "import { pgTable, pgEnum, pgSchema, text } from 'drizzle-orm/pg-core';\nconst name = 'x';\nexport const a = pgTable(name, { id: text('id') });\n"
    + "export const e = pgEnum(name, ['a']);\nexport const s = pgSchema('auth');\nexport const v = pgEnum('v', values);\n";
  const { entities, unread } = parseDrizzle('a.ts', text);
  assert.deepEqual(unread.map((entry) => [entry.reason, entry.line, entry.lost]), [['table-name-not-literal', 3, true], ['enum-name-not-literal', 4, true], ['schema-tables', 5, true]]);
  assert.deepEqual(entities.map((entity) => [entity.name, entity.state, entity.reason]), [['v', 'unknown', 'values-not-literal']]);
});

test('mentionsDrizzle selects the files to parse, and drizzleOut reads a literal out field', () => {
  assert.equal(mentionsDrizzle(tables), true);
  assert.equal(mentionsDrizzle('export const pgTables = 1;'), false);
  assert.deepEqual(drizzleOut('drizzle.config.ts', "import { defineConfig } from 'drizzle-kit';\nexport default defineConfig({ schema: './src/db', out: './migrations' });\n"), { out: './migrations', problem: null });
  assert.deepEqual(drizzleOut('drizzle.config.ts', "export default { out: process.env.OUT } satisfies Config;\n"), { out: null, problem: 'out-not-literal' });
  assert.deepEqual(drizzleOut('drizzle.config.ts', 'export default { dialect: "sqlite" };\n'), { out: null, problem: null });
});
