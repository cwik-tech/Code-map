// Environment variables (C26): each kind of read, the template names, the platform names, the two ENV- rules, the summary
// block and the paged inventory. The .env files of the fixture hold values that must appear nowhere in the store.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { analyzeFile } from '../lib/analyze.mjs';
import { analyzeEnv, isPlatformName, templateEntries } from '../lib/frameworks/env.mjs';
import { analyzed, repository } from './nextjs-fixture.mjs';

const json = (output) => { assert.equal(output.status, 0, output.stderr); return JSON.parse(output.stdout); };
const argsOf = (command) => command.split(' ').slice(1);
const secrets = ['s3cr3t-value-7781', 'sk-live-should-not-leak', 'local-secret-4410', 'postgres://localhost/dev', 'example-token-991'];

/** A project with one template, a .env file and a .env.local file with values, and one case for each rule. */
const envFiles = {
  'package.json': JSON.stringify({ name: 'shop' }),
  '.env.example': '# Copy this file to .env\nDATABASE_URL=postgres://localhost/dev\nexport API_KEY="example-token-991"\nUNUSED_FLAG=on\nNODE_ENV=development\n',
  '.env.local': 'LOCAL_ONLY=local-secret-4410\n',
  // Declared, undeclared and platform names.
  'src/db.ts': 'export const url = process.env.DATABASE_URL;\nexport const missing = process.env.MISSING_NAME;\nexport const mode = process.env.NODE_ENV;\n'
    + 'export const ci = process.env.CI ?? process.env.VERCEL_URL;\n',
  // A destructuring of process.env and a computed read.
  'src/keys.ts': 'const { API_KEY, OTHER_MISSING } = process.env;\nexport const key = (name: string) => process.env[name] ?? API_KEY ?? OTHER_MISSING;\n',
  // A nested package without a template: no finding for its reads.
  'src/tool/package.json': JSON.stringify({ name: 'tool' }),
  'src/tool/index.ts': 'export const token = process.env.TOOL_TOKEN;\n',
  // A test file reads a name: it counts as a read and gets an undeclared lead.
  'test/db.test.ts': "import { test } from 'node:test';\ntest('reads', () => { void process.env.TEST_ONLY_NAME; });\n",
};

test('the parser records each kind of environment read, counts computed reads without a name, and skips writes', () => {
  const reads = analyzeFile('a.ts', "const a = process.env.API_URL;\nconst b = process.env['TOKEN'];\nconst c = import.meta.env.VITE_KEY;\n"
    + "const { DB_HOST, DB_PORT: port, ['DB_NAME']: n, ...rest } = process.env;\nconst d = process.env[key];\nprocess.env.WRITTEN = 'x';\n"
    + "delete process.env.GONE;\nconst e = import.meta.env[name];\nconst f = process.env.OPTIONAL!;\nfunction g({ PARAM_NAME } = process.env) { return PARAM_NAME; }\n", () => null).env;
  assert.deepEqual(reads, [
    { name: 'API_URL', via: 'process.env', form: 'property', line: 1 },
    { name: 'TOKEN', via: 'process.env', form: 'element', line: 2 },
    { name: 'VITE_KEY', via: 'import.meta.env', form: 'property', line: 3 },
    { name: 'DB_HOST', via: 'process.env', form: 'destructuring', line: 4 },
    { name: 'DB_PORT', via: 'process.env', form: 'destructuring', line: 4 },
    { name: 'DB_NAME', via: 'process.env', form: 'destructuring', line: 4 },
    { name: null, via: 'process.env', form: 'rest', line: 4 },
    { name: null, via: 'process.env', form: 'computed', line: 5 },
    { name: null, via: 'import.meta.env', form: 'computed', line: 8 },
    { name: 'OPTIONAL', via: 'process.env', form: 'property', line: 9 },
    { name: 'PARAM_NAME', via: 'process.env', form: 'destructuring', line: 10 },
  ], 'a write and a delete are not reads');
  assert.equal(analyzeFile('b.ts', 'export const environment = 1;\n', () => null).env, null, 'a file without a read records nothing');
  const tests = analyzeFile('a.test.ts', "import { test } from 'node:test';\ntest('x', () => process.env.IN_TEST);\n", () => null, { tests: true });
  assert.deepEqual(tests.env, [{ name: 'IN_TEST', via: 'process.env', form: 'property', line: 2 }], 'test files record their reads too');
});

