// Acceptance tests of `code-map triage` (C41): input validation, an invalid file, the replacement of an entry, an entry
// that follows its finding through a rename with --base, and `verify` results that a suppression does not change.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { day, entryFor, project, spares } from './triage-fixtures.mjs';

test('the triage command validates its input, refuses an invalid triage file, and replaces the entry of a finding', (t) => {
  const { root, store, write, summary, triage, fails } = project(t);
  const before = summary(), id = before.analysis.id, target = before.findings.items.find((item) => item.ruleId === 'ARCH-RULE');
  const base = ['triage', '--store', store, '--analysis', id, '--finding', target.id];
  const entry = (state, ...more) => [...base, '--state', state, '--reason', 'The rule is old.', '--owner', 'ana', ...more];
  fails([...base, '--state', 'dismissed', '--owner', 'ana'], /triage needs --reason/);
  fails(entry('ignored'), /--state must be confirmed, dismissed or suppressed, not "ignored"/);
  fails(entry('suppressed'), /--expires: is necessary for the state suppressed/);
  fails(entry('suppressed', '--expires', day(366)), new RegExp(`--expires: must be at most 365 days after the date ${day()}`));
  fails(entry('suppressed', '--expires', 'soon'), /--expires: must be a calendar date in the form YYYY-MM-DD/);
  fails(entry('dismissed', '--expires', day(5)), /--expires: applies only to the state suppressed/);
  fails([...base, '--state', 'dismissed', '--reason', '  ', '--owner', 'ana'], /--reason: is necessary/);
  fails(entry('dismissed', '--file', 'src/a.ts'), /triage takes only --finding, --state, --reason, --owner, --expires/);
  fails(['triage', 'more', ...entry('dismissed').slice(1)], /triage takes no other words: more/);
  fails(['triage', '--store', store, '--analysis', id, '--finding', 'ARCH-RULE-0000000000', '--state', 'dismissed', '--reason', 'r', '--owner', 'ana'],
    /No finding ARCH-RULE-0000000000 in analysis A-[0-9a-f]{16}\. List the findings with: code-map inspect --analysis/);
  fails(['triage', '--store', store, '--worktree', '--finding', target.id, '--state', 'dismissed', '--reason', 'r', '--owner', 'ana'],
    /No stored analysis of the current code \(A-[0-9a-f]{16}\)\. Run code-map inspect --summary --worktree --store \S+ first, or give --analysis <id>\./);
  fails([...entry('dismissed'), '--ref', 'HEAD'], /--analysis already identifies the snapshot/);
  // Another command would ignore the decision options, so it refuses them instead of a silent report.
  fails(['inspect', '--analysis', id, '--finding', target.id, '--state', 'dismissed', '--reason', 'r', '--owner', 'ana', '--store', store], /--state, --reason, --owner only work with code-map triage/);
  assert.equal(existsSync(join(root, '.code-map-triage.json')), false, 'a refused entry writes no file');

  assert.equal(triage(...entry('dismissed').slice(3)).action, 'added');
  const second = triage('--analysis', id, '--finding', target.id, '--state', 'suppressed', '--reason', 'Moves next week.', '--owner', 'bo', '--expires', day(7));
  assert.equal(second.action, 'replaced');
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.code-map-triage.json'), 'utf8')), { triageVersion: 1, entries: [second.entry] });
  assert.deepEqual(readdirSync(root).filter((name) => name.includes('triage')), ['.code-map-triage.json'], 'no temporary file stays behind');

  // A hand-edited file with an unknown field and a duplicate fingerprint stops the reports and the command, with the path of each problem.
  write([{ ...second.entry, color: 'red' }, second.entry]);
  fails(['inspect', '--summary', '--ref', 'HEAD', '--store', store],
    /The triage file .*\.code-map-triage\.json is not valid:\n {2}entries\[0\]\.color: is not a known field\.[^\n]*\n {2}entries\[1\]\.fingerprint: repeats the fingerprint of entries\[0\]/);
  fails(['inspect', '--analysis', id, '--findings', '--store', store], /is not valid/);
  fails(entry('dismissed'), /is not valid/);
  writeFileSync(join(root, '.code-map-triage.json'), '[');
  fails(['inspect', '--summary', '--ref', 'HEAD', '--store', store], /The triage file .* is not valid JSON/);
});

