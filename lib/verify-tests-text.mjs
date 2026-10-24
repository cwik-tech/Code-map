// The words of the row "Test information" in verification-report.md: the weaker assertions and runner settings, the flaky and
// slower cases, and the discovered tests that ran or did not (the section `tests` of the results). One table row, so that the
// report keeps its line limit. Pure. The caller gives the functions that escape a value for Markdown.

const named = 3;
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const records = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'object' && item !== null) : []);
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
const kinds = { 'expected-failure': 'an added expected-failure declaration', 'fewer-assertions': 'fewer assertions', 'looser-matcher': 'a looser matcher', 'plan-removed': 'a removed expect.assertions or expect.hasAssertions' };
/** A JUnit report often uses the file as the suite name, so a suite equal to the file is left out, as in the checks. */
const caseName = (item) => [item.file ?? item.path, item.suite === (item.file ?? item.path) ? null : item.suite, item.name].filter(Boolean).join(' > ');

/** The first three items and "and N more" for a total of `total`. */
function series(items, total) {
  const shown = items.slice(0, named), rest = Math.max(total, items.length) - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0] ?? '';
}

/** The text of the row for `results.tests`. `code` and `plain` escape a value as a code span or as text. */
export function testsRow(tests, { code, plain, profileId }) {
  const parts = [], weak = tests.assertionWeakening ?? {}, runner = tests.runnerSettings ?? {}, flaky = tests.flaky ?? {}, slower = tests.slower ?? {};
  const changes = count(weak.total), files = count(weak.files), unread = Array.isArray(weak.unread) ? weak.unread.length : 0;
  if (changes) {
    parts.push(`Code-map compared the kept test cases of ${plural(files, 'changed test file')}. ${plural(changes, 'assertion change')} make${changes === 1 ? 's' : ''} test cases weaker: `
      + `${series(records(weak.entries).map((entry) => `${code(caseName(entry), 160)} (${kinds[entry.kind] ?? plain(entry.kind, 40)})`), changes)}.`);
  } else if (files) parts.push(`The kept test cases of ${plural(files, 'changed test file')} have no weaker assertion.`);
  if (unread) parts.push(`Code-map cannot read ${plural(unread, 'changed test file')} of the base or the head.`);
  const entries = records(runner.entries), weaker = entries.filter((entry) => entry.state === 'WEAKER'), unknown = entries.filter((entry) => entry.state === 'UNKNOWN');
  if (count(runner.weaker)) parts.push(`${plural(count(runner.weaker), 'runner configuration is', 'runner configurations are')} weaker: ${series(weaker.map((entry) => code(entry.path)), count(runner.weaker))}.`);
  if (count(runner.unknown)) parts.push(`Code-map cannot read the settings of ${plural(count(runner.unknown), 'changed runner configuration')}: ${series(unknown.map((entry) => code(entry.path)), count(runner.unknown))}.`);
  if (count(runner.files) && !count(runner.weaker) && !count(runner.unknown)) parts.push('No changed runner configuration is weaker.');
  if (count(flaky.total)) {
    parts.push(`${plural(count(flaky.total), 'test case is', 'test cases are')} flaky: ${series(records(flaky.entries).map((entry) =>
      `${code(caseName(entry), 160)} passed ${plural(count(entry.passed), 'time')} and failed ${plural(count(entry.failed), 'time')}`), count(flaky.total))}. Each failed attempt still counts as a failure.`);
  }
  if (count(slower.total)) {
    parts.push(`${plural(count(slower.total), 'test case is', 'test cases are')} slower than in the base report of the same run: ${series(records(slower.entries).map((entry) =>
      `${code(caseName(entry), 160)} from ${plain(entry.baseMs, 20)} ms to ${plain(entry.headMs, 20)} ms`), count(slower.total))}.`);
  }
  const runtime = tests.runtimeLinks;
  if (runtime?.state === 'UNKNOWN') parts.push(`Runtime test links are UNKNOWN. ${plain(runtime.reason, 200)}`);
  if (runtime?.state === 'KNOWN') {
    const counts = runtime.counts ?? {};
    parts.push(`Runtime test links: ${count(counts.confirmed)} confirmed, `
      + `${count(counts['not observed'])} not observed and ${count(counts['runtime only'])} runtime only. These links are information only.`);
  }
  const outcomes = tests.outcomes;
  if (outcomes?.state === 'UNKNOWN') parts.push(`Case outcome comparison is UNKNOWN. ${plain(outcomes.reason, 200)}`);
  if (outcomes?.state === 'COMPARED') {
    const transitions = Object.entries(outcomes.counts ?? {}).sort(([a], [b]) => a.localeCompare(b));
    const lost = records(outcomes.basePassesLost?.entries);
    const lostCount = count(outcomes.counts?.['passed>skipped']) + count(outcomes.counts?.['passed>missing']);
    parts.push(`Case outcome transitions: ${transitions.map(([transition, total]) => `${plain(transition, 40)} ${count(total)}`).join(', ') || 'none'}`
      + (lostCount ? `. Base passes that are now skipped or missing: ${series(lost.map((entry) => `${code(caseName(entry), 160)}${entry.deleted ? ' (deleted file)' : ''}`), lostCount)}` : '') + '.');
  }
  const found = tests.discovery;
  if (found && typeof found === 'object') {
    const discovered = found.files ?? {}, cases = found.cases && typeof found.cases === 'object' ? found.cases : null;
    parts.push(`The discovery reports found ${plural(count(discovered.total), 'test file')}${cases ? ` and ${plural(count(cases.total), 'test case')}` : ''}. `
      + `${plural(count(discovered.ran), 'test file')} ran in the bound head test reports, and ${count(discovered.notRan)} did not`
      + `${count(discovered.notRan) ? `: ${series((Array.isArray(discovered.notRanPaths) ? discovered.notRanPaths : []).map((path) => code(path)), count(discovered.notRan))}` : ''}.`
      + (cases && count(cases.notRan) ? ` ${plural(count(cases.notRan), 'discovered test case')} did not run.` : '')
      + (count(found.unnamedCases) ? ` ${plural(count(found.unnamedCases), 'head test case has', 'head test cases have')} no file, so the list of files that did not run can be too long.` : '')
      + (found.filtered ? ' A discovery report comes from a filtered run, so it can list only a part of the tests.' : ''));
  }
  for (const item of records(tests.discoveryAttestations)) {
    parts.push(`${code(item.artifact)} (${plain(item.side, 8)}): discovered ${count(item.discovered)} ${plain(item.unit, 8)}, ran ${count(item.ran)}, did not run ${count(item.notRan)}. Filtered: ${item.filtered ? 'yes' : 'no'}.`);
  }
  const dependencies = tests.dependencies;
  if (dependencies?.compared) {
    if (dependencies.lockfilesChanged) {
      const counts = Object.entries(dependencies.counts ?? {}).map(([kind, total]) => `${plain(kind, 30)} ${count(total)}`).join(', ');
      parts.push(`The base and head lockfiles differ. Dependency changes: ${counts || 'unknown'}. Examples: ${records(dependencies.examples).map((item) => code(item.name)).join(', ') || 'none'}.`);
    }
    if (dependencies.baseUsesHeadDependencies) parts.push('The isolated base ran with the head dependencies from the working folder node_modules.');
    else if (dependencies.revisionDependenciesPrepared) parts.push('Both isolated revisions prepared their own lockfile dependencies with offline npm installs.');
    else parts.push('The reports do not establish revision-specific dependency preparation on both sides.');
    parts.push('Offline installs need an explicitly authorized cache. Missing cached packages fail preparation. Lifecycle scripts never run.');
  }
  if (!parts.length) parts.push('Code-map found no weaker assertion, no weaker runner setting, no flaky or slower test case and no discovery report.');
  const use = profileId === 'evidence-v1'
    ? 'Assertion and runner weakening require current human reviews in evidence-v1.'
    : 'No check reads this information.';
  if (tests.reviews?.total) parts.push(`${count(tests.reviews.unreviewed)} of ${count(tests.reviews.total)} weakening entries need review.`);
  if (tests.reviews?.error) parts.push(`Cannot read weakening reviews: ${plain(tests.reviews.error, 300)}.`);
  return [...parts, use, 'The section `tests` of verification-results.json has the full lists.'].join(' ');
}
