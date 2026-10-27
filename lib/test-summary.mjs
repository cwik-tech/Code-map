// The test-quality summary: statistics, what the scan sees, next steps and the limits of the evidence.
// Self-contained on purpose: the offline page embeds this same function to summarize a module, a folder or a file.
// Each statistic and observation names its evidence: inventory (counted in test files), inferred (links from references
// and pattern-matched checks), pattern (a source pattern), measured (coverage), git (history) or model (optional labels).
export function summarizeTests(tests, scope = {}) {
  const roots = scope.paths ?? (scope.path ? [scope.path] : null), scoped = !!roots;
  const inScope = (path) => !roots || roots.some((root) => path === root || path.startsWith(root + '/'));
  const fmt = (n) => n.toLocaleString('en-US');
  const plural = (n, one, many = one + 's') => `${fmt(n)} ${n === 1 ? one : many}`;
  const sum = (list, value) => list.reduce((total, item) => total + value(item), 0);
  const at = (path, line, text, test = null) => ({ path, line, text, ...(test ? { test } : {}) });
  const units = tests.units.filter((unit) => inScope(unit.path)), withExits = units.filter((unit) => unit.exits.length);
  // A scope's cases are the tests that call its functions directly or reach them through callers, including cases beyond the displayed routes.
  const caseIds = scoped ? [...new Set(units.flatMap((unit) => [...unit.direct, ...(unit.viaIds ?? unit.viaCases.map((item) => item.id))]))].sort((a, b) => a - b) : tests.cases.map((item) => item.id);
  const cases = caseIds.map((id) => tests.cases[id]), casePaths = new Set(cases.map((item) => item.path));
  const files = tests.testFiles.filter((file) => !scoped || casePaths.has(file.path));
  const testFiles = files.filter((file) => file.kind === 'tests'), unrecognized = scoped ? [] : files.filter((file) => file.kind === 'unrecognized');
  const runs = cases.filter((item) => item.status !== 'skipped' && item.status !== 'todo' && item.status !== 'conditional');
  const withStatus = (status) => cases.filter((item) => item.status === status);
  const unitsWith = (status) => withExits.filter((unit) => unit.status === status);
  const direct = unitsWith('direct'), indirect = unitsWith('indirect'), noAssertion = unitsWith('no-failure-assertion'), unreached = unitsWith('unreached');
  const priority = (unit) => unit.exits.length * (1 + unit.affects) + (unit.exported ? 0.5 : 0);
  const missing = [...noAssertion, ...unreached].sort((a, b) => priority(b) - priority(a) || a.path.localeCompare(b.path) || a.line - b.line);
  const exits = withExits.flatMap((unit) => unit.exits.map((exit) => ({ ...exit, unit })));
  const known = exits.filter((exit) => exit.hits !== null), notRan = known.filter((exit) => exit.hits === 0);
  const fixes = (tests.fixCommits?.commits ?? []).filter((commit) => !scoped || commit.sources.some(inScope));
  const fixNoTest = fixes.filter((commit) => commit.tests.length === 0);
  const smelly = (smell) => runs.filter((item) => item.smells.includes(smell));
  const layers = {};
  for (const file of testFiles) layers[file.type] = (layers[file.type] ?? 0) + 1;
  const intents = { happy: 0, unhappy: 0, edge: 0, regression: 0 };
  for (const item of runs) if (item.intent && item.intentState === 'current') intents[item.intent]++;
  const exportCandidates = (tests.exportedFunctions ?? []).filter((item) => inScope(item.path) && item.relationship === 'candidate');
  const counts = { exportCandidates: exportCandidates.length, testFiles: testFiles.length, helperFiles: files.filter((file) => file.kind === 'helper').length, unrecognizedFiles: unrecognized.length,
    unreadableFiles: scoped ? 0 : tests.unreadable.length, cases: cases.length, running: runs.length, skipped: withStatus('skipped').length, todo: withStatus('todo').length,
    conditional: withStatus('conditional').length, focused: withStatus('focused').length, parameterized: cases.filter((item) => item.each).length,
    assertions: sum(runs, (item) => item.assertions), failureAssertions: sum(runs, (item) => item.failures), failureCases: runs.filter((item) => item.failures > 0).length,
    regressionNamed: runs.filter((item) => item.regression).length, functionsWithExits: withExits.length, exits: exits.length,
    direct: direct.length, indirect: indirect.length, noFailureAssertion: noAssertion.length, unreached: unreached.length,
    candidateOnly: noAssertion.filter((unit) => unit.candidates > 0).length, exitsKnown: known.length, exitsRan: known.length - notRan.length,
    fixCommits: fixes.length, fixWithoutTest: fixNoTest.length, layers, intents };
  const day = (iso) => String(iso).slice(0, 10);
  const age = tests.coverage.date && tests.coverage.mapped ? Math.max(0, Math.round((Date.parse(tests.coverage.mapped) - Date.parse(tests.coverage.date)) / 864e5)) : null;
  const coverageNote = tests.coverage.state === 'none' ? 'no coverage report found' : tests.coverage.state === 'not-applicable' ? 'the report applies only to a working-tree map'
    : `${tests.coverage.file}, written ${day(tests.coverage.date)}${age === null ? '' : ` (${plural(age, 'day')} before this map)`}, not tied to a revision${known.length < exits.length ? ` · ${fmt(exits.length - known.length)} exits not measured` : ''}`;
  const labeledPaths = new Set(files.filter((file) => file.labelState).map((file) => file.path));
  const labels = !scoped ? tests.labels : { ...tests.labels,
    current: cases.filter((item) => item.intentState === 'current').length,
    staleFiles: files.filter((file) => file.labelState === 'stale').length,
    unstampedFiles: files.filter((file) => file.labelState === 'unstamped').length,
    missing: cases.filter((item) => !item.intent && labeledPaths.has(item.path)).length };
  const labelNote = !labels.file || (!labels.current && !labels.staleFiles && !labels.unstampedFiles) ? 'none: optional, run code-map labels'
    : `${fmt(intents.happy)} happy · ${fmt(intents.unhappy)} unhappy · ${fmt(intents.edge)} edge · ${fmt(intents.regression)} regression · ${labels.staleFiles} stale and ${labels.unstampedFiles} unstamped files · ${fmt(labels.missing)} cases without a label`;
  const statistics = [
    { key: 'testFiles', source: 'inventory', label: 'Test files', value: counts.testFiles,
      detail: `${Object.entries(layers).sort((a, b) => b[1] - a[1]).map(([type, n]) => `${type} ${fmt(n)}`).join(' · ') || 'none'}${counts.helperFiles ? ` · ${counts.helperFiles} helper files` : ''}${counts.unrecognizedFiles ? ` · ${counts.unrecognizedFiles} not parsed` : ''}` },
    { key: 'cases', source: 'inventory', label: 'Test cases', value: counts.cases,
      detail: `${fmt(counts.running)} run · ${counts.skipped} skipped · ${counts.todo} todo · ${counts.conditional} conditional · ${counts.focused} focused${counts.parameterized ? ` · ${counts.parameterized} parameterized definitions (row count unknown)` : ''}` },
    { key: 'failureCases', source: 'pattern', label: 'Cases with a failure assertion', value: counts.failureCases,
      detail: `${fmt(counts.running - counts.failureCases)} with none found (intent unknown) · ${fmt(counts.assertions)} assertions · ${fmt(counts.regressionNamed)} named as regression tests` },
    { key: 'functionsWithExits', source: 'pattern', label: 'Functions with failure exits', value: counts.functionsWithExits, detail: plural(counts.exits, 'failure exit') },
    { key: 'noFailureAssertion', source: 'inferred', label: 'No failure assertion found', value: counts.noFailureAssertion + counts.unreached, warn: missing.length > 0,
      detail: `${fmt(counts.noFailureAssertion)} called by tests (${counts.candidateOnly} with an untied candidate) · ${fmt(counts.unreached)} not reached by any test` },
    { key: 'withFailureAssertion', source: 'inferred', label: 'With a failure assertion', value: counts.direct + counts.indirect,
      detail: `${fmt(counts.direct)} direct · ${fmt(counts.indirect)} only through callers` },
    { key: 'exitsRan', source: 'measured', label: 'Failure exits that ran', value: tests.coverage.state === 'measured' && known.length ? `${fmt(counts.exitsRan)} of ${fmt(known.length)}` : 'unknown',
      warn: notRan.length > 0, detail: coverageNote },
    { key: 'fixWithoutTest', source: 'git', label: 'Fix commits with no test', value: counts.fixWithoutTest, warn: counts.fixWithoutTest > 0,
      detail: tests.fixCommits ? `of ${plural(counts.fixCommits, 'fix commit')} in the last ${plural(Math.min(tests.fixCommits.window, tests.fixCommits.scanned), 'commit')}` : 'no Git history read' },
    { key: 'labels', source: 'model', label: 'Model labels', value: labels.current, detail: labelNote },
  ];
  const observations = [];
  if (exportCandidates.length) observations.push({ key: 'exportCandidates', severity: 'low', source: 'inferred',
    count: exportCandidates.length, text: `${exportCandidates.length} exported functions have no static test relationship. These are candidates. Runtime hits are unknown.`,
    action: 'Inspect these candidates and collect bound function counters.',
    evidence: exportCandidates.slice(0, 8).map((item) => at(item.path, item.line, item.names.join(', '))) });
  const see = (severity, source, key, list, text, action, evidence) => {
    if (list.length) observations.push({ key, severity, source, count: list.length, text, action, evidence: evidence.slice(0, 8) });
  };
  const caseAt = (item) => at(item.path, item.line, item.suite ? `${item.suite} > ${item.name}` : item.name);
  const firstTest = (unit) => { const item = tests.cases[unit.direct[0] ?? unit.viaCases[0]?.id]; return item ? { path: item.path, line: item.line, name: item.name } : null; };
  const reached = (unit) => { const n = unit.direct.length + unit.via; return unit.status === 'unreached' ? 'no test reaches it' : n === 1 ? '1 test reaches it, with no failure assertion for it' : `${fmt(n)} tests reach it, none with a failure assertion for it`; };
  const unitAt = (unit) => at(unit.path, unit.line, `${unit.name} · ${plural(unit.exits.length, 'failure exit')} · ${reached(unit)}${unit.candidates ? ` · ${plural(unit.candidates, 'untied candidate')}` : ''}`, firstTest(unit));
  see('high', 'inventory', 'focused', withStatus('focused'), `${plural(counts.focused, 'test case is', 'test cases are')} focused with .only. The test runner can skip the other tests while a focus is in place.`,
    'Remove .only before you commit.', withStatus('focused').map(caseAt));
  see('high', 'inferred', 'noFailureAssertion', missing, `${fmt(missing.length)} of ${plural(withExits.length, 'function')} with failure exits ${missing.length === 1 ? 'has' : 'have'} no failure assertion that the scan can tie to ${missing.length === 1 ? 'it' : 'them'}. No test reaches ${fmt(counts.unreached)} of them.`,
    'Add a test that triggers each failure exit and checks the error. Start at the top: those functions affect the most files. An existing test that already calls the function is a good place to start.', missing.map(unitAt));
  see('high', 'measured', 'exitsNotRan', notRan, `${fmt(notRan.length)} of ${plural(known.length, 'measured failure exit')} never ran in the coverage run. The report was written on ${day(tests.coverage.date)} and is not tied to a revision, so check that it matches the current code.`,
    'Write a test that reaches each of these lines. If a line can never run, remove the failure exit.', notRan.map((exit) => at(exit.unit.path, exit.line, `${exit.unit.name} · ${exit.kind}`)));
  see('medium', 'git', 'fixWithoutTest', fixNoTest, `${fmt(fixNoTest.length)} of ${plural(fixes.length, 'commit')} that look like bug fixes changed no test file.`,
    'Add a regression test for each fix, so that the bug cannot come back unnoticed.', fixNoTest.map((commit) => at(commit.sources[0], null, `${commit.sha.slice(0, 7)} ${commit.subject}`)));
  see('medium', 'inventory', 'unrecognized', unrecognized, `${plural(unrecognized.length, 'file is', 'files are')} named like test files, but the scan found no test cases in ${unrecognized.length === 1 ? 'it' : 'them'}. ${unrecognized.length === 1 ? 'It uses' : 'They use'} a syntax that the scan does not know, or ${unrecognized.length === 1 ? 'holds' : 'hold'} no tests. The numbers above do not include ${unrecognized.length === 1 ? 'it' : 'them'}.`,
    'Check these files by hand.', unrecognized.map((file) => at(file.path, null, file.path)));
  see('medium', 'pattern', 'noAssertions', smelly('no-assertions'), `${plural(smelly('no-assertions').length, 'running test case has', 'running test cases have')} no assertion that the scan can find.`,
    'Add an assertion, or confirm that a custom helper or a rejected promise makes the test fail.', smelly('no-assertions').map(caseAt));
  const hot = tests.hotspots.filter((path) => inScope(path) && missing.some((unit) => unit.path === path));
  see('medium', 'inferred', 'hotspots', hot, `${plural(hot.length, 'hotspot file has', 'hotspot files have')} failure exits with no failure assertion found. Hotspots change often and are large.`,
    'Start with these files: tests in code that changes often pay back the most.', hot.map((path) => at(path, null, path)));
  const untied = noAssertion.filter((unit) => unit.candidates > 0);
  see('low', 'inferred', 'candidates', untied, `${plural(untied.length, 'function has tests', 'functions have tests')} with failure evidence that the scan cannot tie to ${untied.length === 1 ? 'it' : 'them'}: a failure assertion about something else, a name or a model label. These candidates do not close the gap.`,
    'Read the tests. If one checks this function\'s failure, assert on the value that the function returns or throws.', untied.map(unitAt));
  const mismatched = testFiles.filter((file) => file.mismatch);
  see('low', 'pattern', 'typeMismatch', mismatched, `${plural(mismatched.length, 'test file')} in a unit-test folder ${mismatched.length === 1 ? 'uses' : 'use'} a process, the network, a database or a browser.`,
    'Move these files to an integration folder, or replace the dependency with a fake.', mismatched.map((file) => at(file.path, null, `${file.path} · ${file.effects.join(', ')}`)));
  see('low', 'pattern', 'swallowed', smelly('swallowed-error'), `${plural(smelly('swallowed-error').length, 'test case catches', 'test cases catch')} an error around an assertion and do${smelly('swallowed-error').length === 1 ? 'es' : ''} nothing with it. A failing assertion inside the try block can pass unnoticed.`,
    'Assert in the catch block, or remove the try and catch.', smelly('swallowed-error').map(caseAt));
  see('low', 'pattern', 'fixedWait', smelly('fixed-wait'), `${plural(smelly('fixed-wait').length, 'test case waits', 'test cases wait')} for a fixed time. Fixed waits make tests slow and can make them flaky.`,
    'Wait for a condition, or use fake timers.', smelly('fixed-wait').map(caseAt));
  const byName = runs.filter((item) => item.evidence === 'name');
  see('low', 'pattern', 'nameOnly', byName, `${plural(byName.length, 'test case has a name', 'test cases have names')} that describe${byName.length === 1 ? 's' : ''} a failure, but the scan found no failure assertion in ${byName.length === 1 ? 'it' : 'them'}. A name alone does not count as a failure test.`,
    'Read a few of these tests. If they check the failure in a way that the scan does not know, no action is necessary.', byName.map(caseAt));
  const modelOnly = runs.filter((item) => item.intent === 'unhappy' && item.intentState === 'current' && item.evidence !== 'assertion');
  see('low', 'model', 'modelOnly', modelOnly, `The model labels ${plural(modelOnly.length, 'test case')} as unhappy path, but the scan found no failure assertion in ${modelOnly.length === 1 ? 'it' : 'them'}.`,
    'Read these tests. A custom helper can make the check, or the label can be wrong.', modelOnly.map(caseAt));
  const uncertain = [...withStatus('skipped'), ...withStatus('todo'), ...withStatus('conditional')];
  see('low', 'inventory', 'parked', uncertain, `${plural(counts.skipped, 'test case is', 'test cases are')} skipped, ${counts.todo} ${counts.todo === 1 ? 'is' : 'are'} marked todo and ${counts.conditional} run${counts.conditional === 1 ? 's' : ''} only on a condition. They do not count as evidence.`,
    'Fix or remove skipped tests that no longer apply.', uncertain.map(caseAt));
  const unreadable = scoped ? [] : tests.unreadable;
  see('low', 'inventory', 'unreadable', unreadable, `${plural(unreadable.length, 'test file is a script', 'test files are scripts')} that the scan cannot read, for example shell scripts.`,
    'Check these tests by hand. The numbers above do not include them.', unreadable.map((path) => at(path, null, path)));
  const order = { high: 0, medium: 1, low: 2 };
  observations.sort((a, b) => order[a.severity] - order[b.severity]);
  const nextSteps = [];
  for (const item of withStatus('focused').slice(0, 1)) nextSteps.push({ source: 'inventory', text: `Remove .only from "${item.name}" (${item.path}:${item.line}).`, evidence: [caseAt(item)] });
  for (const unit of missing.slice(0, 3)) {
    const test = firstTest(unit);
    nextSteps.push({ source: 'inferred', text: `Add a failure test for ${unit.name} (${unit.path}:${unit.line}). It has ${plural(unit.exits.length, 'failure exit')}, at line${unit.exits.length === 1 ? '' : 's'} ${unit.exits.map((exit) => exit.line).join(', ')}.${test ? ` Start from the test "${test.name}" (${test.path}:${test.line}), which already reaches it.` : ''}`, evidence: [unitAt(unit)] });
  }
  for (const commit of fixNoTest.slice(0, 1)) nextSteps.push({ source: 'git', text: `Add a regression test for the fix in commit ${commit.sha.slice(0, 7)} ("${commit.subject}").`, evidence: [at(commit.sources[0], null, commit.subject)] });
  for (const item of smelly('no-assertions').slice(0, 1)) nextSteps.push({ source: 'pattern', text: `Add an assertion to "${item.name}" (${item.path}:${item.line}).`, evidence: [caseAt(item)] });
  if (tests.coverage.state === 'none') nextSteps.push({ source: 'measured', text: 'Run the tests with coverage (lcov), then map the working tree with --worktree to see which failure exits ran.', evidence: [] });
  else if (tests.coverage.state === 'not-applicable') nextSteps.push({ source: 'measured', text: 'Map the working tree with --worktree to use the coverage report for the failure exits.', evidence: [] });
  if (!scoped && !tests.labels.current && cases.length) nextSteps.push({ source: 'model', text: 'Optional: run code-map labels and let a model label the intent of each test case.', evidence: [] });
  if (!observations.length) observations.push({ key: 'none', severity: 'low', source: 'inferred', count: 0, text: 'The scan found no gaps with the available evidence.', action: 'Read the limits below before you rely on this result.', evidence: [] });
  return { scope: scope.label ?? (roots ? roots.join(', ') : 'project'), counts, statistics, observations, nextSteps: nextSteps.slice(0, 6),
    canAndCannot: 'This scan finds functions whose failure exits have no failure test. It cannot judge whether an existing test checks the correct behavior.',
    limits: [
      'Failure exits are found by pattern: throw, reject, catch, error values, 4xx and 5xx responses, and nonzero exits. Other failure styles are not counted.',
      'Failure assertions are found by pattern. A custom assertion helper can hide one, so "no failure assertion found" means unknown, not proof of a happy-path test.',
      'A test reaches a function when its code references the imported name. That is an inferred link, not proof that the call runs.',
      'A failure assertion counts for a function only when the assertion names it, or a local variable or caught error that comes from it. When a test calls one source function only, its failure assertions count for that function. Other failure evidence, a test name or a model label never closes a gap.',
      'A failure assertion for a caller counts only as "through callers", up to 3 calls away, with the route shown.',
      'Skipped, todo and conditional tests are counted in the inventory, but they never count as evidence. A parameterized test counts once, because its row count is unknown.',
      'Coverage hits show that a line ran, not that a test checked its result. They apply only to a working-tree map, and the report is not tied to a revision. An exit on the same line as its condition is measured only from an Istanbul-style branch record; otherwise it stays unknown.',
      'Fix commits are found by their subject. A regression test in a later commit is not linked to its fix.',
      'Test layers come from folder and file names first, then from imports and side effects.',
      'Model labels are optional. They can be wrong, and they become stale when the test file changes.',
    ] };
}
