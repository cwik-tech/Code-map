import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, projectName, readTestEntrypoints } from '../lib/project.mjs';
import { apiFingerprint, loadDescriptions } from '../lib/descriptions.mjs';
import { loadTestLabels, stampTestLabels } from '../lib/test-labels.mjs';
import { readCoverage } from '../lib/coverage.mjs';
import { readMutation } from '../lib/mutation-report.mjs';
import { mutate, outcome, parseResult } from '../lib/mutation-run.mjs';
import { createReport } from '../lib/analysis.mjs';
import { readHistory } from '../lib/history.mjs';
import { chatWorkspace, privateRoot } from '../lib/snapshot.mjs';

function folder(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-boundaries-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('description files preserve legacy summaries and reject non-object documents', (t) => {
  const path = join(folder(t), 'descriptions.json');
  assert.deepEqual(loadDescriptions(path), { modules: {}, folders: {}, files: {}, tour: [] });
  writeFileSync(path, JSON.stringify({ files: { 'a.mjs': 'Explains a.' }, modules: { lib: 'Core' }, tour: ['a.mjs'] }));
  assert.deepEqual(loadDescriptions(path), { modules: { lib: 'Core' }, folders: {}, files: { 'a.mjs': { summary: 'Explains a.' } }, tour: ['a.mjs'] });
  writeFileSync(path, '[]');
  assert.throws(() => loadDescriptions(path), /expected an object/);
  assert.equal(apiFingerprint({ exports: ['a'] }), 'ca978112ca1b');
  assert.notEqual(apiFingerprint({ exports: ['a'] }), apiFingerprint({ exports: ['b'] }));
});

test('label files reject non-object documents and stamping a missing file writes nothing', (t) => {
  const path = join(folder(t), 'labels.json');
  assert.equal(stampTestLabels(path, [], new Map(), false), 0);
  assert.throws(() => readFileSync(path), { code: 'ENOENT' });
  writeFileSync(path, '[]');
  assert.throws(() => loadTestLabels(path), /expected an object/);
});

test('missing measured reports remain explicitly unknown and malformed mutation reports remain readable errors', (t) => {
  const root = folder(t);
  assert.equal(readCoverage(root, {}), null);
  assert.equal(readMutation(root, {}, {}, new Map()), null);
  writeFileSync(join(root, 'mutation.json'), '{');
  const report = readMutation(root, {}, { mutation: 'mutation.json' }, new Map());
  assert.equal(report.error, 'The report is not valid JSON.');
  assert.deepEqual(report.files, {});
  assert.equal(parseResult('json', '', join(root, 'missing.json')), null);
  assert.deepEqual(outcome([{ status: 1, result: null, timedOut: false }], [{ result: { discovered: 1 } }]),
    { status: 'error', detail: 'no readable test result' });
});

for (const [name, value] of [['array', []], ['string', 'bad'], ['number', 4]]) {
  test(`configuration rejects a ${name} document`, (t) => {
    const root = folder(t);
    writeFileSync(join(root, '.code-map.json'), JSON.stringify(value));
    assert.throws(() => loadConfig(root), /must be an object/);
  });
}
for (const value of ['README.md', ['../secret'], ['/absolute'], ['docs//x'], [12]]) {
  test(`configuration rejects invalid execution inputs ${JSON.stringify(value)}`, (t) => {
    const root = folder(t);
    writeFileSync(join(root, '.code-map.json'), JSON.stringify({ executionInputs: value }));
    assert.throws(() => loadConfig(root), /executionInputs/);
  });
}

test('entrypoint mappings reject invalid shapes and unknown files while deduplicating valid targets', () => {
  assert.throws(() => readTestEntrypoints([]), /must be an object/);
  assert.throws(() => readTestEntrypoints({ 'test/a.mjs': [] }), /must map/);
  assert.throws(() => readTestEntrypoints({ '../a': ['src/a.mjs'] }), /must map/);
  assert.throws(() => readTestEntrypoints({ 'test/a.mjs': ['src/missing.mjs'] }, new Set(['src/a.mjs']), new Set(['test/a.mjs'])), /unmapped/);
  assert.throws(() => readTestEntrypoints({ 'test/unknown.mjs': ['src/a.mjs'] }, new Set(['src/a.mjs']), new Set(['test/a.mjs'])), /unmapped/);
  assert.deepEqual(readTestEntrypoints({ 'test/a.mjs': ['src/a.mjs', 'src/a.mjs'] }), { 'test/a.mjs': ['src/a.mjs'] });
});

test('project names prefer the manifest and fall back to the folder for an invalid or nameless manifest', () => {
  assert.equal(projectName(new Map([['package.json', '{"name":"named"}']]), '/projects/fallback'), 'named');
  assert.equal(projectName(new Map([['package.json', '{']]), '/projects/fallback'), 'fallback');
  assert.equal(projectName(new Map(), '/projects/fallback'), 'fallback');
});

test('reports refuse missing analysis and unavailable change selections', () => {
  assert.throws(() => createReport({}), /Analysis is missing/);
  assert.throws(() => createReport({ analysis: {} }, { change: 'latest' }), /unavailable/);
});

test('targeted mutation refuses an empty eligible selection before creating a workspace', () => {
  assert.throws(() => mutate({ files: ['src/a.mjs'], data: { analysis: { tests: { units: [] } } } }), /No function/);
});

test('history includes an empty source snapshot before the source first appeared, and chat uses the requested live snapshot', (t) => {
  const root = folder(t);
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  git('init', '-q');
  writeFileSync(join(root, 'README.md'), 'initial\n');
  git('add', '.'); git('commit', '-qm', 'initial');
  writeFileSync(join(root, 'a.mjs'), 'export const a = 1;\n');
  git('add', '.'); git('commit', '-qm', 'source');
  const sha = git('rev-parse', 'HEAD').trim();
  const history = readHistory(root, sha, ['a.mjs'], () => true, 10);
  assert.equal(history[0].sizes.size, 0);
  assert.equal(history[1].sizes.get('a.mjs'), 1);
  assert.equal(chatWorkspace(root, sha, 'HEAD', true).directory, root);
  assert.match(chatWorkspace(root, sha, 'HEAD', true).note, /uncommitted/);
  assert.equal(chatWorkspace(root, sha, 'HEAD', false).directory, root);
  assert.match(chatWorkspace(root, sha, 'HEAD', false).note, /checked-out commit/);
});


test('the private snapshot root returns its existing directory on every supported platform', () => {
  const root = privateRoot();
  assert.equal(root, join(tmpdir(), 'code-map-chat'));
  assert.equal(statSync(root).isDirectory(), true);
});
