// Acceptance tests of triage in the reports of a stored analysis (C41): the states, --include-hidden, expiry, unused entries,
// precision, the sample pages, and reports that do not change without a triage file.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { day, entryFor, project, sha256, spares, words } from './triage-fixtures.mjs';

test('acceptance: the triage command writes each state, and dismissed or suppressed findings leave the summary and the default page until --include-hidden', (t) => {
  const { root, git, summary, triage, follow } = project(t);
  const before = summary(), id = before.analysis.id, [dismissed, confirmed, suppressed] = spares(before.findings.items);
  const added = triage('--analysis', id, '--finding', dismissed.id, '--state', 'dismissed', '--reason', 'A plugin loads it by name.', '--owner', 'ana');
  assert.deepEqual([added.reportType, added.action, added.path, added.finding.id], ['code-map-triage', 'added', '.code-map-triage.json', dismissed.id]);
  assert.deepEqual(added.entry, { fingerprint: dismissed.fingerprint, ruleId: 'EXPORT-UNREFERENCED', state: 'dismissed', reason: 'A plugin loads it by name.', owner: 'ana', date: day() });
  // Without --analysis, the command uses the stored analysis of the current code, selected as in inspect --summary.
  triage('--ref', 'HEAD', '--finding', confirmed.id, '--state', 'confirmed', '--reason', 'Dead code.', '--owner', 'ana');
  triage('--analysis', id, '--finding', suppressed.id, '--state', 'suppressed', '--reason', 'Goes in the next release.', '--owner', 'bo', '--expires', day(30));
  assert.equal(git('status', '--porcelain', '--untracked-files=all'), '?? .code-map-triage.json\n', 'the command writes only the triage file');
  const text = readFileSync(join(root, '.code-map-triage.json')), file = JSON.parse(text);
  assert.deepEqual(file.entries.map((entry) => entry.fingerprint), [dismissed, confirmed, suppressed].map((item) => item.fingerprint).sort(), 'entries are sorted by fingerprint');

  const after = summary();
  assert.deepEqual([after.analysis.id, after.analysis.reused], [id, true], 'the triage file is not an input of the analysis');
  const ids = after.findings.items.map((item) => item.id);
  assert.ok(!ids.includes(dismissed.id) && !ids.includes(suppressed.id), 'dismissed and suppressed findings leave the top findings');
  assert.deepEqual(after.findings.items.find((item) => item.id === confirmed.id).triage, { state: 'confirmed', owner: 'ana', date: day() });
  assert.deepEqual([after.findings.total, after.findings.hidden], [before.findings.total - 2, { dismissed: 1, suppressed: 1 }]);
  assert.deepEqual([after.triage.path, after.triage.digest, after.triage.date, after.triage.includeHidden], ['.code-map-triage.json', sha256(text), day(), false]);
  assert.deepEqual(after.triage.entries, { total: 3, confirmed: 1, dismissed: 1, suppressed: 1 });
  const rule = (report) => report.findings.byRule.find((item) => item.ruleId === 'EXPORT-UNREFERENCED');
  assert.equal(rule(after).count, rule(before).count - 2);

  const page = follow(rule(after).next, ['--limit', '500']);
  assert.equal(page.page.total, rule(before).count - 2);
  assert.ok(page.page.items.every((item) => item.id !== dismissed.id && item.id !== suppressed.id), 'the default findings page leaves them out');
  assert.deepEqual([page.triage.digest, page.triage.hidden], [sha256(text), { dismissed: 1, suppressed: 1 }]);

  const all = summary('--include-hidden');
  assert.deepEqual([all.findings.total, all.triage.includeHidden], [before.findings.total, true]);
  assert.ok(words(rule(all).next).includes('--include-hidden'), 'the printed commands keep --include-hidden');
  const shown = follow(rule(all).next, ['--limit', '500']);
  assert.equal(shown.filter.includeHidden, true);
  assert.deepEqual(shown.page.items.find((item) => item.id === suppressed.id).triage, { state: 'suppressed', owner: 'bo', date: day(), expires: day(30) });
  assert.deepEqual(shown.page.items.find((item) => item.id === dismissed.id).triage.state, 'dismissed');

  const detail = follow(dismissed.next);
  assert.deepEqual(detail.triage, { path: '.code-map-triage.json', digest: sha256(text), date: day(), entry: added.entry, matchedBy: 'fingerprint', hidden: true, expired: false });
  assert.deepEqual(follow(after.findings.items.find((item) => item.ruleId === 'ARCH-RULE').next).triage.entry, null, 'a finding without an entry says so');
});

test('an expired suppression applies no more and the summary lists it, and an entry that matches no finding is unused', (t) => {
  const { summary, follow, write } = project(t);
  const before = summary(), [old, other] = spares(before.findings.items);
  write([entryFor(old, { state: 'suppressed', owner: 'bo', date: day(-100), expires: day(-1) }), entryFor({ fingerprint: '0'.repeat(16), ruleId: 'ARCH-RULE' }),
    entryFor(other, { ruleId: 'ARCH-RULE', state: 'confirmed' })]);
  const after = summary();
  assert.deepEqual(after.findings.items.find((item) => item.id === old.id).triage, { state: 'suppressed', owner: 'bo', date: day(-100), expires: day(-1), expired: true });
  assert.deepEqual([after.findings.total, after.findings.hidden], [before.findings.total, { dismissed: 0, suppressed: 0 }]);
  assert.deepEqual(after.triage.expired, { total: 1, items: [{ fingerprint: old.fingerprint, ruleId: 'EXPORT-UNREFERENCED', owner: 'bo', expires: day(-1), finding: old.id }] });
  assert.deepEqual(after.triage.unused.total, 2);
  assert.deepEqual(after.triage.unused.items.map((item) => [item.fingerprint, item.ruleId, item.state, item.cause]),
    [['0'.repeat(16), 'ARCH-RULE', 'dismissed', 'no-finding'], [other.fingerprint, 'ARCH-RULE', 'confirmed', 'rule-differs']]);
  assert.equal(after.findings.items.find((item) => item.id === other.id).triage, undefined, 'an entry with another rule does not apply');
  assert.deepEqual([follow(old.next).triage.expired, follow(old.next).triage.hidden], [true, false]);
});

