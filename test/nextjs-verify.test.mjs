// The rule set static-baseline-v0 reads only the finding rules that it names, so the Next.js rules change no verify result.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../lib/project.mjs';
import { loadAnalysis } from '../lib/store.mjs';
import { runVerify } from '../lib/verify.mjs';
import { repository } from './nextjs-fixture.mjs';
import { evaluate, finding } from './profile-fixtures.mjs';

const nextRules = ['NEXT-CLIENT-API-IN-SERVER', 'NEXT-SERVER-IMPORT-IN-CLIENT', 'NEXT-CLIENT-PRIVATE-ENV', 'NEXT-USE-SERVER-EXPORT'];

test('the rule set gives the same checks, ratings and readiness with or without NEW Next.js findings', () => {
  const findings = nextRules.map((ruleId) => finding(ruleId, `${ruleId}-0123456789`));
  const plain = evaluate({}), withNext = evaluate({ head: { findings }, labels: Object.fromEntries(findings.map((item) => [item.id, 'NEW'])) });
  assert.deepEqual(withNext.obligations, plain.obligations);
  assert.deepEqual(withNext.ratings, plain.ratings);
  assert.deepEqual(withNext.ready, plain.ready);
});

// Fixed source roots keep the base and head analyses comparable, so that the head findings are NEW.
const base = {
  '.code-map.json': JSON.stringify({ roots: ['app', 'components'] }),
  'package.json': JSON.stringify({ name: 'shop', dependencies: { next: '15.1.0', react: '19.0.0' } }),
  'app/layout.tsx': 'export default function RootLayout({ children }: { children: unknown }) { return <html><body>{children}</body></html>; }\n',
  'app/page.tsx': 'export default function Page() { return <main />; }\n',
};
/** The head files of a change. With `leads`, the same files hold one case of each Next.js rule. */
const head = (leads) => ({
  'app/page.tsx': "import { Counter } from '../components/counter';\nimport { Leaky } from '../components/leaky';\nexport default function Page() { return <main><Counter /><Leaky /></main>; }\n",
  'components/counter.tsx': `${leads ? '// A server component.\n' : "'use client';\n"}import { useState } from 'react';\nexport function Counter() { const [count] = useState(0); return <p>{count}</p>; }\n`,
  'components/leaky.tsx': `'use client';\n${leads ? "import 'server-only';\n" : "import 'client-only';\n"}export function Leaky() { return <p>{process.env.${leads ? 'DATABASE_URL' : 'NEXT_PUBLIC_API_URL'}}</p>; }\n`,
  'app/actions.ts': `'use server';\nexport ${leads ? 'const save = 1;' : 'async function save() { return 1; }'}\n`,
});

/** Runs verify on one change from the base files to the head files, and returns the results with run-specific values replaced. */
function verified(t, leads) {
  const { root, store, put, git } = repository(t, base), out = mkdtempSync(join(tmpdir(), 'code-map-next-out-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  git('tag', 'base');
  for (const [path, text] of Object.entries(head(leads))) put(path, text);
  git('add', '.'); git('commit', '-qm', 'change');
  const request = join(out, 'request.json');
  writeFileSync(request, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'HEAD', intent: 'Add the counter.', acceptanceCriteria: [],
    allowedPaths: ['app/**', 'components/**'], changeType: 'feature', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
  const { results } = runVerify(root, loadConfig(root), { request, store, 'out-dir': out });
  const nextFindings = loadAnalysis(store, results.head.analysisId).findings.filter((item) => nextRules.includes(item.ruleId)).map((item) => item.ruleId);
  let text = JSON.stringify({ comparison: results.comparison, readiness: results.readiness, ratings: results.ratings, obligations: results.obligations, gaps: results.gaps });
  for (const [value, name] of [[results.head.analysisId, 'HEAD-ID'], [results.base.analysisId, 'BASE-ID'], [results.head.sha, 'HEAD-SHA'], [results.base.sha, 'BASE-SHA'], [store, 'STORE']]) text = text.replaceAll(value, name);
  return { nextFindings, results: JSON.parse(text) };
}

test('acceptance: verify gives the same results for a change with NEW Next.js findings as for the same change without them', (t) => {
  const withLeads = verified(t, true), without = verified(t, false);
  assert.deepEqual([...new Set(withLeads.nextFindings)].sort(), [...nextRules].sort(), 'the head analysis has a finding of each Next.js rule');
  assert.deepEqual(without.nextFindings, []);
  assert.deepEqual(withLeads.results.comparison, { state: 'COMPARABLE', reasons: [] }, 'the Next.js findings of the head are NEW, not UNKNOWN');
  assert.ok(withLeads.results.obligations.some((item) => item.result === 'PASS'));
  assert.deepEqual(withLeads.results, without.results);
});
