import assert from 'node:assert/strict';
import { test } from 'node:test';
import { typedFacts } from '../lib/types/collect.mjs';
import { repository } from './nextjs-fixture.mjs';
const files = (doc) => ({
  'package.json': '{"name":"pkg","main":"src/index.ts"}',
  'tsconfig.json': '{"compilerOptions":{"strict":true,"jsx":"preserve"},"include":["src"]}',
  'src/index.ts': 'export function greet(n: number) { return n; }',
  'README.md': doc,
});
const json = (run) => { assert.equal(run.status, 0, run.stderr); return JSON.parse(run.stdout); };

test('typed examples check arguments and removed self exports and isolate valid TSX blocks', () => {
  const result = typedFacts(new Map(Object.entries(files('```ts\nimport { greet } from "pkg";\ngreet(1);\n```\n```ts\nimport { greet } from "pkg";\ngreet("bad");\n```\n```tsx\nconst View = (p: {n: number}) => null;\nconst view = <View n={1} />;\n```\n```ts\nimport { gone } from "pkg";\n```'))));
  assert.equal(result.examples.checked, 4);
  assert.deepEqual(result.examples.issues.map(({ path, block, blockLine, line, code }) => ({ path, block, blockLine, line, code })), [
    { path: 'README.md', block: 2, blockLine: 5, line: 7, code: 2345 },
    { path: 'README.md', block: 4, blockLine: 13, line: 14, code: 2305 },
  ]);
  assert.match(result.examples.issues[0].message, /number/);
});

test('no-check fences and nocheck comments are skipped and counted', () => {
  const result = typedFacts(new Map(Object.entries(files('```ts no-check\nconst x: number = "bad";\n```\n```tsx\n// @ts-nocheck\nconst x: number = "bad";\n```'))));
  assert.equal(result.examples.skipped, 2);
  assert.equal(result.examples.checked, 0);
  assert.deepEqual(result.examples.issues, []);
});

test('inspect --types --base reports NEW example errors from source changes', (t) => {
  const f = repository(t, files('```ts\nimport { greet } from "pkg";\ngreet(1);\n```'));
  const base = f.git('rev-parse', 'HEAD');
  f.put('src/index.ts', 'export function greet(n: string) { return n; }');
  f.git('add', '.'); f.git('commit', '-qm', 'change signature');
  const summary = json(f.run(['inspect', '--types', '--ref', 'HEAD', '--base', base, '--summary', '--store', f.store]));
  assert.equal(summary.frameworks.examples.checked, 1);
  const page = json(f.run(['inspect', '--analysis', summary.analysis.id, '--base-analysis', summary.comparison.base.id, '--part', 'examples.issues', '--store', f.store]));
  assert.equal(page.page.items.find((item) => item.kind === 'type').status, 'NEW');
});

test('unavailable package programs leave example checking unknown', () => {
  const input = files('```ts\nconst value: number = "bad";\n```');
  delete input['tsconfig.json'];
  const result = typedFacts(new Map(Object.entries(input)));
  assert.equal(result.examples.state, 'UNKNOWN');
  assert.equal(result.examples.checked, 0);
  assert.equal(result.examples.gaps[0].reason, 'no-tsconfig');
});

test('typeCheck configuration checks docs and counts skips in inspection', (t) => {
  const input = files('```ts no-check\nconst value: number = "bad";\n```');
  const f = repository(t, { ...input, '.code-map.json': '{"typeCheck":true}', 'docs/guide.md': '```ts\nconst value: number = "bad";\n```' });
  const summary = json(f.run(['inspect', '--ref', 'HEAD', '--summary', '--store', f.store]));
  assert.equal(summary.frameworks.examples.skipped, 1);
  assert.equal(summary.frameworks.examples.checked, 1);
  const page = json(f.run(['inspect', '--analysis', summary.analysis.id, '--part', 'examples.issues', '--store', f.store]));
  assert.equal(page.page.items[0].path, 'docs/guide.md');
  assert.equal(page.page.items[0].code, 2322);
});

