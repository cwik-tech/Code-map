import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reviewRun } from '../lib/model-review.mjs';
import { graphContext, verificationContext } from '../lib/verify-context.mjs';
import { project, outcome, junit, header, caseText } from './oracle-fixtures.mjs';

// The external model is unavailable and non-deterministic. A local command exercises the same stdin/stdout boundary.
test('a model command receives run context and returns a validated evidence-linked test plan', async (t) => {
  const f = project(t), { summary } = outcome(f.verify(f.request()), 3);
  const program = `let s=''; process.stdin.on('data', b=>s+=b); process.stdin.on('end',()=>{
    const c=JSON.parse(s); process.stdout.write(JSON.stringify({hypothesesVersion:1,model:'fixture',items:[{
      id:'plan',kind:'missing-test',claim:c.request.intent,evidenceIds:['request:intent'],
      proposedTest:{file:'test/login.test.ts',name:'accepts user',text:'assert.equal(login("a"), "a")'}
    }]})); });`;
  await reviewRun(f.root, { run: summary.runId, 'out-dir': f.out, store: f.store }, [process.execPath, '-e', program]);
  const saved = JSON.parse(readFileSync(join(f.out, 'runs', summary.runId, 'review-hypotheses.json'), 'utf8'));
  assert.deepEqual(saved, { hypothesesVersion: 1, model: 'fixture', items: [{ id: 'plan', kind: 'missing-test',
    claim: 'Change the login tests.', evidenceIds: ['request:intent'], proposedTest: {
      file: 'test/login.test.ts', name: 'accepts user', text: 'assert.equal(login("a"), "a")' } }] });
});

test('model context includes the dependency path that selects a failed-check consumer', (t) => {
  const f = project(t, { 'src/consumer.ts': "import { login } from './login'; export const user = login('a');\n",
    'test/user.test.ts': "import { user } from '../src/consumer'; test('user', () => expect(user).toBe('a'));\n" });
  f.put('src/login.ts', "import { missing } from './missing'; export const login = missing;\n");
  f.put('src/consumer.ts', "import { login } from './login'; export const user = login('b');\n");
  f.commit('break login and change its consumer');
  const { results } = outcome(f.verify(f.request()), 3);
  const context = verificationContext(results);
  assert.ok((context.graph?.edges ?? []).some((edge) => edge.source === 'src/consumer.ts' && edge.target === 'src/login.ts'));
  assert.ok(context.graph.paths.some((x) => x.checkId === 'structure.imports-resolve' && x.test
    && JSON.stringify(x.path) === JSON.stringify(['src/login.ts', 'src/consumer.ts', 'test/user.test.ts'])));
  assert.deepEqual(JSON.parse(f.context(results.runId).stdout).graph, context.graph);
});

test('graph context selects unknown check paths, bounds fanout and discloses omitted paths', () => {
  const files = Array.from({ length: 130 }, (_, index) => ({ path: `src/c${index}.ts`, imports: 'src/a.ts', depth: 1, test: false, kind: 'value' }));
  const impact = () => ({ files, complete: false, truncated: { limit: 'depth', value: 10 }, dynamicImports: 1 });
  const obligations = [{ id: 'open', result: 'UNKNOWN', evidenceIds: ['path:src/a.ts'] },
    { id: 'passed', result: 'PASS', eligible: true, evidenceIds: ['path:src/a.ts'] },
    { id: 'unrelated', result: 'FAIL', evidenceIds: ['path:src/other.ts'] }];
  const graph = graphContext({ obligations, changedPaths: ['src/a.ts'], impact, findings: [] });
  assert.equal(graph.paths.length, 100);
  assert.equal(graph.omittedPaths, 30);
  assert.equal(graph.complete, false);
  assert.deepEqual(graph.truncated, { limit: 'depth', value: 10 });
  assert.equal(graph.dynamicImports, 1);
  assert.deepEqual([...new Set(graph.paths.map((x) => x.checkId))], ['open']);
  assert.equal(verificationContext({ obligations, graph }).graph.paths.length, 100);
  assert.equal(graphContext({ obligations: [], changedPaths: ['src/a.ts'], impact, findings: [] }).paths.length, 0);
});

test('graph paths share the context byte budget without leaving dangling edges', () => {
  const seed = 's'.repeat(1900), obligations = [{ id: 'open', result: 'UNKNOWN', evidenceIds: [`path:${seed}`] }];
  const files = Array.from({ length: 100 }, (_, index) => ({ path: `${index}${'c'.repeat(1900)}`, imports: seed, test: false, kind: 'value' }));
  const graph = graphContext({ obligations, changedPaths: [seed], impact: () => ({ files, complete: true, truncated: null, dynamicImports: { files: 0, sites: 0 } }), findings: [] });
  const context = verificationContext({ obligations, graph });
  assert.ok(Buffer.byteLength(JSON.stringify(context, null, 2)) <= 256 * 1024);
  assert.ok(context.graph.omittedPaths > 0);
  assert.equal(context.graph.paths.length + context.graph.omittedPaths, 100);
  assert.deepEqual(context.graph.edges, context.graph.paths.map((item) => ({ source: item.path[1], target: item.path[0] })));
});

test('graph selection resolves import evidence IDs that name a changed file', () => {
  const graph = graphContext({ obligations: [{ id: 'alias', result: 'FAIL', evidenceIds: ['import:src/a.ts:4'] }],
    changedPaths: ['src/a.ts'], findings: [], impact: () => ({ complete: true, truncated: null, dynamicImports: { files: 0, sites: 0 },
      files: [{ path: 'src/b.ts', imports: 'src/a.ts', depth: 1, kind: 'value', test: false }] }) });
  assert.deepEqual(graph.paths, [{ checkId: 'alias', evidenceIds: ['import:src/a.ts:4'], changed: 'src/a.ts', path: ['src/a.ts', 'src/b.ts'], kind: 'value', test: false }]);
});

test('case evidence selects impact paths from changed sources to an unchanged test in a bound head report', (t) => {
  const f = project(t, { 'src/consumer.ts': "import { login } from './login'; export const user = login('a');\n",
    'test/user.test.ts': "import { user } from '../src/consumer'; test('user', () => expect(user).toBe('a'));\n",
    'test/login.test.ts': header + caseText('unrelated') });
  f.put('src/login.ts', 'export function login(name: string) { return name.toUpperCase(); }\n');
  f.put('src/consumer.ts', "import { login } from './login'; export const user = login('b');\n");
  const sha = f.commit('change sources'), reportInputs = [junit(f, 'head', { sha, cases: [
    { file: 'test/user.test.ts', name: 'user', status: 'failed' },
    { file: null, name: 'unknown file', status: 'failed' },
  ] })];
  const { results } = outcome(f.verify(f.request({ reportInputs })), 2);
  assert.deepEqual(results.change.paths, ['src/consumer.ts', 'src/login.ts']);
  const selected = results.graph.paths.filter((path) => path.checkId === 'behavior.no-new-failures');
  assert.deepEqual(selected.map(({ changed, path, evidenceIds, test }) => ({ changed, path, evidenceIds, test })), [
    { changed: 'src/consumer.ts', path: ['src/consumer.ts', 'test/user.test.ts'], test: true,
      evidenceIds: ['case:reports/head.xml:test/user.test.ts > user'] },
    { changed: 'src/login.ts', path: ['src/login.ts', 'src/consumer.ts', 'test/user.test.ts'], test: true,
      evidenceIds: ['case:reports/head.xml:test/user.test.ts > user'] },
  ]);
  assert.deepEqual(JSON.parse(f.context(results.runId).stdout).graph, verificationContext(results).graph);
});
