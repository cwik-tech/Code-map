// The adapter for Istanbul JSON coverage (coverage-final.json): statementMap with s, fnMap with f and branchMap with b.
// The report is untrusted input: a missing map, a count that does not match its map or a bad location makes it unreadable.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseIstanbul, supportedProducers } from '../lib/adapters/istanbul.mjs';

const at = (line, column, endLine = line, endColumn = column + 10) => ({ start: { line, column }, end: { line: endLine, column: endColumn } });
/** One file entry of an engine function: three statements, one function and an if without an else. */
const entry = (path, fields = {}) => ({ path, statementMap: { 0: at(2, 2), 1: at(3, 2, 5, 3), 2: at(4, 4) }, s: { 0: 1, 1: 1, 2: 0 },
  fnMap: { 0: { name: 'engine', decl: at(1, 16, 1, 22), loc: at(1, 39, 10, 1), line: 1 } }, f: { 0: 1 },
  branchMap: { 0: { loc: at(3, 2, 5, 3), type: 'if', locations: [at(3, 2, 5, 3), { start: {}, end: {} }], line: 3 } }, b: { 0: [0, 1] }, ...fields });
const report = (...entries) => JSON.stringify(Object.fromEntries(entries.map((item) => [item.path, item])));
const refused = (text, pattern, options) => {
  const result = parseIstanbul(text, options);
  assert.equal(result.ok, false, 'the report is refused');
  assert.match(result.error, pattern);
};

test('the adapter declares its producers and reads the statements, functions and branches with their locations and counts', () => {
  assert.deepEqual(supportedProducers.map((item) => item.name), ['Istanbul JSON (coverage-final.json)']);
  // Istanbul, Jest and Vitest add _coverageSchema and hash, and c8 adds all. The adapter accepts them and reads only the maps.
  const result = parseIstanbul(`﻿${report(entry('/work/repo/src/a.ts', { _coverageSchema: 'x', hash: 'y', all: false }), entry('src/b.ts', { inputSourceMap: null }))}`);
  assert.equal(result.ok, true, result.error);
  const [first, second] = result.report.files;
  assert.deepEqual([first.path, first.sourceMap, second.path, second.sourceMap], ['/work/repo/src/a.ts', false, 'src/b.ts', false]);
  assert.deepEqual(first.statements, [{ id: '0', ...at(2, 2), count: 1 }, { id: '1', ...at(3, 2, 5, 3), count: 1 }, { id: '2', ...at(4, 4), count: 0 }]);
  assert.deepEqual(first.functions, [{ id: '0', name: 'engine', decl: at(1, 16, 1, 22), loc: at(1, 39, 10, 1), count: 1 }]);
  // The else of an if without an else has an empty location in Istanbul. The adapter keeps it as null.
  assert.deepEqual(first.branches, [{ id: '0', type: 'if', loc: at(3, 2, 5, 3), paths: [{ location: at(3, 2, 5, 3), count: 0 }, { location: null, count: 1 }] }]);
  assert.deepEqual(parseIstanbul('{}').report.files, [], 'a report without a file entry is valid JSON with no file');
});

test('an end column of null is accepted, and an entry with an input source map is marked', () => {
  const open = { start: { line: 2, column: 0 }, end: { line: 2, column: null } };
  const result = parseIstanbul(report(entry('src/a.ts', { statementMap: { 0: open }, s: { 0: 3 } }), entry('src/gen.js', { inputSourceMap: { version: 3, mappings: '' } })));
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.report.files[0].statements, [{ id: '0', ...open, count: 3 }]);
  assert.equal(result.report.files[1].sourceMap, true, 'the locations of this entry are of the generated code, not of the source file');
});

test('a missing map or count object makes the report unreadable, and the error names the file and the field', () => {
  for (const field of ['statementMap', 's', 'fnMap', 'f', 'branchMap', 'b']) {
    const broken = entry('src/a.ts');
    delete broken[field];
    refused(report(broken), new RegExp(`"src/a\\.ts".*\\b${field}\\b.*Must be an object`));
  }
  refused(JSON.stringify({ 'src/a.ts': [] }), /"src\/a\.ts".*Must be an object/);
  refused(report(entry('src/a.ts', { fnMap: { 0: { name: 7, decl: at(1, 0), loc: at(1, 0) } } })), /fnMap\["0"\]\.name.*string/);
  refused(report(entry('src/a.ts', { branchMap: { 0: { loc: at(3, 2), type: 'if', locations: [] } } })), /branchMap\["0"\]\.locations.*at least one/);
});

