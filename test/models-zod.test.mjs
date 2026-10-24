// Unit tests of the boundary values of Zod schemas (C22): each constraint with its values, non-literal limits (UNKNOWN),
// checks that Code-map does not read (PARTIAL), and the literals of a test file that name a value.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFile } from '../lib/analyze.mjs';
import { analyzeModels } from '../lib/models/models.mjs';
import { testModelFacts } from '../lib/models/test-facts.mjs';

/** The schemas of a source file that imports z from zod. The first line of `text` is line 2. */
const schemas = (text, header = "import { z } from 'zod';\n") => analyzeFile('src/schema.ts', header + text, () => null).models?.schemas ?? [];
const values = (field) => field.values.map((item) => [item.value, item.expected]);
const only = (text) => schemas(text)[0].fields;

test('number limits give n-1, n and n+1 for an integer, and the expected result from every limit of the field', () => {
  const [age] = schemas('export const Age = z.number().int().min(1).max(10);\n');
  assert.deepEqual([age.name, age.line, age.exported], ['Age', 2, true]);
  const [field] = age.fields;
  assert.deepEqual([field.path, field.type, field.integer, field.state], ['', 'number', true, 'KNOWN']);
  assert.deepEqual(field.limits, [{ check: 'min', limit: 1, inclusive: true }, { check: 'max', limit: 10, inclusive: true }]);
  assert.deepEqual(values(field), [[0, 'invalid'], [1, 'valid'], [2, 'valid'], [9, 'valid'], [10, 'valid'], [11, 'invalid']]);
  assert.deepEqual(field.values[2].near, [{ check: 'min', limit: 1, position: 'above' }]);
  assert.deepEqual(field.values[3].near, [{ check: 'max', limit: 10, position: 'below' }]);
  // gt, lt, gte and lte, and the sign checks, which have the limit 0.
  assert.deepEqual(values(only('const A = z.number().int().gt(0).lt(5);\n')[0]), [[-1, 'invalid'], [0, 'invalid'], [1, 'valid'], [4, 'valid'], [5, 'invalid'], [6, 'invalid']]);
  assert.deepEqual(values(only('const A = z.number().int().gte(-2).lte(-2);\n')[0]), [[-3, 'invalid'], [-2, 'valid'], [-1, 'invalid']], 'one value from two limits appears once');
  assert.deepEqual(values(only('const A = z.number().int().positive();\n')[0]), [[-1, 'invalid'], [0, 'invalid'], [1, 'valid']]);
  assert.deepEqual(values(only('const A = z.number().int().nonnegative();\n')[0]), [[-1, 'invalid'], [0, 'valid'], [1, 'valid']]);
  assert.deepEqual(values(only('const A = z.number().int().negative();\n')[0]), [[-1, 'valid'], [0, 'invalid'], [1, 'invalid']]);
  assert.deepEqual(values(only('const A = z.number().int().nonpositive();\n')[0]), [[-1, 'valid'], [0, 'valid'], [1, 'invalid']]);
  assert.deepEqual(values(only('const A = z.int().min(3);\n')[0]), [[2, 'invalid'], [3, 'valid'], [4, 'valid']], 'z.int() is an integer');
  assert.deepEqual(values(only('const A = z.coerce.number().int().max(7);\n')[0]), [[6, 'valid'], [7, 'valid'], [8, 'invalid']]);
});

test('a number that is not an integer gets a step one decimal place finer than its limit', () => {
  assert.deepEqual(values(only('const A = z.number().min(1);\n')[0]), [[0.9, 'invalid'], [1, 'valid'], [1.1, 'valid']]);
  assert.deepEqual(values(only('const A = z.number().positive().max(2.5);\n')[0]), [[-0.1, 'invalid'], [0, 'invalid'], [0.1, 'valid'], [2.49, 'valid'], [2.5, 'valid'], [2.51, 'invalid']]);
  assert.equal(only('const A = z.number().min(1);\n')[0].integer, false);
});

