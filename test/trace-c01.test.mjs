// Traceability for C01 (broken imports): the loader conventions that Code-map cannot resolve are marked with a skip reason
// instead of being reported as a broken import (lib/packages/manifests.mjs `classify`).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { analyzeProject } from '../lib/analysis.mjs';
import { deriveFindings, fingerprintOf } from '../lib/findings.mjs';
import { classify } from '../lib/packages/manifests.mjs';

test('unsupported loader conventions are marked with a skip reason, never a broken import', () => {
  assert.deepEqual(classify('/abs'), { kind: 'skip', reason: 'absolute' });
  assert.deepEqual(classify('x?raw'), { kind: 'skip', reason: 'loader' });
  assert.deepEqual(classify('x!y'), { kind: 'skip', reason: 'loader' });
  assert.deepEqual(classify('#internal'), { kind: 'skip', reason: 'subpath-import' });
  assert.deepEqual(classify('virtual:thing'), { kind: 'skip', reason: 'scheme' });
  assert.deepEqual(classify('@/bad'), { kind: 'skip', reason: 'invalid-name' });
  assert.deepEqual(classify('node:fs'), { kind: 'builtin' });
  assert.deepEqual(classify('react'), { kind: 'package', name: 'react', subpath: '.' });
});

// Section 10.1 asks for the specifier span.

test('unresolved import findings include the specifier column and end position', () => {
  const path = 'src/a.ts', source = "import { x } from './missing';";
  const file = analyzeFile(path, source, createResolver(new Set([path]), { aliases: [], baseUrl: null }));
  const analysis = analyzeProject({ files: [file], testFiles: [], coChanges: { changes: {} } });
  const finding = deriveFindings(analysis).find((item) => item.ruleId === 'IMPORT-UNRESOLVED');
  assert.deepEqual([finding.location.path, finding.location.line, finding.facts.specifier], [path, 1, './missing']);
  assert.equal(finding.fingerprint, fingerprintOf('IMPORT-UNRESOLVED', [path, './missing']));
  assert.deepEqual([finding.location.column, finding.location.endLine, finding.location.endColumn], [19, 1, 30]);
});


for (const source of ["export { x } from\n  './missing';", "const x = import(\n  './missing');", "const x = require(\n  './missing');", "import x = require(\n  './missing');", "type X = import(\n  './missing').X;"]) {
  test(`unresolved specifier spans follow the literal across lines: ${source.split('\n')[0]}`, () => {
    const path = 'src/a.ts';
    const file = analyzeFile(path, source, createResolver(new Set([path]), { aliases: [], baseUrl: null }));
    const analysis = analyzeProject({ files: [file], testFiles: [], coChanges: { changes: {} } });
    const finding = deriveFindings(analysis).find((item) => item.ruleId === 'IMPORT-UNRESOLVED');
    assert.deepEqual(finding.location, { path, line: 2, column: 3, endLine: 2, endColumn: 14, symbol: null });
    assert.equal(finding.fingerprint, fingerprintOf('IMPORT-UNRESOLVED', [path, './missing']));
  });
}