test('counts that do not match the map make the report unreadable', () => {
  const cases = [
    [{ s: { 0: 1, 1: 1 } }, /\bs\b.*no count for the entry "2" of statementMap/],
    [{ s: { 0: 1, 1: 1, 2: 0, 3: 4 } }, /s\["3"\].*no entry in statementMap/],
    [{ f: {} }, /\bf\b.*no count for the entry "0" of fnMap/],
    [{ b: { 0: [0] } }, /b\["0"\].*2 counts, one for each location/],
    [{ b: { 0: 1 } }, /b\["0"\].*2 counts/],
    [{ s: { 0: -1, 1: 1, 2: 0 } }, /s\["0"\].*whole number from 0/],
    [{ f: { 0: 1.5 } }, /f\["0"\].*whole number from 0/],
  ];
  for (const [fields, pattern] of cases) refused(report(entry('src/a.ts', fields)), pattern);
  // A key of the report is untrusted, so the message quotes it and cuts it to 200 characters.
  const long = parseIstanbul(report(entry('src/a.ts', { s: { 0: 1, 1: 1, 2: 0, ['k'.repeat(5000)]: 1 } })));
  assert.match(long.error, /s\["k{197}\.\.\."\]: Has no entry in statementMap/);
  assert.ok(long.error.length < 300, `${long.error.length} characters`);
});

test('a location that is not a line range makes the report unreadable', () => {
  refused(report(entry('src/a.ts', { statementMap: { 0: at(0, 0), 1: at(3, 2), 2: at(4, 4) } })), /statementMap\["0"\]\.start\.line.*whole number from 1/);
  refused(report(entry('src/a.ts', { statementMap: { 0: at(5, 0, 4, 1), 1: at(3, 2), 2: at(4, 4) } })), /statementMap\["0"\].*ends on a line before its start line/);
  refused(report(entry('src/a.ts', { statementMap: { 0: { start: { line: 2 }, end: { line: 2, column: 1 } }, 1: at(3, 2), 2: at(4, 4) } })), /start\.column.*whole number from 0, or null/);
  refused(report(entry('src/a.ts', { statementMap: { 0: { start: {}, end: {} }, 1: at(3, 2), 2: at(4, 4) } })), /statementMap\["0"\]\.start\.line/, 'only a branch location can be empty');
  refused(report(entry('src/a.ts', { branchMap: { 0: { loc: at(3, 2), type: 'if', locations: [at(3, 2), { start: {}, end: { line: 4, column: 1 } }] } } })), /locations\[1\].*both a start and an end, or neither/);
});

test('a report that is too large, not JSON, not an object or with a path that differs from its key is unreadable', () => {
  const text = report(entry('src/a.ts'));
  refused(text, /larger than 100 bytes/, { maxBytes: 100 });
  assert.equal(parseIstanbul(text, { maxBytes: Buffer.byteLength(text) }).ok, true, 'a report of exactly the limit is read');
  refused('{"src/a.ts": ', /not valid JSON/);
  refused('[]', /must be a JSON object/);
  refused(JSON.stringify({ 'src/a.ts': entry('src/b.ts') }), /"src\/a\.ts"\]\.path: Must be the same path as its key/);
  refused(JSON.stringify({ '': entry('') }), /empty file path/);
  refused(7, /must be text/);
});

test('a range with its end before its start column on the same line is refused', () => {
  refused(report(entry('src/a.ts', { statementMap: { 0: at(2, 10, 2, 3) }, s: { 0: 1 } })), /ends before its start column/);
  refused(report(entry('src/a.ts', { fnMap: { 0: { name: 'engine', decl: at(1, 10, 1, 3), loc: at(1, 20, 4, 1) } } })), /ends before its start column/);
  refused(report(entry('src/a.ts', { branchMap: { 0: { loc: at(3, 2), type: 'if', locations: [at(3, 10, 3, 2), at(3, 2)] } } })), /ends before its start column/);
});
