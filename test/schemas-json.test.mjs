import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseJsonSchema } from '../lib/schemas/json-schema.mjs';

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'User', type: 'object', required: ['id', 'address'],
  properties: {
    id: { type: 'string', description: 'The key.' },
    role: { enum: ['admin', 'user'] },
    address: { type: 'object', required: ['street'], properties: { street: { type: 'string' }, 'zip/code': { type: ['string', 'null'] } } },
    tags: { type: 'array', items: { type: 'object', properties: { label: { type: 'string', minLength: 1 } } } },
  },
};
const nodes = (text) => Object.fromEntries(parseJsonSchema(text).entities[0].nodes.map((node) => [node.pointer, node]));

test('parseJsonSchema reads the type, enum, required and properties of each object, also in nested objects and array items', () => {
  const { entities, unread } = parseJsonSchema(JSON.stringify(schema, null, 2));
  assert.equal(entities.length, 1);
  assert.deepEqual([entities[0].type, entities[0].state], ['schema', 'read']);
  const map = nodes(JSON.stringify(schema));
  assert.deepEqual(Object.keys(map), ['', '/properties/id', '/properties/role', '/properties/address', '/properties/address/properties/street',
    '/properties/address/properties/zip~1code', '/properties/tags', '/properties/tags/items', '/properties/tags/items/properties/label']);
  assert.deepEqual(map[''].required, ['address', 'id']);
  assert.deepEqual(map['/properties/address'].required, ['street']);
  assert.deepEqual(map['/properties/address/properties/zip~1code'].type, ['null', 'string']);
  assert.deepEqual(map['/properties/role'].enum, ['"admin"', '"user"']);
  assert.equal(map['/properties/id'].other, null, 'annotations such as description are not compared');
  assert.deepEqual([map['/properties/address/properties/street'].parent, map['/properties/address/properties/street'].name], ['/properties/address', 'street']);
  assert.deepEqual([map['/properties/tags/items'].parent, map['/properties/tags/items'].name], ['/properties/tags', null]);
  assert.deepEqual(map['/properties/tags/items/properties/label'].otherKeys, ['minLength']);
  assert.deepEqual(map[''].otherKeys, ['$schema']);
  assert.deepEqual(unread.map((entry) => [entry.reason, entry.keys, entry.lost]), [['keywords-not-compared', ['$schema', 'minLength'], false]]);
});

test('a key order or a space does not change the digest, and a change of a property does', () => {
  const text = JSON.stringify(schema), reordered = JSON.stringify({ properties: schema.properties, required: schema.required, type: 'object', title: 'User', $schema: schema.$schema });
  assert.equal(parseJsonSchema(text).entities[0].digest, parseJsonSchema(` ${reordered}\n`).entities[0].digest);
  const changed = structuredClone(schema); changed.properties.id.type = 'number';
  assert.notEqual(parseJsonSchema(text).entities[0].digest, parseJsonSchema(JSON.stringify(changed)).entities[0].digest);
});

test('a keyword with an unexpected value and a boolean schema are compared only as a digest', () => {
  const map = nodes(JSON.stringify({ type: 'object', required: 'id', properties: { id: true, name: { type: 7 } } }));
  assert.deepEqual([map[''].required, map[''].otherKeys], [null, ['required']]);
  assert.deepEqual(map['/properties/id'].otherKeys, ['(boolean schema)']);
  assert.deepEqual([map['/properties/name'].type, map['/properties/name'].otherKeys], [null, ['type']]);
});

test('a property named __proto__ is a property, not a prototype', () => {
  const map = nodes('{"type":"object","properties":{"__proto__":{"type":"string","x-extra":1}}}');
  assert.deepEqual([map['/properties/__proto__'].type, map['/properties/__proto__'].otherKeys], [['string'], ['x-extra']]);
});

test('invalid JSON, a file that is not an object and a too deep schema are UNKNOWN or unread', () => {
  assert.deepEqual(parseJsonSchema('{ "type": ').unread.map((entry) => [entry.reason, entry.lost]), [['invalid-json', true]]);
  assert.deepEqual(parseJsonSchema('[1, 2]').unread.map((entry) => [entry.reason, entry.lost]), [['not-an-object', true]]);
  assert.deepEqual(parseJsonSchema('{ "type": ').entities, []);
  let deep = { type: 'string' };
  for (let level = 0; level < 40; level++) deep = { type: 'object', properties: { next: deep } };
  const { entities, unread } = parseJsonSchema(JSON.stringify(deep));
  assert.equal(entities[0].state, 'read');
  assert.ok(entities[0].nodes.length < 40, 'the reader stops at its depth limit');
  assert.deepEqual(unread.map((entry) => [entry.reason, entry.keys]), [['keywords-not-compared', ['(nested too deep)']]]);
});
