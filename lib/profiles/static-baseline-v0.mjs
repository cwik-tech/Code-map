// The rule set static-baseline-v0, as the user accepted it in docs/work/2026-10-22-verify-profile-v0/proposal.md.
// It turns the context that `code-map verify` builds into checks (obligations) and the rating input of each category:
// the level-1 failures, the minimum evidence and the band 3, 4 and 5 predicates. Pure: it reads no file and runs no command.
// Each result comes from findings, labels, the change list, bound test reports or bound compiler reports. A PASS or FAIL from findings needs
// comparable analyses. With the evidence of v0, the profile can block a change, but it cannot make a change READY.
import { isCode, isTest, unsupportedFiles } from '../project.mjs';
import { categories } from '../ratings.mjs';
import { matchesGlob } from '../verify-change.mjs';
import { requiredObligationsFor } from '../verify-request.mjs';
import { caseName, failed, runFailures } from './test-run-matching.mjs';
export { caseName } from './test-run-matching.mjs';
import { typeCases } from './compiler-evidence.mjs';
import { aliasImports, loaderSyntax, lostTestImports, uncheckedFiles } from './import-evidence.mjs';
import { comparisonFixes, missingFields, openChecks, otherFix, requestTitles } from './static-baseline-v0-text.mjs';

export const profile = { id: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', requiredCategories: [...categories] };
/** Whole-number percentages of the changed lines and the changed branches that the tests must run, for 3 and 4 of 5 in Verification Coverage. */
export const thresholds = { changedLines: 80, changedBranches: 70 };

const [SI, VC, BC, CC] = categories;
const importRules = ['IMPORT-UNRESOLVED', 'IMPORT-NAME-MISSING'], weakRules = ['TEST-PARKED', 'TEST-NO-ASSERTIONS', 'TEST-SWALLOWED-ERROR'];
const maxEvidence = 50, maxNamed = 3;
const ran = (item) => item.status !== 'skipped';
const plural = (count, one, many = one + 's') => `${count} ${count === 1 ? one : many}`;
const named = (list, name = (value) => value) => list.slice(0, maxNamed).map(name).join(', ') + (list.length > maxNamed ? `, and ${list.length - maxNamed} more` : '');
const findingName = (finding) => `${finding.id} (${finding.location?.path ?? finding.paths?.[0] ?? 'no path'})`;
const ids = (findings) => findings.map((finding) => finding.id);
const pathIds = (paths) => paths.map((path) => `path:${path}`);
const reportIds = (reports) => reports.map((report) => `report:${report.artifact}`);
const edgeName = ({ file, edge }) => `${file.path} imports "${edge.specifier}"`, edgeIds = (list) => list.map(({ file, edge }) => `import:${file.path}:${edge.line ?? '?'}`);
/** true when each state is true, false when one state is false, and otherwise null (unknown). */
const every = (states) => states.includes(false) ? false : states.every((state) => state === true) ? true : null;
const outcome = (result, rationale, evidenceIds = [], next = null) => ({ result, rationale, evidenceIds, next });
const predicate = (id, met, evidenceIds = []) => ({ id, met, evidenceIds: evidenceIds.slice(0, maxEvidence) });

/** A check gives FAIL first, then UNKNOWN, then PASS. Each case is [holds, rationale, evidenceIds, next], and the first case that holds wins. */
function decide(fails, unknowns, [rationale, evidenceIds = []]) {
  const fail = fails.find(([holds]) => holds), unknown = unknowns.find(([holds]) => holds);
  return fail ? outcome('FAIL', ...fail.slice(1)) : unknown ? outcome('UNKNOWN', ...unknown.slice(1)) : outcome('PASS', rationale, evidenceIds);
}

/** One obligation that passes validateObligation, plus a title, a rationale and the next action of a FAIL or an UNKNOWN result. */
function item({ id, category, title, required = true, blocking = false, severity = 'medium' }, { result, rationale, evidenceIds, next, applicability }) {
  const notApplicable = result === 'NOT_APPLICABLE';
  return { id, category, required, blocking, severity, applicability: applicability ?? (notApplicable ? 'NOT_APPLICABLE' : 'APPLICABLE'),
    ...(notApplicable ? { applicabilityReason: rationale } : {}), result, eligible: result !== 'UNKNOWN', review: 'none',
    evidenceIds: [...new Set(evidenceIds)].slice(0, maxEvidence), title, rationale, nextAction: result === 'FAIL' || result === 'UNKNOWN' ? next ?? null : null };
}

/** A check of the request that no evidence of v0 can close. It keeps its flags and its applicability, and it stays UNKNOWN. */
const open = (base) => {
  const criterion = base.id.slice('acceptance.'.length), field = missingFields[base.id], [reason, next] = field ?? openChecks[base.id] ?? openChecks.acceptance;
  // The evidence of an open check is the request field that it comes from.
  const source = base.id.startsWith('acceptance.') ? `acceptanceCriteria.${criterion}` : base.id === 'scope.declared' ? 'allowedPaths'
    : base.id === 'feature.acceptance-criteria' ? 'acceptanceCriteria' : 'changeType';
  return item({ ...base, title: requestTitles[base.id] ?? `Acceptance criterion ${criterion} holds` },
    { result: 'UNKNOWN', applicability: base.applicability, evidenceIds: [`request:${source}`], next, rationale: `${base.rationale} ${field ? '' : 'No check of this version can confirm it. '}${reason}` });
};

/** The rating input of one category: every category is required in v0, and the rubric is the version of this profile. */
const category = (name, obligations, { fundamental, minimum, bands }) => ({ category: name, required: profile.requiredCategories.includes(name),
  rubric: { version: profile.ratingRulesVersion }, inapplicable: null, obligations, fundamental,
  minimumEvidence: { met: minimum.every(([met]) => met), missing: minimum.filter(([met]) => !met).map(([, text]) => text) }, bands: { 4: [], 5: [], ...bands } });

/** Whether a test file has a case that `accept` takes: null when a case without a file path can be from that file. */
// One index for each list of reports and each test, so that many test files and many cases cost time in their sum, not their product.
const indexes = new WeakMap(), notErrored = (entry) => entry.status !== 'errored';
function fileState(reports, path, accept) {
  const byTest = indexes.get(reports) ?? new Map();
  indexes.set(reports, byTest);
  let index = byTest.get(accept);
  if (!index) {
    index = { files: new Set(), unnamed: false };
    for (const report of reports) for (const entry of report.cases) if (accept(entry)) { if (entry.file === null) index.unnamed = true; else index.files.add(entry.file); }
    byTest.set(accept, index);
  }
  return index.files.has(path) ? true : index.unnamed ? null : false;
}

/** A deleted or moved source file can still have consumers in code outside the source roots, whose imports the analysis does not read. */
function hiddenConsumers(base, change) {
  const outside = base.analysis.outsideRoots ?? { count: 0, paths: [] }, sources = new Set(base.analysis.files.map((file) => file.path));
  const removed = change.files.filter((file) => file.status === 'D' || file.status === 'R').map((file) => file.from ?? file.path)
    .filter((path) => sources.has(path) || (isCode(path) && !isTest(path)));
  return [outside.count > 0 && removed.length > 0, `${plural(outside.count, 'code file')} outside the source roots can import ${named(removed)}, but the analysis does not read their imports.`,
    pathIds(outside.paths), 'Read the imports of these files and update each one, or add their folders to "roots" in .code-map.json in its own commit before the change, and use that commit as the base.'];
}

/** The facts that more than one category uses, from the context of one verification run. */
function factsOf(context) {
  const { head, base, change } = context, labels = context.labels ?? {}, origins = context.importOrigins ?? new Map(), comparable = context.comparable === true;
  const changed = new Set(change.paths), moves = new Map(context.renames === undefined ? change.files.filter((file) => file.status === 'R' && file.from).map((file) => [file.from, file.path]) : context.renames.map(({ from, to }) => [from, to]));
  const rename = (path) => moves.get(path) ?? path, alias = aliasImports(head, base, new Map([...moves].map(([from, to]) => [to, from])), changed);
  const orphaned = lostTestImports(head, base, rename, changed), unchecked = uncheckedFiles(head, change);
  const label = (finding) => labels[finding.id] ?? 'UNKNOWN';
  const findings = (rules) => {
    const all = head.findings.filter((finding) => rules.includes(finding.ruleId));
    return { all, new: all.filter((finding) => label(finding) === 'NEW'), unknown: all.filter((finding) => label(finding) === 'UNKNOWN') };
  };
  const command = typeof context.command === 'function' ? context.command : (args) => ['code-map', ...args].join(' ');
  const analyses = [`analysis:${base.analysisId}`, `analysis:${head.analysisId}`], reasons = context.comparisonReasons ?? [];
  const fixes = (reasons.length ? reasons : [null]).map((key) => comparisonFixes[key] ?? otherFix), whys = fixes.map(([why]) => why);
  const parsedPython = new Set([...head.analysis.files, ...(head.analysis.importFiles ?? [])].filter((file) => file.path.endsWith('.py')).map((file) => file.path));
  for (const file of change.files.filter((file) => file.status === 'D')) if (file.path.endsWith('.py') && base.analysis.files.some((old) => old.path === file.path)) parsedPython.add(file.path);
  const unsupported = change.paths.filter((path) => !parsedPython.has(path) && Object.keys(unsupportedFiles([path])).length > 0);
  const testsOf = (side) => side.analysis.tests ?? null;
  return { context, request: context.request, head, base, change, changed, comparable, analyses, findings, rename, lostAlias: alias.lost, addedAlias: alias.added,
    origin: (finding) => origins.get(finding.id) ?? 'undecided', heads: context.reports?.head ?? [], bases: context.reports?.base ?? [],
    headTests: testsOf(head), baseTests: testsOf(base),
    unreadable: [...new Set([...(testsOf(head)?.unreadable ?? []), ...(testsOf(base)?.unreadable ?? [])])].filter((path) => changed.has(path)).sort(),
    list: (baseline, rule) => command(['inspect', '--analysis', head.analysisId, '--base-analysis', base.analysisId, '--findings', '--baseline', baseline, '--rule', rule]),
    incomparable: [!comparable, `The base and head analyses are not comparable, because ${whys.length > 1 ? `${whys.slice(0, -1).join(', ')} and ${whys.at(-1)}` : whys[0]}. Their findings cannot give PASS or FAIL.`,
      analyses, [...new Set(fixes.map(([, next]) => next))].join(' ')],
    unsupported: [unsupported.length > 0, `${plural(unsupported.length, 'changed file is', 'changed files are')} in a language that the analysis does not read: ${named(unsupported)}.`,
      pathIds(unsupported), 'Examine the imports of these files without Code-map: no check covers them.'],
    unchecked: [unchecked.length > 0, `Code-map does not check whether the imports of ${plural(unchecked.length, 'changed file')} resolve: ${named(unchecked)}. It checks source files, scanned test files and package-root JavaScript and TypeScript config files.`,
      pathIds(unchecked), 'Confirm with the TypeScript compiler or a test run that the imports of these files resolve. For source code outside the source roots, you can also add its folder to "roots" in .code-map.json.'],
    orphaned: [orphaned.length > 0, `The head analysis does not show ${plural(orphaned.length, 'test import')} of a changed source file that the base has: ${named(orphaned, ([test, path]) => `${test} imports ${path}`)}.`
      + ' This analysis lacks retained test import edges. Code-map cannot tell whether the change removed the import or broke it.',
      pathIds(orphaned.map(([test]) => test)), 'Run these test files on the head, or read their imports, and make sure that each import resolves.'],
    hidden: hiddenConsumers(base, change),
    noReport: "Run the project tests on the head, write a run manifest for the report, and add both files to reportInputs in the request. Refer to docs/verify.md, section 'Bound test reports'." };
}

/** A NEW import finding whose origin Code-map cannot decide, or an import finding without a NEW or EXISTING label, keeps both import checks open. */
function importCases(f, imports, undecided) {
  return [[imports.unknown.length > 0, `Code-map cannot label ${plural(imports.unknown.length, 'import finding')} as NEW or EXISTING: ${named(imports.unknown, findingName)}.`,
    ids(imports.unknown), f.list('unknown', imports.unknown[0]?.ruleId ?? importRules[0])],
  [undecided.length > 0, `Code-map cannot tell whether ${plural(undecided.length, 'NEW broken import')} resolved in the base: ${named(undecided, findingName)}.`,
    ids(undecided), f.list('new', undecided[0]?.ruleId ?? importRules[0])]];
}

function structural(f, requested) {
  const { head, base } = f, rules = head.analysis.rules ?? { declared: [], invalid: [] };
  const arch = f.findings(['ARCH-RULE']), imports = f.findings(importRules), cycles = f.findings(['CYCLE-VALUE']);
  const added = imports.new.filter((finding) => f.origin(finding) === 'new-import'), undecided = imports.new.filter((finding) => f.origin(finding) === 'undecided');
  const newBroken = [...added.map(findingName), ...f.addedAlias.map(edgeName)], newIds = [...ids(added), ...edgeIds(f.addedAlias)];
  const baseCycles = (base.analysis.cycles?.value ?? []).map((group) => new Set(group.files.map(f.rename)));
  const newCycles = cycles.new.filter((finding) => !baseCycles.some((group) => finding.paths.every((path) => group.has(path))));
  const obligations = [
    item({ id: 'structure.architecture-rules', category: SI, title: 'No new architecture-rule break', blocking: true, severity: 'high' },
      !rules.declared.length && !rules.invalid.length ? outcome('NOT_APPLICABLE', 'The project declares no architecture rule in .code-map.json, so no import can break a rule.', f.analyses)
        : decide([[f.comparable && arch.new.length > 0, `The head has ${plural(arch.new.length, 'NEW ARCH-RULE finding')}: ${named(arch.new, findingName)}.`, ids(arch.new), f.list('new', 'ARCH-RULE')]],
          [f.incomparable, [rules.invalid.length > 0, `${plural(rules.invalid.length, 'rule is', 'rules are')} not in the form "from -> to": ${rules.invalid.join('; ')}.`, f.analyses,
            'Correct the invalid rules in .code-map.json.'],
          [arch.unknown.length > 0, `Code-map cannot label ${plural(arch.unknown.length, 'ARCH-RULE finding')} as NEW or EXISTING: ${named(arch.unknown, findingName)}.`, ids(arch.unknown), f.list('unknown', 'ARCH-RULE')]],
          [`The head has no NEW ARCH-RULE finding under ${plural(rules.declared.length, 'declared rule')}.`, f.analyses])),
    item({ id: 'structure.imports-resolve', category: SI, title: 'New imports resolve', severity: 'high' },
      decide([[f.comparable && newBroken.length > 0, `The change adds ${plural(newBroken.length, 'import')} that the analysis cannot resolve: ${named(newBroken)}.`, newIds,
        added.length ? f.list('new', added[0].ruleId) : 'Correct each import that this check names, or add the file that it imports.']], [f.incomparable, f.unsupported, f.unchecked, ...importCases(f, imports, undecided)],
      ['The change adds no import that the analysis cannot resolve.', f.analyses])),
    item({ id: 'structure.no-new-cycle', category: SI, title: 'No new import cycle' },
      decide([[f.comparable && newCycles.length > 0, `The head has ${plural(newCycles.length, 'NEW value-import cycle')} that no cycle of the base contains: ${named(newCycles, findingName)}.`,
        ids(newCycles), f.list('new', 'CYCLE-VALUE')]],
      [f.incomparable, [cycles.unknown.length > 0, `Code-map cannot label ${plural(cycles.unknown.length, 'CYCLE-VALUE finding')} as NEW or EXISTING: ${named(cycles.unknown, findingName)}.`,
        ids(cycles.unknown), f.list('unknown', 'CYCLE-VALUE')]],
      [cycles.new.length ? `Each NEW value-import cycle lies inside a cycle of the base: ${named(cycles.new, findingName)}.` : 'The head has no NEW value-import cycle.',
        cycles.new.length ? ids(cycles.new) : f.analyses])),
  ];
  // For a feature, the consumer-contract check of the request takes the place of the type check. A bound compiler report makes it apply.
  const types = f.request.changeType === 'feature' ? null : typeCases(f);
  if (types) obligations.push(item({ id: 'structure.types-compatible', category: SI, title: 'Types are compatible', severity: 'high' }, f.context.typescript !== true && !types.applies
    ? outcome('NOT_APPLICABLE', 'The project has no TypeScript source file (.ts, .tsx, .mts or .cts) and the request gives no bound compiler report, so no compiler report applies.', f.analyses)
    : decide(...types.cases)));
  obligations.push(...requested.map((base) => open(base)));
  const changedSources = head.analysis.files.filter((file) => f.changed.has(file.path));
  // Only source files count: the analysis does not check the imports of test files.
  const analyzed = new Set([head, base].flatMap((side) => side.analysis.files.map((file) => file.path)));
  const opaque = changedSources.flatMap((file) => file.imports.filter((edge) => edge.mode === 'dynamic' || edge.specifier === null || edge.kind === 'unknown' || loaderSyntax.test(edge.specifier))
    .map((edge) => `import:${file.path}:${edge.line ?? '?'}`));
  const skipped = head.analysis.importNames?.skipped, skippedHere = skipped ? skipped.filter((entry) => f.changed.has(entry.source)) : null;
  const reaching = [...new Set(changedSources.flatMap((file) => [...(file.tests?.direct ?? []), ...(file.tests?.transitive ?? [])]))].sort();
  const unfiltered = f.heads.filter((report) => !report.filtered), touching = arch.all.filter((finding) => finding.paths.some((path) => f.changed.has(path)));
  return { obligations, input: category(SI, obligations, {
    fundamental: [predicate('si.new-architecture-break', f.comparable ? arch.new.length > 0 : null, ids(arch.new)), predicate('si.new-import-unresolved', f.comparable ? newBroken.length > 0 : null, newIds)],
    minimum: [[f.comparable, 'Comparable base and head analyses'], [f.change.paths.some((path) => analyzed.has(path)), 'At least one changed source file whose imports the analysis checks']],
    bands: { 3: [predicate('si.imports-classified', opaque.length || skippedHere?.length ? false : skippedHere === null ? null : true,
      [...opaque, ...(skippedHere ?? []).map((entry) => `import:${entry.source}:${entry.line ?? '?'}`)])],
    4: [predicate('si.rules-declared', rules.declared.length > 0, f.analyses), predicate('si.no-rule-finding-on-change', touching.length === 0, ids(touching)),
      predicate('si.reaching-tests-loaded', !reaching.length ? false : !unfiltered.length ? null : every(reaching.map((path) => fileState(unfiltered, path, notErrored))),
        [...reportIds(unfiltered), ...pathIds(reaching)])] } }) };
}

function coverage(f) {
  const heads = f.heads, unfiltered = heads.filter((report) => !report.filtered), count = heads.flatMap((report) => report.cases).filter(ran).length;
  const obligations = [item({ id: 'coverage.head-run', category: VC, title: 'A bound test run of the head exists' },
    decide([[heads.length > 0 && count === 0, `The ${plural(heads.length, 'bound head report')} ran no test case.`, reportIds(heads),
      'Run the tests of the changed code on the head without filters, and add the bound report to reportInputs in the request.']],
    [[heads.length === 0, 'No bound test report of the head exists.', f.analyses, f.noReport]], [`The bound head reports ran ${plural(count, 'test case')}.`, reportIds(heads)]))];
  const changedTests = (f.headTests?.testFiles ?? []).filter((file) => file.kind !== 'helper' && f.changed.has(file.path)).map((file) => file.path);
  const activeFiles = [...new Set((f.headTests?.cases ?? []).filter((entry) => entry.status === 'active' || entry.status === 'focused').map((entry) => entry.path))].sort();
  const ranFiles = (paths) => heads.length ? every(paths.map((path) => fileState(heads, path, ran))) : null;
  // `coverage` comes from the bound coverage reports of the head (changedCoverage) with at least one LCOV report, or is null. A changed file without an LCOV record makes both shares unmet.
  const measured = f.context.coverage ?? null, missing = measured?.unmeasured ?? [], shareIds = [...(measured?.reports ?? []).map((path) => `report:${path}`), ...pathIds(missing)];
  const share = (part, threshold) => missing.length ? false : part && part.total > 0 ? part.covered * 100 >= threshold * part.total : null;
  const codeTouched = f.change.paths.some((path) => isCode(path) && !isTest(path));
  return { obligations, input: category(VC, obligations, {
    fundamental: [predicate('vc.unfiltered-run-ran-nothing', unfiltered.length ? codeTouched && unfiltered.every((report) => !report.cases.some(ran)) : null, reportIds(unfiltered))],
    minimum: [[heads.length > 0, 'A bound test report of the head'], [measured !== null, 'A bound line-coverage report of the head']],
    bands: { 3: [predicate('vc.changed-test-files-ran', ranFiles(changedTests), pathIds(changedTests)), predicate(`vc.changed-lines-${thresholds.changedLines}`, share(measured?.changedLines, thresholds.changedLines), shareIds)],
      4: [predicate('vc.active-test-files-ran', ranFiles(activeFiles), pathIds(activeFiles)), predicate(`vc.changed-branches-${thresholds.changedBranches}`, share(measured?.changedBranches, thresholds.changedBranches), shareIds)] } }) };
}

function behavior(f, requested) {
  const heads = f.heads, failures = runFailures(f);
  const fresh = failures.filter((entry) => !entry.old), old = failures.filter((entry) => entry.old);
  const silent = heads.filter((report) => report.exitStatus !== 0 && !report.cases.some(failed)), caseIds = (list) => list.map((entry) => `case:${entry.artifact}:${entry.name}`);
  const noHead = [heads.length === 0, 'No bound test report of the head exists.', f.analyses, f.noReport];
  const obligations = [
    item({ id: 'behavior.no-new-failures', category: BC, title: 'No new test failures', required: false, blocking: true, severity: 'high' },
      decide([[fresh.length > 0, `The head reports have ${plural(fresh.length, 'failed case')} that no base report of the same command, tools and environment has: ${named(fresh, (entry) => entry.name)}.`,
        caseIds(fresh), `Read the failed cases in ${named([...new Set(fresh.map((entry) => entry.artifact))])}, and correct the code or the test.`]],
      [noHead, [silent.length > 0, `${plural(silent.length, 'head run')} did not end with exit status 0 and ${silent.length === 1 ? 'has' : 'have'} no failed case: ${named(silent, (report) => `${report.artifact} (exit status ${report.exitStatus ?? 'not recorded'})`)}.`,
        reportIds(silent), 'Read the output of the test run: a test file can fail before its cases run.']],
      ['The bound head reports have no new failed case.', reportIds(heads)])),
    item({ id: 'behavior.earlier-failures', category: BC, title: 'Earlier failures', required: false, severity: 'low' },
      decide([[old.length > 0, `${plural(old.length, 'failed case')} also failed in the base report of the same run: ${named(old, (entry) => entry.name)}.`, caseIds(old),
        'Correct these earlier failures in a separate change.']],
      [noHead, [failures.some((entry) => !entry.compared), 'A failed case of the head has no base report of the same command, tools and environment, so Code-map cannot tell whether it failed before.',
        caseIds(failures.filter((entry) => !entry.compared)), "Add a bound base report of the same test command to reportInputs in the request. Refer to docs/verify.md, section 'Bound test reports'."]],
      ['No failed case of the head also failed in the base.', reportIds(heads)])),
    ...requested.map((base) => open(base)),
  ];
  const noNew = obligations[0].result;
  return { obligations, input: category(BC, obligations, { fundamental: [],
    minimum: [[heads.length > 0, 'A bound test report of the head'], [false, 'A record that a person or another trusted source confirmed the expected results of the tests (v0 has no such record)']],
    bands: { 3: [predicate('bc.no-new-failures', noNew === 'PASS' ? true : noNew === 'FAIL' ? false : null, obligations[0].evidenceIds)] } }) };
}

function completeness(f, requested) {
  const { change, request } = f, allowed = request.allowedPaths;
  const outside = allowed === null ? [] : change.paths.filter((path) => !allowed.some((glob) => matchesGlob(path, glob)));
  const nothing = [change.paths.length === 0, 'Nothing changed between the base and the head.', f.analyses, 'Select a head that differs from the base.'];
  const imports = f.findings(importRules), lost = imports.new.filter((finding) => f.origin(finding) === 'lost-consumer'), undecided = imports.new.filter((finding) => f.origin(finding) === 'undecided');
  const lostAll = [...lost.map(findingName), ...f.lostAlias.map(edgeName)], lostIds = [...ids(lost), ...edgeIds(f.lostAlias)];
  const focused = f.findings(['TEST-FOCUSED']), weak = f.findings(weakRules).unknown.filter((finding) => finding.paths.some((path) => f.changed.has(path)));
  const { removed = [], weakened = [] } = f.context.weakening ?? {}, settings = (f.context.settingsFiles ?? []).filter((path) => f.changed.has(path));
  const testScan = [!f.headTests || !f.baseTests, 'The test scan of the base or the head is missing, so Code-map cannot compare their test cases.', f.analyses,
    'Analyze both snapshots again with the current Code-map version.'];
  const unreadable = [f.unreadable.length > 0, `Code-map cannot read ${plural(f.unreadable.length, 'changed test file')}: ${named(f.unreadable)}.`, pathIds(f.unreadable),
    'Examine these test files without Code-map: the scan reads only JavaScript and TypeScript tests.'];
  const scope = (base) => item({ ...base, title: requestTitles[base.id] },
    decide([[outside.length > 0, `${plural(outside.length, 'changed path matches', 'changed paths match')} none of the allowed paths: ${named(outside)}.`, pathIds(outside),
      'Remove the changes outside the allowed paths, or add their paths to allowedPaths in the request.']],
    [nothing], [`Each of the ${plural(change.paths.length, 'changed path')} matches an allowed path.`, pathIds(change.paths)]));
  const obligations = [
    ...requested.map((base) => base.id === 'scope.allowed-paths' ? scope(base) : open(base)),
    item({ id: 'completeness.consumers-updated', category: CC, title: 'Consumers are updated', severity: 'high' },
      decide([[f.comparable && lostAll.length > 0, `${plural(lostAll.length, 'import')} that resolved in the base ${lostAll.length === 1 ? 'is' : 'are'} broken in the head: ${named(lostAll)}.`,
        lostIds, lost.length ? f.list('new', lost[0].ruleId) : 'Correct each import that this check names, or restore the file that it imported.']],
      [f.incomparable, f.unsupported, f.unchecked, ...importCases(f, imports, undecided), f.orphaned, f.hidden],
      ['No import that resolved in the base is broken in the head.', f.analyses])),
    item({ id: 'completeness.no-focused-test', category: CC, title: 'No new focused test', blocking: true, severity: 'high' },
      decide([[f.comparable && focused.new.length > 0, `The head has ${plural(focused.new.length, 'NEW TEST-FOCUSED finding')} (a test with .only): ${named(focused.new, findingName)}.`,
        ids(focused.new), f.list('new', 'TEST-FOCUSED')]],
      [f.incomparable, testScan, unreadable, [focused.unknown.length > 0, `Code-map cannot label ${plural(focused.unknown.length, 'TEST-FOCUSED finding')} as NEW or EXISTING: ${named(focused.unknown, findingName)}.`,
        ids(focused.unknown), f.list('unknown', 'TEST-FOCUSED')]],
      ['The head has no NEW TEST-FOCUSED finding.', f.analyses])),
    item({ id: 'completeness.tests-not-weakened', category: CC, title: 'Tests are not weakened', severity: 'high' },
      decide([[f.comparable && weakened.length > 0, `${plural(weakened.length, 'test case')} of the base ${weakened.length === 1 ? 'is' : 'are'} weaker in the head: ${named(weakened, (entry) => `${entry.findingId} (${entry.path} > ${entry.name})`)}.`,
        weakened.map((entry) => entry.findingId), f.list('new', weakened[0]?.ruleId ?? weakRules[0])],
      [f.comparable && change.complete && removed.length > 0, `${plural(removed.length, 'active test case')} of the base ${removed.length === 1 ? 'is' : 'are'} not in the head: ${named(removed, caseName)}.`,
        removed.map((entry) => `case:${caseName(entry)}`), 'Restore the removed test cases, or ask a reviewer to accept the removal.']],
      [f.incomparable, testScan, unreadable, [!change.complete, 'Git did not look for every rename in this change, so a moved test case can look removed.', f.analyses,
        'Increase the Git setting diff.renameLimit, then run code-map verify again.'],
      [weak.length > 0, `Code-map cannot label ${plural(weak.length, 'test finding')} of the changed files as NEW or EXISTING: ${named(weak, findingName)}.`, ids(weak), f.list('unknown', weak[0]?.ruleId ?? weakRules[0])]],
      ['No active test case of the base is gone or weaker in the head.', f.analyses])),
    item({ id: 'completeness.settings-unchanged', category: CC, title: 'Code-map settings are unchanged' },
      decide([[settings.length > 0, `The change edits ${named(settings)}. Both analyses read the current settings, so a relaxed rule can hide a break.`, pathIds(settings),
        'Make the settings change in a separate change, and verify the code change without it.']],
      [nothing], [`The change edits none of ${named(f.context.settingsFiles ?? [])}.`, f.analyses])),
    item({ id: 'completeness.migrations-docs', category: CC, title: 'Migrations and documentation are updated', required: false, severity: 'low' },
      outcome('UNKNOWN', 'No check of static-baseline-v0 can find a missing migration or documentation update. A record that a reviewer checked them would close this check, but this version has no such record.',
        f.analyses, 'Ask a reviewer to confirm that the change updates each migration and each document that it needs.')),
  ];
  const outsideFiles = f.head.analysis.files.filter((file) => !f.changed.has(file.path));
  const computed = outsideFiles.filter((file) => file.imports.some((edge) => edge.specifier === null && edge.target === null)).map((file) => file.path);
  const skipped = f.head.analysis.importNames?.skipped, skippedInto = skipped ? skipped.filter((entry) => f.changed.has(entry.target) && !f.changed.has(entry.source)) : null;
  return { obligations, input: category(CC, obligations, {
    fundamental: [predicate('cc.consumer-lost-target', f.comparable ? lostAll.length > 0 : null, lostIds)],
    minimum: [[allowed !== null, 'Allowed paths in the request'], [f.comparable, 'Comparable base and head analyses'], [change.paths.length > 0, 'At least one changed file'],
      [Boolean(f.headTests && f.baseTests), 'The test cases of both snapshots']],
    // A computed dynamic import has no known target, so it can import a changed file: the predicate is then unknown.
    bands: { 3: [predicate('cc.no-hidden-importers', skippedInto === null ? null : skippedInto.length ? false : computed.length ? null : true,
      [...(skippedInto ?? []).map((entry) => `import:${entry.source}:${entry.line ?? '?'}`), ...pathIds(computed)])] } }) };
}

/** The obligations and the rating input of each category for one verification context (refer to the module header). */
export function evaluateProfile(context) {
  const f = factsOf(context), requested = requiredObligationsFor(context.request), own = (name) => requested.filter((base) => base.category === name);
  const parts = [structural(f, own(SI)), coverage(f), behavior(f, own(BC)), completeness(f, own(CC))];
  return { obligations: parts.flatMap((part) => part.obligations), categories: Object.fromEntries(parts.map((part) => [part.input.category, part.input])) };
}
