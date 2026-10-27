import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGraphql } from '../lib/contracts/graphql.mjs';
import { parseProto } from '../lib/contracts/proto.mjs';
import { compareContracts } from '../lib/contracts/compare.mjs';
const changes = (parse, a, b) => compareContracts([{ path: 'api', ...parse(a) }], [{ path: 'api', ...parse(b) }]);

test('GraphQL reads fields, arguments, enums, inputs and unions', () => {
  const result = parseGraphql('type Query { user(id: ID!, limit: Int = 2): User } type User { id: ID! } enum Role { ADMIN USER } input Filter { role: Role } union Result = User | Query');
  assert.deepEqual(result.types.map((x) => [x.kind, x.name, x.state]), [['type', 'Query', 'KNOWN'], ['type', 'User', 'KNOWN'], ['enum', 'Role', 'KNOWN'], ['input', 'Filter', 'KNOWN'], ['union', 'Result', 'KNOWN']]);
  assert.equal(result.types[0].fields[0].args[0].type, 'ID!');
});
for (const [name, a, b, reason, state] of [
  ['removed type', 'type T { a: Int }', '', 'removed-type', 'BREAKING'],
  ['removed field', 'type T { a: Int b: Int }', 'type T { a: Int }', 'removed-field', 'BREAKING'],
  ['field type', 'type T { a: Int }', 'type T { a: String }', 'changed-field-type', 'BREAKING'],
  ['enum value', 'enum E { A B }', 'enum E { A }', 'removed-enum-value', 'BREAKING'],
  ['required argument', 'type T { a: Int }', 'type T { a(id: ID!): Int }', 'required-argument', 'BREAKING'],
  ['optional field', 'type T { a: Int }', 'type T { a: Int b: String }', 'added-field', 'COMPATIBLE'],
  ['default argument', 'type T { a: Int }', 'type T { a(id: ID! = "x"): Int }', 'optional-argument', 'COMPATIBLE'],
]) test(`GraphQL classifies ${name}`, () => assert.ok(changes(parseGraphql, a, b).some((x) => x.reason === reason && x.state === state)));

test('GraphQL unsupported directives, interfaces and extensions are UNKNOWN', () => {
  assert.equal(parseGraphql('type T { a: Int @custom }').types[0].state, 'UNKNOWN');
  assert.equal(parseGraphql('interface T { a: Int }').types[0].state, 'UNKNOWN');
  assert.equal(parseGraphql('type T { a: Int } extend type T { b: Int }').types[0].state, 'UNKNOWN');
  assert.equal(changes(parseGraphql, 'type T { a: Int }', 'type T { a: Int @custom }')[0].state, 'UNKNOWN');
});

test('Proto reads numbered fields, enums and service methods', () => {
  const result = parseProto('syntax = "proto3"; package api; message User { string id = 1; repeated int32 ids = 2; } enum Role { NONE = 0; USER = 1; } service Users { rpc Get (User) returns (User); }');
  assert.deepEqual(result.types.map((x) => [x.kind, x.name, x.state]), [['message', 'User', 'KNOWN'], ['enum', 'Role', 'KNOWN'], ['service', 'Users', 'KNOWN']]);
  assert.equal(result.types[0].fields[1].number, 2);
});
for (const [name, a, b, reason, state] of [
  ['removed field', 'message T { string a = 1; }', 'message T {}', 'removed-field', 'BREAKING'],
  ['reserved removal', 'message T { string a = 1; }', 'message T { reserved 1; }', 'reserved-field', 'COMPATIBLE'],
  ['number change', 'message T { string a = 1; }', 'message T { string a = 2; }', 'changed-field-number', 'BREAKING'],
  ['type change', 'message T { string a = 1; }', 'message T { int32 a = 1; }', 'changed-field-type', 'BREAKING'],
  ['reused number', 'message T { string a = 1; }', 'message T { string b = 1; }', 'reused-field-number', 'BREAKING'],
  ['new field', 'message T { string a = 1; }', 'message T { string a = 1; int32 b = 2; }', 'added-field', 'COMPATIBLE'],
  ['removed method', 'service T { rpc Get (A) returns (B); }', 'service T {}', 'removed-method', 'BREAKING'],
]) test(`Proto classifies ${name}`, () => assert.ok(changes(parseProto, a, b).some((x) => x.reason === reason && x.state === state)));

test('Proto unsupported nested messages, options and oneof are UNKNOWN', () => {
  assert.equal(parseProto('message T { oneof value { string a = 1; } }').types[0].state, 'UNKNOWN');
  assert.equal(parseProto('message T { message Inner {} }').types[0].state, 'UNKNOWN');
  assert.equal(parseProto('message T { string a = 1 [deprecated=true]; }').types[0].state, 'UNKNOWN');
});
