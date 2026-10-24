import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePrisma } from '../lib/schemas/prisma.mjs';

const schema = `// A comment with a model User { word
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// The people who log in.
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique @map("email_address") // a comment "with a quote
  name      String?
  tags      String[]
  role      Role     @default(USER)
  posts     Post[]
  shape     Unsupported("circle")?
  updatedAt DateTime @updatedAt @db.Timestamptz(6)

  @@map("users")
  @@index([email, name])
}

model Post {
  id       Int  @id
  author   User @relation(fields: [authorId],
                          references: [id])
  authorId Int
}

enum Role {
  USER
  ADMIN @map("admin")
  @@map("roles")
}
`;

const byName = (entities, name) => entities.find((entity) => entity.name === name);

test('parsePrisma reads models, fields, attributes, @@map and enums, and skips comments, datasource and generator blocks', () => {
  const { entities, unread } = parsePrisma(schema);
  assert.deepEqual(unread, []);
  assert.deepEqual(entities.map((entity) => [entity.type, entity.name, entity.state, entity.line]), [['model', 'User', 'read', 12], ['model', 'Post', 'read', 26], ['enum', 'Role', 'read', 33]]);
  const user = byName(entities, 'User');
  assert.equal(user.map, 'users');
  assert.deepEqual(user.attributes.map((attribute) => attribute.split('(')[0]), ['@@index'], 'an attribute that Code-map does not classify keeps its name');
  const field = (name) => user.fields.find((item) => item.name === name);
  assert.deepEqual(user.fields.map((item) => [item.name, item.type, item.optional, item.list]), [
    ['id', 'Int', false, false], ['email', 'String', false, false], ['name', 'String', true, false], ['tags', 'String', false, true], ['role', 'Role', false, false],
    ['posts', 'Post', false, true], ['shape', 'Unsupported("circle")', true, false], ['updatedAt', 'DateTime', false, false]]);
  assert.notEqual(field('id').id, null);
  assert.notEqual(field('id').default, null);
  assert.equal(field('email').map, 'email_address', 'a comment after the attributes does not count');
  assert.notEqual(field('email').unique, null);
  assert.equal(field('name').default, null);
  assert.deepEqual(field('updatedAt').attributes.map((attribute) => attribute.split('(')[0]), ['@updatedAt', '@db.Timestamptz']);
  assert.equal(field('email').line, 14);
  const author = byName(entities, 'Post').fields.find((item) => item.name === 'author');
  assert.notEqual(author.relation, null, 'the arguments of an attribute can span lines');
  assert.deepEqual([author.foreignKey, field('posts').foreignKey], [true, false], 'the side with fields: holds the foreign key');
  assert.equal(parsePrisma('model A {\n  b B @relation("fields:")\n}\n').entities[0].fields[0].foreignKey, false, 'a relation name is not an argument');
  const role = byName(entities, 'Role');
  assert.equal(role.map, 'roles');
  assert.deepEqual(role.values.map((value) => [value.name, value.map]), [['USER', null], ['ADMIN', 'admin']]);
});

test('the default, relation and other attribute arguments are kept as digests, not as source text', () => {
  const { entities } = parsePrisma('model A {\n  id Int @id @default(dbgenerated("secret_function()"))\n}\n');
  const text = JSON.stringify(entities);
  assert.doesNotMatch(text, /secret_function/);
  const other = parsePrisma('model A {\n  id Int @id @default(dbgenerated("other()"))\n}\n').entities;
  assert.notEqual(entities[0].fields[0].default, other[0].fields[0].default, 'a changed default gives another digest');
  assert.notEqual(entities[0].digest, other[0].digest);
});

test('a comment or a change of spaces does not change the digest of a model', () => {
  const plain = parsePrisma('model A {\n  id Int @id\n  name String\n}\n').entities[0];
  const spaced = parsePrisma('// note\nmodel A {\n  id    Int @id // the key\n\n  name  String\n}\n').entities[0];
  assert.equal(plain.digest, spaced.digest);
});

test('a statement that the parser does not understand makes its model UNKNOWN, and the other models stay read', () => {
  const { entities, unread } = parsePrisma('model A {\n  id Int @id\n  + strange text\n}\n\nmodel B {\n  id Int @id\n}\n');
  assert.deepEqual(unread, []);
  assert.deepEqual(entities.map((entity) => [entity.name, entity.state, entity.reason]), [['A', 'unknown', 'unknown-statement'], ['B', 'read', null]]);
  assert.equal(entities[0].problemLine, 3);
  assert.deepEqual(entities[0].fields, [], 'an UNKNOWN model gives no fields that a comparison can read');
  for (const body of ['id Int @id @default(', 'id Int @map(variable)', 'id Int[]?', 'id Int @id @id', 'id Int\n  id String']) {
    assert.equal(parsePrisma(`model A {\n  ${body}\n}\n`).entities[0].state, 'unknown', body);
  }
  assert.equal(parsePrisma('enum E {\n  A B\n}\n').entities[0].state, 'unknown', 'two words on one enum line');
});

test('unknown blocks, text outside a block and a block without its closing brace are unread and mark the file as incomplete', () => {
  const { entities, unread } = parsePrisma('modle User {\n  id Int\n}\nstray words\nview Report {\n  id Int\n}\nmodel Open {\n  id Int @id\n');
  assert.deepEqual(unread.map((entry) => [entry.reason, entry.line, entry.lost]), [['unknown-block', 1, true], ['unknown-text', 4, true], ['unbalanced-block', 8, true]]);
  assert.equal(unread[0].keyword, 'modle');
  assert.deepEqual(entities.map((entity) => [entity.type, entity.name, entity.state, entity.reason]), [['view', 'Report', 'unknown', 'unsupported-block']]);
  const stray = parsePrisma(`${'stray line\n'.repeat(1000)}model A {\n  id Int @id\n}\nmore\nwords\n`);
  assert.deepEqual(stray.unread.map((entry) => [entry.reason, entry.line]), [['unknown-text', 1], ['unknown-text', 1004]], 'one entry for each run of stray lines, not one for each line');
  assert.deepEqual(stray.entities.map((entity) => [entity.name, entity.state]), [['A', 'read']]);
});

test('a string with a brace or two slashes does not end a block or start a comment', () => {
  const { entities, unread } = parsePrisma('model A {\n  id   Int    @id\n  json String @default("{ // }")\n}\n');
  assert.deepEqual(unread, []);
  assert.deepEqual([entities[0].state, entities[0].fields.length], ['read', 2]);
});