test('a template gives only its names, never a value, and a platform name is not a lead', () => {
  const entries = templateEntries('# comment\nexport API_URL=https://example.com\nTOKEN = "abc"\n\nMULTI="first\nNOT_A_NAME=inside\nend"\nEMPTY=\nlower_ok=1\n=nothing\nNO_EQUALS\n');
  assert.deepEqual(entries, [{ name: 'API_URL', line: 2 }, { name: 'TOKEN', line: 3 }, { name: 'MULTI', line: 5 }, { name: 'EMPTY', line: 8 }, { name: 'lower_ok', line: 9 }]);
  assert.ok(!/example\.com|abc|inside/.test(JSON.stringify(entries)));
  assert.deepEqual(['NODE_ENV', 'CI', 'VERCEL_URL', 'VERCEL', 'NEXT_RUNTIME', 'DATABASE_URL', 'NEXT_PUBLIC_API_URL'].map(isPlatformName), [true, true, true, true, true, false, false]);
});

test('the rules apply per package, and a template that Code-map did not read stops the undeclared rule of its package', () => {
  const file = (path, names, test = false) => ({ path, test, env: names.map((name, index) => ({ name, via: 'process.env', form: name ? 'property' : 'computed', line: index + 1 })) });
  const env = analyzeEnv({ paths: ['package.json', 'apps/web/package.json', 'apps/big/package.json'],
    templates: [{ path: '.env.example', state: 'read', names: [{ name: 'ROOT_ONLY', line: 1 }] }, { path: 'apps/web/.env.sample', state: 'read', names: [{ name: 'WEB_URL', line: 1 }, { name: 'CI', line: 2 }] },
      { path: 'apps/big/.env.example', state: 'too-large', names: [] }],
    files: [file('apps/web/a.ts', ['WEB_URL', 'ROOT_ONLY', 'NODE_ENV', null]), file('apps/big/b.ts', ['ANYTHING']), file('lib/c.ts', ['ROOT_ONLY', 'NEW_NAME'])],
    testFiles: [file('test/a.test.ts', ['TEST_NAME'], true)] });
  assert.deepEqual(env.leads.undeclared.map((lead) => [lead.path, lead.name, lead.package]), [['apps/web/a.ts', 'ROOT_ONLY', 'apps/web'], ['lib/c.ts', 'NEW_NAME', '.'], ['test/a.test.ts', 'TEST_NAME', '.']]);
  assert.deepEqual(env.leads.unused, [], 'every declared name has a read, and CI is a platform name');
  assert.deepEqual(env.templates.map((item) => [item.path, item.package, item.state]), [['.env.example', '.', 'read'], ['apps/big/.env.example', 'apps/big', 'too-large'], ['apps/web/.env.sample', 'apps/web', 'read']]);
  assert.deepEqual(env.names.find((item) => item.name === 'ROOT_ONLY'), { name: 'ROOT_ONLY', platform: false, reads: 2, files: ['apps/web/a.ts', 'lib/c.ts'], templates: ['.env.example'] });
  assert.equal(env.reads.filter((read) => read.name === null).length, 1);
});