test('verify reports new example diagnostics as information without new rating checks', async (t) => {
  const { readFileSync } = await import('node:fs');
  const f = repository(t, { ...files('```ts\nimport { greet } from "pkg";\ngreet(1);\n```'), '.code-map.json': '{"typeCheck":true}' });
  const base = f.git('rev-parse', 'HEAD');
  f.put('src/index.ts', 'export function greet(n: string) { return n; }');
  f.git('add', '.'); f.git('commit', '-qm', 'change signature');
  f.put('request.json', JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base, head: 'HEAD', changeType: 'feature', intent: 'change signature', acceptanceCriteria: [], reportInputs: [], allowedPaths: ['**'], profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
  const output = JSON.parse(f.run(['verify', '--request', 'request.json', '--store', f.store]).stdout);
  const report = JSON.parse(readFileSync(output.files.results, 'utf8'));
  assert.equal(report.contractInformation.policy, 'information-only');
  assert.equal(report.contractInformation.examples.issues.find((item) => item.kind === 'type').status, 'NEW');
  assert.equal(report.obligations.some((item) => item.id.startsWith('examples.')), false);
});

test('typed and syntax checks keep the same block ordinal after JavaScript fences', () => {
  const result = typedFacts(new Map(Object.entries(files('```js\nconst before = 1;\n```\n```ts\nconst value: number = "bad";\n```'))));
  assert.equal(result.examples.issues[0].block, 2);
});

test('example self-import resolution does not change source module resolution', () => {
  const input = files('```ts\nimport { greet } from "pkg";\ngreet(1);\n```');
  input['src/consumer.ts'] = 'import { greet } from "pkg"; export const result = greet(1);';
  const result = typedFacts(new Map(Object.entries(input)));
  assert.equal(result.references.find((item) => item.path === 'src/consumer.ts' && item.name === 'greet')?.target, null);
});

test('example comparison retains UNKNOWN when a document was unreadable', async () => {
  const { comparedExamples } = await import('../lib/contracts/report.mjs');
  const issue = { path: 'docs/guide.md', block: 1, kind: 'type', code: 2322, message: 'wrong type' };
  const base = { typeState: 'COMPLETE', gaps: [{ path: 'docs/guide.md', reason: 'too-large' }], issues: [] };
  const head = { typeState: 'COMPLETE', gaps: [], issues: [issue] };
  assert.equal(comparedExamples(base, head, true).issues[0].status, 'UNKNOWN');
  assert.equal(comparedExamples({ ...base, gaps: [], issues: [issue] }, head, true).issues[0].status, 'EXISTING');
});

test('documentation uses the nearest compiler configuration without reordering program evidence', () => {
  const input = files('```ts\nconst root: number = 1;\n```');
  input['tsconfig.extra.json'] = '{"compilerOptions":{"strict":false},"include":["src"]}';
  input['docs/tsconfig.json'] = '{"compilerOptions":{"strict":true},"include":["../src"]}';
  input['docs/guide.md'] = '```ts\nfunction example(value) { return value; }\n```';
  const result = typedFacts(new Map(Object.entries(input)));
  assert.equal(result.examples.checked, 2);
  assert.deepEqual(result.examples.issues.map(({ path, code }) => [path, code]), [['docs/guide.md', 7006]]);
  assert.deepEqual(result.programs.map((item) => item.config), ['docs/tsconfig.json', 'tsconfig.extra.json', 'tsconfig.json']);
});

test('example checking preserves ESM conditions for source package imports', () => {
  const input = files('```ts\nconst value: number = 1;\n```');
  input['package.json'] = '{"name":"pkg","type":"module","exports":{".":{"import":"./src/index.ts","require":"./src/require.ts"}}}';
  input['tsconfig.json'] = '{"compilerOptions":{"strict":true,"module":"nodenext","moduleResolution":"nodenext"},"include":["src"]}';
  input['src/require.ts'] = 'export const alternate = 1;';
  input['src/consumer.ts'] = 'import { greet } from "pkg"; export const result = greet(1);';
  const result = typedFacts(new Map(Object.entries(input)));
  assert.equal(result.references.find((item) => item.path === 'src/consumer.ts' && item.name === 'greet')?.target, 'src/index.ts');
});