test('a triage entry follows its finding through a file rename when the summary compares with the base', (t) => {
  const { git, put, summary, triage, follow } = project(t);
  const first = summary(), [target] = spares(first.findings.items);
  triage('--analysis', first.analysis.id, '--finding', target.id, '--state', 'dismissed', '--reason', 'Kept for plugins.', '--owner', 'ana');
  git('mv', 'src/lib/spares.ts', 'src/lib/extras.ts');
  put('src/ui/view.ts', "import { spare0 } from '../lib/extras';\nexport function view() { return 'v' + spare0; }\n");
  git('add', 'src'); git('commit', '-qm', 'rename spares');
  const moved = (items) => items.find((item) => item.location.path === 'src/lib/extras.ts' && item.location.symbol === target.location.symbol);

  const compared = summary('--base', 'HEAD~1');
  assert.equal(moved(compared.findings.items), undefined, 'the renamed finding stays hidden');
  assert.deepEqual([compared.findings.hidden, compared.triage.unused.total], [{ dismissed: 1, suppressed: 0 }, 0]);
  const rule = summary('--base', 'HEAD~1', '--include-hidden').findings.byRule.find((item) => item.ruleId === 'EXPORT-UNREFERENCED');
  const item = moved(follow(rule.next, ['--limit', '500']).page.items);
  assert.deepEqual([item.baseline, item.matchedBy], ['EXISTING', 'rename']);
  assert.deepEqual(item.triage, { state: 'dismissed', owner: 'ana', date: day(), matchedBy: 'rename', fingerprint: target.fingerprint });
  assert.notEqual(item.fingerprint, target.fingerprint, 'the path is part of the fingerprint');

  const plain = summary();
  assert.deepEqual([plain.findings.hidden.dismissed, plain.triage.unused.items.map((entry) => entry.fingerprint)], [0, [target.fingerprint]],
    'without the base, the entry matches no finding, and the summary reports it as unused');
});

test('verify gives the same results when a triage entry suppresses the new architecture-rule break', (t) => {
  const { root, work, store, put, git, run, summary, triage, write } = project(t, { clean: true });
  git('tag', 'base');
  put('src/core/engine.ts', "import { view } from '../ui/view';\nexport function engine() { return view(); }\n");
  git('add', '.'); git('commit', '-qm', 'break the rule');
  const request = join(work, 'request.json');
  writeFileSync(request, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'HEAD', intent: 'Change the engine.', acceptanceCriteria: [],
    allowedPaths: ['src/**', 'test/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
  const verify = () => {
    const output = run(['verify', '--request', request, '--store', store, '--out-dir', join(work, 'out')]);
    assert.equal(output.status, 2, output.stderr);
    const results = JSON.parse(readFileSync(JSON.parse(output.stdout).files.results, 'utf8'));
    delete results.runId; delete results.createdAt;
    return results;
  };
  const before = verify();
  assert.equal(before.readiness.state, 'BLOCKED');
  assert.equal(before.obligations.find((item) => item.id === 'structure.architecture-rules').result, 'FAIL');

  const broken = summary().findings.items.find((item) => item.ruleId === 'ARCH-RULE');
  triage('--ref', 'HEAD', '--finding', broken.id, '--state', 'suppressed', '--reason', 'The new layer lands next week.', '--owner', 'ana', '--expires', day(30));
  assert.equal(summary().findings.items.some((item) => item.ruleId === 'ARCH-RULE'), false, 'inspect hides the suppressed break');
  assert.deepEqual(verify(), before, 'verify and its rule set still count the suppressed finding');
  write([entryFor(broken)]);
  assert.deepEqual(verify(), before, 'a dismissal does not change verify either');
});