test('acceptance: the summary counts the environment keys, the findings name each lead, and no value reaches the store', (t) => {
  const { root, store, put, run } = repository(t, envFiles);
  // An untracked .env file with secret values. Code-map must never read it.
  put('.env', 'DATABASE_URL=postgres://admin:s3cr3t-value-7781@db/prod\nAPI_KEY=sk-live-should-not-leak\n');
  const output = run(['inspect', '--summary', '--worktree', '--store', store]), summary = json(output);
  const { env } = summary.frameworks;
  assert.equal(env.detected, true);
  assert.deepEqual([env.templates.total, env.templates.read, env.templates.names], [1, 1, 4]);
  assert.deepEqual([env.reads.total, env.reads.named, env.reads.dynamic, env.reads.files], [10, 9, 1, 4]);
  assert.deepEqual([env.names.total, env.names.platform], [10, 3]);
  assert.deepEqual(env.rules, ['ENV-UNDECLARED', 'ENV-UNUSED']);
  assert.match(env.text, /never reads \.env/);

  const list = (ruleId) => json(run(['inspect', '--analysis', summary.analysis.id, '--findings', '--rule', ruleId, '--store', store])).page.items;
  const undeclared = list('ENV-UNDECLARED');
  assert.deepEqual(undeclared.map((item) => [item.location.path, item.location.line, item.location.symbol]), [['src/db.ts', 2, 'MISSING_NAME'], ['src/keys.ts', 1, 'OTHER_MISSING'], ['test/db.test.ts', 2, 'TEST_ONLY_NAME']]);
  assert.match(undeclared[0].text, /^src\/db\.ts reads the environment variable MISSING_NAME, but no template file of its package \(\.env\.example\) declares it\./);
  const unused = list('ENV-UNUSED');
  assert.deepEqual(unused.map((item) => [item.location.path, item.location.line, item.location.symbol, item.severity]), [['.env.example', 4, 'UNUSED_FLAG', 'low']]);
  for (const item of [...undeclared, ...unused]) assert.match(item.text, /This is a static lead/);
  const report = json(run(argsOf(undeclared[0].next)));
  assert.deepEqual(report.details.lead, { path: 'src/db.ts', package: '.', name: 'MISSING_NAME', lines: [2], templates: ['.env.example'] });

  // The inventory comes in pages. Each next command reads the same stored analysis.
  const first = json(run([...argsOf(env.names.next), '--limit', '4']));
  assert.deepEqual([first.part, first.target, first.page.total, first.page.items.length], ['env.names', { framework: 'env' }, 10, 4]);
  const names = [...first.page.items];
  for (let page = first.page; page.next; ) { page = json(run(argsOf(page.next))).page; names.push(...page.items); }
  assert.deepEqual(names.map((item) => item.name), ['API_KEY', 'CI', 'DATABASE_URL', 'MISSING_NAME', 'NODE_ENV', 'OTHER_MISSING', 'TEST_ONLY_NAME', 'TOOL_TOKEN', 'UNUSED_FLAG', 'VERCEL_URL']);
  assert.deepEqual(names.find((item) => item.name === 'DATABASE_URL'), { name: 'DATABASE_URL', platform: false, reads: 1, files: ['src/db.ts'], templates: ['.env.example'] });
  const reads = json(run(argsOf(env.reads.next))).page;
  assert.deepEqual(reads.items.find((item) => item.name === null), { path: 'src/keys.ts', name: null, via: 'process.env', form: 'computed', line: 2, test: false });
  const templates = json(run(argsOf(env.templates.next))).page.items;
  assert.deepEqual(templates, [{ path: '.env.example', package: '.', state: 'read', names: [{ name: 'DATABASE_URL', line: 2 }, { name: 'API_KEY', line: 3 }, { name: 'UNUSED_FLAG', line: 4 }, { name: 'NODE_ENV', line: 5 }] }]);

  // No value of a template, of .env or of .env.local is in the store or in the printed reports.
  const stored = readdirSync(join(store, 'analyses')).filter((name) => name.endsWith('.json.gz')).map((name) => gunzipSync(readFileSync(join(store, 'analyses', name))).toString('utf8'));
  assert.ok(stored.length > 0);
  for (const text of [...stored, output.stdout]) for (const secret of secrets) assert.ok(!text.includes(secret), `the store and the summary do not hold "${secret}"`);
  assert.ok(stored.every((text) => !text.includes('LOCAL_ONLY')), 'Code-map does not read .env.local, so even its names are absent');
});

test('environment finding IDs come from paths and names, so they survive line moves', (t) => {
  const { root, put, git } = repository(t, envFiles);
  const ids = () => analyzed(root).findings.filter((item) => item.ruleId.startsWith('ENV-')).map((item) => item.id).sort();
  const before = ids();
  assert.equal(before.length, 4);
  put('src/db.ts', `// moved\n\n${envFiles['src/db.ts']}`);
  put('.env.example', `# moved\n${envFiles['.env.example']}`);
  git('commit', '-qam', 'move lines');
  assert.deepEqual(ids(), before);
});

test('a template edit gives a new working-tree analysis, and an edit of .env keeps the ID, because Code-map does not read .env', (t) => {
  const { store, put, run } = repository(t, envFiles);
  put('.env', 'API_KEY=first-value\n');
  const id = () => json(run(['inspect', '--summary', '--worktree', '--store', store])).analysis.id;
  const first = id();
  put('.env', 'API_KEY=second-value\nNEW_SECRET=x\n');
  assert.equal(id(), first);
  put('.env.example', `${envFiles['.env.example']}MISSING_NAME=\n`);
  assert.notEqual(id(), first);
});