test('string and array limits give lengths, and a length below 0 is left out', () => {
  const [name] = only('const Name = z.string().min(3).max(255);\n');
  assert.deepEqual([name.type, name.integer], ['string', true]);
  assert.deepEqual(values(name), [[2, 'invalid'], [3, 'valid'], [4, 'valid'], [254, 'valid'], [255, 'valid'], [256, 'invalid']]);
  assert.deepEqual(values(only('const Code = z.string().length(5);\n')[0]), [[4, 'invalid'], [5, 'valid'], [6, 'invalid']]);
  assert.deepEqual(values(only('const A = z.string().nonempty();\n')[0]), [[0, 'invalid'], [1, 'valid'], [2, 'valid']]);
  assert.deepEqual(values(only('const A = z.string().min(0);\n')[0]), [[0, 'valid'], [1, 'valid']]);
  const [tags, element] = only('const Tags = z.array(z.string().max(20)).min(1).max(3);\n');
  assert.deepEqual([tags.path, tags.type, element.path, element.type], ['', 'array', '[]', 'string']);
  assert.deepEqual(values(tags), [[0, 'invalid'], [1, 'valid'], [2, 'valid'], [3, 'valid'], [4, 'invalid']]);
  assert.deepEqual(tags.values[2].near, [{ check: 'min', limit: 1, position: 'above' }, { check: 'max', limit: 3, position: 'below' }]);
  assert.deepEqual(values(element), [[19, 'valid'], [20, 'valid'], [21, 'invalid']]);
  assert.deepEqual(values(only('const A = z.array(z.number()).nonempty().length(2);\n')[0]), [[0, 'invalid'], [1, 'invalid'], [2, 'valid'], [3, 'invalid']]);
  const [list, item] = only('const A = z.string().min(1).array().max(3);\n');
  assert.deepEqual([list.path, list.type, values(list), item.path, values(item)], ['', 'array', [[2, 'valid'], [3, 'valid'], [4, 'invalid']], '[]', [[0, 'invalid'], [1, 'valid'], [2, 'valid']]],
    '.array() splits the chain into the element and the array');
  const [piped] = only('const A = z.string().min(2).transform((value) => value.length).pipe(z.number().max(9));\n');
  assert.deepEqual([piped.type, piped.state, piped.unread, values(piped)], ['string', 'PARTIAL', ['transform'], [[1, null], [2, null], [3, null]]], 'Code-map stops at a method that changes the type');
});

test('enum members and the fields of an object are read, also through extend and modifiers that change no limit', () => {
  const [role] = only("const Role = z.enum(['admin', 'user']).optional();\n");
  assert.deepEqual([role.type, role.members, role.state], ['enum', ['admin', 'user'], 'KNOWN']);
  assert.deepEqual(role.values, [{ value: 'admin', near: [{ check: 'enum', limit: null, position: 'member' }], expected: 'valid' },
    { value: 'user', near: [{ check: 'enum', limit: null, position: 'member' }], expected: 'valid' }]);
  const fields = only("const User = z.object({\n  age: z.number().int().min(18).default(18),\n  'full-name': z.string().min(1),\n  address: z.object({ zip: z.string().length(5) }),\n  active: z.boolean(),\n}).strict().extend({ score: z.number().int().max(100).nullable() });\n");
  assert.deepEqual(fields.map((field) => [field.path, field.type, field.line]), [['age', 'number', 3], ['full-name', 'string', 4], ['address.zip', 'string', 5], ['score', 'number', 7]]);
  assert.deepEqual(values(fields[0]), [[17, 'invalid'], [18, 'valid'], [19, 'valid']]);
});

test('a limit, an enum or a shape that is not a literal is UNKNOWN, and an unread check makes the field PARTIAL with no expected result', () => {
  const [limit, roles, shape, partial, email, refined] = schemas([
    'const MAX = 10;',
    'const Limit = z.number().min(MAX);',
    'const Roles = z.enum(roleList);',
    'const Shape = z.object(fields);',
    'const Partial = z.number().int().min(0).max(MAX);',
    'const Email = z.string().email().max(100);',
    'const Refined = z.number().int().min(1).refine((value) => value % 2 === 0);',
  ].join('\n') + '\n');
  assert.deepEqual([limit.name, limit.fields[0].state, limit.fields[0].values, limit.fields[0].unknown], ['Limit', 'UNKNOWN', [], [{ check: 'min', line: 3, reason: 'not-literal' }]]);
  assert.deepEqual([roles.fields[0].type, roles.fields[0].state, roles.fields[0].unknown], ['enum', 'UNKNOWN', [{ check: 'enum', line: 4, reason: 'not-literal' }]]);
  assert.deepEqual([shape.fields[0].type, shape.fields[0].state, shape.fields[0].unknown], ['object', 'UNKNOWN', [{ check: 'object', line: 5, reason: 'not-literal' }]]);
  assert.deepEqual([partial.fields[0].state, values(partial.fields[0])], ['PARTIAL', [[-1, null], [0, null], [1, null]]]);
  assert.deepEqual([email.fields[0].state, email.fields[0].unread, values(email.fields[0])], ['PARTIAL', ['email'], [[99, null], [100, null], [101, null]]]);
  assert.deepEqual([refined.fields[0].state, refined.fields[0].unread], ['PARTIAL', ['refine']]);
  assert.equal(schemas('const B = z.boolean();\nconst S = z.string();\n').length, 0, 'a schema without a limit has no boundary values');
});