test('precision counts the labels of each labeled rule, and the sample pages list the unlabeled findings of one rule in fingerprint order', (t) => {
  const { store, summary, follow, write, fails } = project(t);
  const before = summary(), rule = before.findings.byRule.find((item) => item.ruleId === 'EXPORT-UNREFERENCED');
  const all = follow(rule.next, ['--limit', '500']).page.items;
  write([entryFor(all[0], { state: 'confirmed' }), entryFor(all[1], { state: 'confirmed' }), entryFor(all[2]), entryFor(all[3], { state: 'suppressed', expires: day(10) })]);
  const after = summary();
  assert.equal(after.triage.precision.length, 1, 'only a rule with a label has a precision row');
  const [row] = after.triage.precision;
  assert.deepEqual([row.ruleId, row.confirmed, row.dismissed, row.share, row.unlabeled], ['EXPORT-UNREFERENCED', 2, 1, 0.667, rule.count - 3]);
  assert.deepEqual(words(row.sample).slice(1), ['inspect', '--analysis', after.analysis.id, '--findings', '--rule', 'EXPORT-UNREFERENCED', '--unlabeled', '--store', store]);
  assert.match(after.triage.commands.sample, / --findings --rule '<rule id>' --unlabeled /);

  const sampled = [];
  for (let page = follow(row.sample, ['--limit', '3']); ; page = follow(page.page.next)) {
    assert.deepEqual([page.filter.rule, page.filter.unlabeled, page.page.limit], ['EXPORT-UNREFERENCED', true, 3]);
    sampled.push(...page.page.items);
    if (page.page.next === null) break;
    assert.ok(words(page.page.next).includes('--unlabeled'));
  }
  const expected = all.slice(3).map((item) => item.fingerprint).sort();
  assert.deepEqual(sampled.map((item) => item.fingerprint), expected, 'every unlabeled finding once, the suppressed one included, in fingerprint order');
  assert.equal(sampled.find((item) => item.id === all[3].id).triage.state, 'suppressed');

  const id = after.analysis.id;
  fails(['inspect', '--analysis', id, '--findings', '--unlabeled', '--store', store], /--unlabeled needs --rule/);
  fails(['inspect', '--analysis', id, '--unlabeled', '--store', store], /--unlabeled needs --findings/);
  fails(['inspect', '--analysis', id, '--findings', '--rule', 'ARCH-RULE', '--unlabeled', '--include-hidden', '--store', store], /not both/);
  fails(['inspect', '--analysis', id, '--findings', '--rule', 'ARCH-RULE', '--unlabeled', '--base-analysis', id, '--store', store], /not both/);
  fails(['inspect', '--analysis', id, '--finding', all[0].id, '--include-hidden', '--store', store], /not both/);
  fails(['inspect', '--ref', 'HEAD', '--include-hidden'], /--include-hidden needs --summary or --analysis/);
});

test('without a triage file the reports keep their fields, and an uncommitted triage file changes no analysis ID', (t) => {
  const { root, store, json, follow, write } = project(t);
  const tree = () => json(['inspect', '--summary', '--worktree', '--store', store]);
  const first = tree(), item = first.findings.items[0];
  assert.deepEqual(Object.keys(first), ['reportType', 'schemaVersion', 'analysis', 'snapshot', 'scope', 'verification', 'findings', 'comparison', 'completeness', 'gaps', 'tests', 'frameworks', 'architecture', 'models', 'documentation', 'commands', 'limits']);
  assert.equal(first.architecture.ownership.unowned, first.scope.sourceFiles);
  assert.deepEqual(Object.keys(first.findings), ['total', 'shown', 'bySeverity', 'byRule', 'items', 'next']);
  assert.ok(first.findings.items.every((entry) => !Object.hasOwn(entry, 'triage')));
  const page = follow(first.commands.findings);
  assert.deepEqual([Object.keys(page), Object.keys(page.filter)], [['reportType', 'schemaVersion', 'analysis', 'filter', 'page'], ['rule', 'baseline', 'selection']]);
  assert.deepEqual(Object.keys(follow(item.next)), ['reportType', 'schemaVersion', 'analysis', 'finding', 'details']);

  write([entryFor(item)]);
  const second = tree();
  assert.deepEqual([second.analysis.id, second.analysis.reused, second.findings.hidden.dismissed], [first.analysis.id, true, 1]);
  assert.equal(follow(item.next).analysis.freshness.state, 'current', 'a follow-up does not see the triage file as a change of the code');
  rmSync(join(root, '.code-map-triage.json'));
  const third = tree();
  for (const report of [first, third]) delete report.analysis.reused;
  assert.deepEqual(third, first, 'without the file, the summary is the same as before');
});
