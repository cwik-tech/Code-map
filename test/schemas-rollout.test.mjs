// Rollout leads use real schema parsing and bounded source syntax.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inventory } from './schemas-fixtures.mjs';
import { schemaRollout } from '../lib/schemas/rollout.mjs';
const model = (field) => `model User {\n id Int @id\n ${field}\n}\n`;
function rollout(before, after, oldCode, code) {
  return schemaRollout(inventory(before), inventory(after), new Map([['src/use.ts', oldCode]]), new Map([['src/use.ts', code]]));
}
test('removed Prisma fields retain select, where and data consumers', () => {
  const result = rollout({ 'prisma/schema.prisma': model('name String') }, { 'prisma/schema.prisma': model('') }, '',
    'prisma.user.findMany({ select: { name: true }, where: { name: "A" } }); prisma.user.create({ data: { name: "B" } });');
  assert.equal(result.leads[0].kind, 'contract-before-expand');
  assert.equal(result.leads[0].headUses.length, 3);
  assert.equal(result.leads[0].headUses[0].syntax, 'prisma');
});
test('removed Drizzle columns and tables retain member consumers', () => {
  const before = { 'schema.ts': "export const users = sqliteTable('users', { name: text('name') });" };
  const after = { 'schema.ts': "export const users = sqliteTable('users', {});" };
  assert.equal(rollout(before, after, '', 'db.select().from(users).where(eq(users.name, "A"));').leads[0].headUses[0].syntax, 'drizzle');
  assert.equal(rollout(before, {}, '', 'db.select().from(users).where(eq(users.name, "A"));').leads[0].kind, 'contract-before-expand');
});
test('renamed database fields and tables retain raw SQL consumers', () => {
  const before = { 'prisma/schema.prisma': model('name String @map("old_name")') };
  const after = { 'prisma/schema.prisma': model('name String @map("full_name")') };
  const result = rollout(before, after, '', 'db.query(`SELECT old_name FROM "User"`);');
  assert.equal(result.leads[0].headUses[0].syntax, 'sql');
  assert.equal(rollout({ 'prisma/schema.prisma': model('') }, {}, '', 'db.query("SELECT * FROM User");').leads[0].kind, 'contract-before-expand');
});
test('a same-change consumer removal is a one-step contract with deployment risk', () => {
  const result = rollout({ 'prisma/schema.prisma': model('name String') }, { 'prisma/schema.prisma': model('') },
    'prisma.user.findMany({ select: { name: true } });', 'prisma.user.findMany({ select: { id: true } });');
  assert.equal(result.leads[0].kind, 'one-step-contract');
  assert.match(result.leads[0].note, /old code.*fail/);
});
test('unobserved consumers remain unknown and comments do not count', () => {
  const result = rollout({ 'prisma/schema.prisma': model('name String') }, { 'prisma/schema.prisma': model('') }, '',
    '// prisma.user.findMany({ select: { name: true } });\nconst x = "name";');
  assert.equal(result.leads[0].kind, 'UNKNOWN');
});

test('verify exposes rollout information without adding profile obligations', async (t) => {
  const { project } = await import('./worker-fixtures.mjs');
  const { runVerify } = await import('../lib/verify.mjs');
  const { loadConfig } = await import('../lib/project.mjs');
  const { join } = await import('node:path');
  const f = project(t);
  f.put('prisma/schema.prisma', model('name String'));
  f.put('src/use.ts', 'prisma.user.findMany({ select: { name: true } });');
  f.git('add', '.'); f.git('commit', '-qm', 'before'); f.git('branch', 'before');
  f.put('prisma/schema.prisma', model(''));
  f.git('add', '.'); f.git('commit', '-qm', 'remove name');
  f.put('request.json', JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'before', head: 'HEAD',
    intent: 'Remove a field.', acceptanceCriteria: [], allowedPaths: ['**'], changeType: 'other',
    profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
  const result = runVerify(f.root, loadConfig(f.root), { request: join(f.root, 'request.json'), store: f.store });
  assert.equal(result.results.schemaRollout.leads[0].kind, 'contract-before-expand');
  assert.equal(result.results.schemaRollout.informationOnly, true);
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(result.paths.markdownPath, 'utf8'), /contract-before-expand/);
  assert.equal(result.results.obligations.some((item) => /rollout|migrate/.test(item.id)), false);
});

test('database table mapping changes do not make stable Prisma properties stale', () => {
  const before = { 'prisma/schema.prisma': model('@@map("old_users")') };
  const after = { 'prisma/schema.prisma': model('@@map("users")') };
  const result = rollout(before, after, 'db.query("SELECT * FROM old_users");', 'prisma.user.findMany();');
  assert.equal(result.leads[0].kind, 'one-step-contract');
  assert.equal(result.leads[0].headUses.length, 0);
});
test('moved schema files still join renamed database columns by package and model', () => {
  const before = { 'package.json': JSON.stringify({ prisma: { schema: 'before.prisma' } }), 'before.prisma': model('name String @map("old_name")') };
  const after = { 'package.json': JSON.stringify({ prisma: { schema: 'after.prisma' } }), 'after.prisma': model('name String @map("new_name")') };
  assert.equal(rollout(before, after, '', 'db.query("SELECT old_name FROM User");').leads[0].kind, 'contract-before-expand');
});
test('renamed Drizzle tables do not retain consumers of a remapped table variable', () => {
  const before = { 'schema.ts': "export const users = sqliteTable('old_users', { name: text('name') });" };
  const after = { 'schema.ts': "export const users = sqliteTable('users', { name: text('name') });" };
  assert.equal(rollout(before, after, 'use(users.name);', 'use(users.name);').leads[0].kind, 'one-step-contract');
});