test('only a file that imports zod counts, with a named, namespace or default import', () => {
  assert.deepEqual(schemas('const A = z.number().min(1);\n', ''), [], 'without an import, z is not zod');
  assert.deepEqual(schemas('const A = z.number().min(1);\n', "import { z } from './zod-like';\n"), []);
  assert.equal(schemas('const A = v.number().int().min(1);\n', "import * as v from 'zod';\n")[0].name, 'A');
  assert.equal(schemas('const A = zod.number().int().min(1);\n', "import zod from 'zod/v4';\n")[0].name, 'A');
  assert.equal(schemas('const A = q.number().int().min(1);\n', "import { z as q } from 'zod';\n")[0].name, 'A');
  assert.equal(analyzeFile('src/plain.ts', 'export const x = 1;\n', () => null).models, null, 'a file without zod or xstate records nothing');
});

test('test literals: numbers with their sign, strings with their lengths, array lengths and sent events', () => {
  const facts = testModelFacts('test/a.test.ts', "import { x } from '../src/schema';\nexpect(parse(-1)).toBe(11);\nparse('ab', `xyz`, [1, 2, 3], 'a'.repeat(256));\nactor.send({ type: 'OPEN' });\nsend('CLOSE');\nsend(other);\n");
  assert.deepEqual([...facts.numbers].sort((a, b) => a - b), [-1, 1, 2, 3, 11, 256]);
  assert.deepEqual([...facts.strings].sort(), ['CLOSE', 'OPEN', 'a', 'ab', 'xyz']);
  assert.ok(facts.stringLengths.has(2) && facts.stringLengths.has(3) && !facts.stringLengths.has('../src/schema'.length), 'the import specifier does not count');
  assert.ok(facts.arrayLengths.has(3));
  assert.deepEqual([...facts.sends].sort(), ['CLOSE', 'OPEN']);
});

test('a value is named in a test only when a test file that imports the schema file contains its literal', () => {
  const file = analyzeFile('src/schema.ts', "import { z } from 'zod';\nexport const Age = z.number().int().min(1).max(10);\nexport const Name = z.string().min(3);\nexport const Role = z.enum(['admin', 'user']);\n", () => null);
  const tests = [{ path: 'test/schema.test.ts', imports: ['src/schema.ts'] }, { path: 'test/other.test.ts', imports: [] }];
  const texts = new Map([['test/schema.test.ts', "parse(0); parse(11); name('ab'); role('admin');\n"], ['test/other.test.ts', 'parse(1); parse(10);\n']]);
  const { boundaries } = analyzeModels({ files: [file], testFacts: tests, texts });
  const [age, name, role] = boundaries;
  assert.deepEqual([age.file, age.tests], ['src/schema.ts', ['test/schema.test.ts']]);
  assert.deepEqual(age.fields[0].values.map((item) => [item.value, item.named]), [[0, true], [1, false], [2, false], [9, false], [10, false], [11, true]],
    'the other test contains 1 and 10, but it does not import the schema file');
  assert.deepEqual(age.fields[0].values[0].tests, ['test/schema.test.ts']);
  assert.deepEqual(name.fields[0].values.map((item) => [item.value, item.named]), [[2, true], [3, false], [4, false]], 'a string literal of length 2 names the length 2');
  assert.deepEqual(role.fields[0].values.map((item) => [item.value, item.named]), [['admin', true], ['user', false]]);
});
