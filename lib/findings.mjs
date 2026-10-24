// Findings: one addressable item for each static lead in an analysis, with its rule, evidence kind and capability.
// An ID comes from the rule and the semantic location (paths and names), never from line numbers, so it survives moves.
// Findings are investigation leads. None of them is an executed check or a verification result.
import { migrationFindings } from './migrations.mjs';
import { createHash } from 'node:crypto';
import { openapiFindings } from './contracts/openapi-report.mjs';
import { electronIpcFindings } from './frameworks/electron-ipc-report.mjs';
import { envFindings } from './frameworks/env-report.mjs';
import { electronFindings } from './frameworks/electron.mjs';
import { nextFindings } from './frameworks/next-findings.mjs';
import { supplyFindings } from './supply/policy.mjs';
import { patternFindings } from './patterns.mjs';
import { packageFindings } from './packages/findings.mjs';

const severities = ['high', 'medium', 'low'];
const rule = (severity, source, capability, title) => ({ severity, source, capability, title });

/** Registry order is the priority inside one severity. `source` is the evidence kind; `capability` is the spec's C-number. */
export const findingRules = {
  'ARCH-RULE': rule('high', 'graph', 'C06', 'An import breaks an architecture rule'),
  'IMPORT-NAME-MISSING': rule('high', 'graph', 'C02', 'A file imports a name that the imported file does not export'),
  'TEST-FOCUSED': rule('high', 'inventory', 'C10', 'A test case is focused with .only'),
  'TEST-EXIT-NOT-RUN': rule('high', 'measured', 'C12', 'A measured failure exit never ran'),
  'TEST-NO-FAILURE-ASSERTION': rule('high', 'inferred', 'C09', 'Tests reach a function with failure exits, but no failure assertion is tied to it'),
  'TEST-EXPORT-CANDIDATE': rule('low', 'inferred', 'C09', 'An exported function has no static test relationship'),
  'TEST-UNREACHED': rule('high', 'inferred', 'C09', 'No test reaches a function with failure exits'),
  'DEPENDENCY-LICENSE': rule('high', 'inventory', 'C34', 'A package has a license that the supply-chain policy denies or does not allow'),
  'DEPENDENCY-HOST': rule('high', 'inventory', 'C34', 'A package comes from a host that the supply-chain policy does not allow'),
  'IMPORT-UNRESOLVED': rule('medium', 'graph', 'C01', 'A relative import matches no file in the snapshot'),
  'OWNER-CROSS-IMPORT': rule('medium', 'graph', 'C31', 'A file imports a file without a common owner, and the ownership setting forbids it'),
  // Package rules read dependency declarations and installed metadata. Refer to lib/packages/ and lib/python/.
  'PACKAGE-UNDECLARED': rule('medium', 'graph', 'C01', 'A file imports a package that its dependency declarations do not name'),
  'PACKAGE-UNRESOLVED': rule('medium', 'graph', 'C01', 'A declared package that a file imports has no folder in node_modules'),
  'PACKAGE-SUBPATH-NOT-EXPORTED': rule('medium', 'graph', 'C01', 'A file imports a subpath that the exports field of the package does not export'),
  'CYCLE-VALUE': rule('medium', 'graph', 'C05', 'Files import each other through value imports'),
  'FIX-WITHOUT-TEST': rule('medium', 'git', 'C27', 'A bug-fix commit changed no test file'),
  'TEST-NO-ASSERTIONS': rule('medium', 'pattern', 'C27', 'A running test case has no assertion that the scan can find'),
  'TEST-UNRECOGNIZED-FILE': rule('medium', 'inventory', 'C40', 'A file named as a test has no recognized test case'),
  'DEPENDENCY-NO-INTEGRITY': rule('medium', 'inventory', 'C34', 'A downloaded package has no integrity value in the lockfile'),
  'SYNTAX-ERROR': rule('medium', 'inventory', 'C40', 'The parser reports a syntax error in a file, so its facts can be incomplete'),
  'RETRY-POLICY': rule('medium', 'pattern', 'C35', 'A declared retry call has no bounded attempt limit'),
  'LOGGING-POLICY': rule('medium', 'pattern', 'C35', 'A catch block violates a declared logging policy'),
  'EFFECT-NO-CLEANUP': rule('medium', 'pattern', 'C35', 'A React effect subscribes but returns no cleanup function'),
  'INTERVAL-NOT-CLEARED': rule('medium', 'pattern', 'C35', 'An interval that keeps no handle, or that the file never clears'),
  'CYCLE-ALL': rule('low', 'graph', 'C05', 'Files import each other only when type-only imports count'),
  'SHARED-TYPE': rule('low', 'graph', 'C30', 'Consumers import a type from a parent that imports them'),
  'EXPORT-UNREFERENCED': rule('low', 'graph', 'C32', 'An exported name that no importer uses'),
  'EXPORT-TEST-ONLY': rule('low', 'graph', 'C32', 'An exported name that only tests use'),
  'FILE-ORPHANED': rule('low', 'graph', 'C32', 'A source file that no file imports and that is not an entry point'),
  'PACKAGE-UNUSED': rule('low', 'graph', 'C32', 'A package in dependencies that no code file imports'),
  'PACKAGE-DEV-ONLY': rule('low', 'graph', 'C01', 'A production file imports a package declared only for development'),
  'TEST-SWALLOWED-ERROR': rule('low', 'pattern', 'C27', 'A test case catches an error around an assertion and ignores it'),
  'TEST-FIXED-WAIT': rule('low', 'pattern', 'C27', 'A test case waits for a fixed time'),
  'TEST-PARKED': rule('low', 'inventory', 'C10', 'A test case is skipped, todo or conditional'),
  'TEST-LAYER-MISMATCH': rule('low', 'pattern', 'C10', 'A test in a unit-test folder uses a process, the network, a database or a browser'),
  'TEST-UNREADABLE-FILE': rule('low', 'inventory', 'C40', 'A test script that the scan cannot read'),
  'ELECTRON-IPC-NO-HANDLER': rule('high', 'contract', 'C26', 'A page IPC channel has no main handler'),
  'ELECTRON-IPC-KIND-MISMATCH': rule('high', 'contract', 'C26', 'An IPC caller and handler use incompatible kinds'),
  'ELECTRON-IPC-NO-LISTENER': rule('medium', 'contract', 'C26', 'A main IPC channel has no page listener'),
  'ELECTRON-IPC-UNUSED-HANDLER': rule('low', 'contract', 'C26', 'An IPC handler has no mapped caller'),
  'ELECTRON-UNSAFE-WEB-PREFERENCES': rule('high', 'pattern', 'C26', 'An Electron window uses an unsafe web preference'),
  'ELECTRON-NO-PERMISSION-HANDLER': rule('low', 'pattern', 'C26', 'Electron windows have no main-process permission request handler'),
  'ELECTRON-OPEN-EXTERNAL-UNCHECKED': rule('low', 'pattern', 'C26', 'shell.openExternal receives a non-literal URL'),
  // Next.js rules: they apply only when a package.json lists next. Refer to lib/frameworks/nextjs.mjs.
  'NEXT-CLIENT-API-IN-SERVER': rule('high', 'graph', 'C26', 'A server module uses a React client hook or an event handler'),
  'NEXT-SERVER-IMPORT-IN-CLIENT': rule('high', 'graph', 'C26', 'A client module imports server-only code or a Node.js built-in module'),
  'NEXT-POLYFILLED-BUILTIN-IN-CLIENT': rule('low', 'graph', 'C26', 'A client module imports a Node.js built-in that Next.js replaces with a browser version'),
  'NEXT-USE-SERVER-EXPORT': rule('high', 'pattern', 'C26', "A 'use server' file exports a value that is not an async function"),
  'NEXT-CLIENT-PRIVATE-ENV': rule('medium', 'graph', 'C26', 'A client module reads an environment variable that the browser does not get'),
  'FETCH-NO-SIGNAL': rule('low', 'pattern', 'C35', 'A fetch call passes no signal, so it has no timeout and no cancellation'),
  'CATCH-EMPTY': rule('low', 'pattern', 'C35', 'An empty catch block with no comment ignores every error'),
  // Environment and contract rules: they compare the code with a template file or an OpenAPI document. Refer to
  // lib/frameworks/env.mjs and lib/contracts/openapi.mjs.
  'ENV-UNDECLARED': rule('medium', 'contract', 'C26', 'A code file reads an environment variable that no template file of its package declares'),
  'OPENAPI-NO-HANDLER': rule('medium', 'contract', 'C20', 'An OpenAPI document describes an operation that no route handler handles'),
  'ENV-UNUSED': rule('low', 'contract', 'C26', 'A template file declares an environment variable that no code reads'),
  'OPENAPI-PARAM-NAME': rule('low', 'contract', 'C20', 'An OpenAPI path parameter has another name in the route'),
  'MIGRATION-USE': rule('low', 'pattern', 'C25', 'A configured migration still has a use'),
  'OPENAPI-UNDOCUMENTED-METHOD': rule('low', 'contract', 'C20', 'A route handler exports a method that the OpenAPI document does not describe'),
};
const order = Object.keys(findingRules);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const at = (path, line, text) => ({ path, line: line ?? null, text });

/** The fingerprint of a finding: a hash of its rule and its identity key (paths and names, never line numbers). */
export const fingerprintOf = (ruleId, key) => createHash('sha256').update(JSON.stringify([ruleId, ...key])).digest('hex').slice(0, 16);

/** Every finding of an analysis, highest severity first. The same analysis always gives the same list. */
export function deriveFindings(analysis) {
  const found = new Map(), add = (ruleId, key, finding) => {
    const fingerprint = fingerprintOf(ruleId, key);
    let id = `${ruleId}-${fingerprint.slice(0, 10)}`;
    if (found.has(id) && found.get(id).fingerprint === fingerprint) return; // the same lead twice, for example one import on two lines
    if (found.has(id)) id = `${ruleId}-${fingerprint}`;
    // `key` stays with the finding, so a comparison can map its paths through renames and hash it again.
    found.set(id, { id, ruleId, fingerprint, key, ...findingRules[ruleId], ...finding, weight: finding.weight ?? 0 });
  };
  // A layer break (lib/layers.mjs) has the same identity key as a text rule. Only its text and its facts tell the layers.
  for (const item of analysis.rules?.violations ?? []) add('ARCH-RULE', [item.rule, item.from, item.to], {
    text: item.layers ? `${item.from} in the layer "${item.layers.from}" imports ${item.to} in the higher layer "${item.layers.to}". The rule "${item.rule}" forbids it.`
      : `${item.from} imports ${item.to}, which the rule "${item.rule}" forbids.`, location: { path: item.from, line: item.lines[0] ?? null, symbol: null },
    paths: [item.from, item.to], evidence: (item.lines.length ? item.lines : [null]).slice(0, 3).map((line) => at(item.from, line, `imports ${item.to}`)),
    facts: { rule: item.rule, from: item.from, to: item.to, ...(item.layers ? { layers: item.layers } : {}) } });
  for (const item of analysis.ownership?.violations ?? []) add('OWNER-CROSS-IMPORT', [item.from, item.to], {
    text: `${item.from} (owned by ${item.owners.from.join(', ')}) imports ${item.to} (owned by ${item.owners.to.join(', ')}). The ownership setting in .code-map.json forbids an import between files without a common owner.`,
    location: { path: item.from, line: item.lines[0] ?? null, symbol: null }, paths: [item.from, item.to],
    evidence: (item.lines.length ? item.lines : [null]).slice(0, 3).map((line) => at(item.from, line, `imports ${item.to}`)), facts: { from: item.from, to: item.to, owners: item.owners } });
  for (const item of analysis.importNames?.missing ?? []) add('IMPORT-NAME-MISSING', [item.source, item.target, item.name], {
    text: `${item.source} imports ${item.name} from ${item.target}, but ${item.target} does not export it. A consumer that a rename or a removal left behind gives this.`,
    location: { path: item.source, line: item.line, symbol: item.name }, paths: [item.source, item.target],
    evidence: [at(item.source, item.line, `imports ${item.name} from ${item.target}`)], facts: { source: item.source, target: item.target, name: item.name, kind: item.kind, mode: item.mode } });
  for (const file of [...analysis.files, ...(analysis.importFiles ?? [])]) {
    const missing = file.imports.filter((edge) => edge.target === null && typeof edge.specifier === 'string' && (edge.unresolvedLocal || !file.path.endsWith('.py') && edge.specifier.startsWith('.')) && !/[?!]/.test(edge.specifier));
    for (const specifier of [...new Set(missing.map((edge) => edge.specifier))]) {
      const edges = missing.filter((edge) => edge.specifier === specifier);
      add('IMPORT-UNRESOLVED', [file.path, specifier], { text: `${file.path} imports "${specifier}", but no file in the snapshot matches it. A generated or ignored file can explain it.`,
        location: { path: file.path, line: edges[0].line, symbol: null, ...(edges[0].specifierSpan ?? {}) }, paths: [file.path], evidence: edges.slice(0, 3).map((edge) => at(file.path, edge.line, `imports "${specifier}"`)),
        facts: { specifier, kind: edges[0].kind, mode: edges[0].mode } });
    }
    for (const item of file.exports ?? []) {
      if (item.usage !== 'unreferenced' && item.usage !== 'test-only') continue;
      const unreferenced = item.usage === 'unreferenced';
      add(unreferenced ? 'EXPORT-UNREFERENCED' : 'EXPORT-TEST-ONLY', [file.path, item.name, item.category], {
        text: unreferenced ? `${file.path} exports ${item.name}. ${plural(file.importers.length, 'source file imports', 'source files import')} the file, but no importer uses this name. Local use, dynamic wiring or an external consumer can still need it.`
          : `Only tests import ${item.name} from ${file.path}.`,
        location: { path: file.path, line: item.line ?? null, symbol: item.name }, paths: [file.path],
        evidence: [at(file.path, item.line, `${item.category} export ${item.name}`), ...item.consumers.slice(0, 2).map((path) => at(path, null, `imports ${item.name}`))], facts: { name: item.name, category: item.category } });
    }
  }
  const valueGroups = new Set(analysis.cycles.value.map((group) => group.files.join('\n')));
  for (const [ruleId, groups] of [['CYCLE-VALUE', analysis.cycles.value], ['CYCLE-ALL', analysis.cycles.all.filter((group) => !valueGroups.has(group.files.join('\n')))]]) {
    for (const group of groups) {
      const first = group.edges.find((edge) => edge.source === group.files[0]) ?? group.edges[0];
      add(ruleId, group.files, { text: `${plural(group.files.length, 'file')} import each other ${ruleId === 'CYCLE-VALUE' ? 'through value or side-effect imports' : 'when type-only imports count; their value imports alone do not form this loop'}. A loop of possible dependencies does not prove a run-time initialization problem.`,
        location: { path: group.files[0], line: first?.line ?? null, symbol: null }, paths: group.files, weight: group.files.length,
        evidence: group.edges.slice(0, 3).map((edge) => at(edge.source, edge.line, `imports ${edge.target}`)), facts: { files: group.files.length, edges: group.edges.length } });
    }
  }
  for (const item of analysis.sharedTypes) add('SHARED-TYPE', [item.owner, item.name], {
    text: `${plural(item.consumers.length, 'file imports', 'files import')} the type ${item.name} from ${item.owner}, which imports ${item.consumers.length === 1 ? 'that file' : 'them'} as values. Moving the type to its own file can remove the loop.`,
    location: { path: item.owner, line: item.line ?? null, symbol: item.name }, paths: [item.owner, ...item.consumers.map((consumer) => consumer.path)],
    evidence: item.consumers.slice(0, 3).map((consumer) => at(consumer.path, consumer.line, `imports type ${item.name}`)), facts: { name: item.name, consumers: item.consumers.length } });
  migrationFindings(analysis, add);
  testFindings(analysis.tests, add, new Set(analysis.files.filter((file) => file.vendorCandidate).map((file) => file.path)));
  nextFindings(analysis, add);
  electronFindings(analysis, add);
  supplyFindings(analysis.supply, add);
  patternFindings(analysis, add);
  envFindings(analysis, add);
  electronIpcFindings(analysis, add);
  openapiFindings(analysis, add);
  packageFindings(analysis, add);
  return [...found.values()].sort((a, b) => severities.indexOf(a.severity) - severities.indexOf(b.severity) || order.indexOf(a.ruleId) - order.indexOf(b.ruleId)
    || b.weight - a.weight || a.location.path.localeCompare(b.location.path) || (a.location.line ?? 0) - (b.location.line ?? 0) || a.id.localeCompare(b.id));
}

/** `vendors`: the paths of copied UI library files (vendor candidates, such as components/ui), which are not the team's code to unit test. */
function testFindings(tests, add, vendors) {
  if (!tests) return;
  const caseAt = (item) => at(item.path, item.line, item.suite ? `${item.suite} > ${item.name}` : item.name);
  for (const unit of tests.units) {
    if (!unit.exits.length) continue;
    const reach = unit.direct.length + unit.via, location = { path: unit.path, line: unit.line, symbol: unit.name };
    const exits = unit.exits.slice(0, 3).map((exit) => at(unit.path, exit.line, `failure exit: ${exit.kind}`));
    const facts = { unit: unit.key, exits: unit.exits.length, reachingTests: reach, candidates: unit.candidates }, weight = unit.exits.length * (1 + unit.affects) + (unit.exported ? 0.5 : 0);
    if (unit.status === 'no-failure-assertion' || unit.status === 'unreached') {
      add(unit.status === 'unreached' ? 'TEST-UNREACHED' : 'TEST-NO-FAILURE-ASSERTION', [unit.key], { location, paths: [unit.path], weight, facts, evidence: exits,
        text: `${unit.name} has ${plural(unit.exits.length, 'failure exit')}. ${reach === 0 ? 'No test reaches it.' : `${plural(reach, 'test reaches', 'tests reach')} it, with no failure assertion tied to it.`} A custom assertion helper can hide one.` });
    }
    const notRan = unit.exits.filter((exit) => exit.hits === 0);
    if (notRan.length) add('TEST-EXIT-NOT-RUN', [unit.key], { location, paths: [unit.path], weight, facts: { ...facts, notRan: notRan.length },
      evidence: notRan.slice(0, 3).map((exit) => at(unit.path, exit.line, `never ran: ${exit.kind}`)),
      text: `${plural(notRan.length, 'failure exit')} of ${unit.name} never ran in the coverage run. The coverage report is not tied to a revision.` });
  }
  for (const item of tests.exportedFunctions ?? []) {
    if (item.relationship !== 'candidate' || vendors.has(item.path)) continue;
    add('TEST-EXPORT-CANDIDATE', [item.key], { location: { path: item.path, line: item.line, symbol: item.name },
      paths: [item.path], facts: { names: item.names, runtime: item.runtime, reason: item.reason },
      evidence: [at(item.path, item.line, item.names.join(', '))],
      text: `${item.names.join(', ')} has no static test relationship. This is a candidate. Runtime hits are unknown.` });
  }
  const seen = new Map();
  for (const item of tests.cases) {
    const name = `${item.path}\n${item.suite ?? ''}\n${item.name}`, ordinal = seen.get(name) ?? 0;
    seen.set(name, ordinal + 1);
    const base = { location: { path: item.path, line: item.line, symbol: item.name }, paths: [item.path], caseIds: [item.id], evidence: [caseAt(item)], facts: { status: item.status, type: item.type } };
    const key = [item.path, item.suite ?? '', item.name, ordinal], running = item.status !== 'skipped' && item.status !== 'todo';
    if (item.status === 'focused') add('TEST-FOCUSED', key, { ...base, text: `"${item.name}" is focused with .only. The runner can skip every other test while the focus is in place.` });
    if (item.smells.includes('no-assertions')) add('TEST-NO-ASSERTIONS', key, { ...base, text: `"${item.name}" runs but has no assertion that the scan can find. A custom helper or a rejected promise can still make it fail.` });
    if (running && item.smells.includes('swallowed-error')) add('TEST-SWALLOWED-ERROR', key, { ...base, text: `"${item.name}" catches an error around an assertion and does nothing with it.` });
    if (running && item.smells.includes('fixed-wait')) add('TEST-FIXED-WAIT', key, { ...base, text: `"${item.name}" waits for a fixed time, which makes it slow and can make it flaky.` });
    if (['skipped', 'todo', 'conditional'].includes(item.status)) add('TEST-PARKED', key, { ...base, text: `"${item.name}" is ${item.status}. It is inventory, not evidence.` });
  }
  for (const file of tests.testFiles) {
    const facts = { framework: file.framework, kind: file.kind, type: file.type }, location = { path: file.path, line: null, symbol: null };
    if (file.kind === 'unrecognized') add('TEST-UNRECOGNIZED-FILE', [file.path], { location, paths: [file.path], facts, evidence: [at(file.path, null, file.path)],
      text: `${file.path} is named as a test, but the scan found no test case in it. The test counts do not include it.` });
    if (file.mismatch) add('TEST-LAYER-MISMATCH', [file.path], { location, paths: [file.path], facts: { ...facts, effects: file.effects }, evidence: [at(file.path, null, file.effects.join(', '))],
      text: `${file.path} is in a unit-test folder but uses ${file.effects.join(', ')}.` });
  }
  for (const path of tests.unreadable) add('TEST-UNREADABLE-FILE', [path], { location: { path, line: null, symbol: null }, paths: [path], facts: {}, evidence: [at(path, null, path)],
    text: `${path} is a test script that the scan cannot read. The test counts do not include it.` });
  for (const commit of tests.fixCommits?.commits ?? []) {
    if (commit.tests.length) continue;
    add('FIX-WITHOUT-TEST', [commit.sha], { location: { path: commit.sources[0], line: null, symbol: null }, paths: commit.sources, facts: { sha: commit.sha, date: commit.date, subject: commit.subject },
      evidence: commit.sources.slice(0, 3).map((path) => at(path, null, `${commit.sha.slice(0, 7)} ${commit.subject}`)),
      text: `Commit ${commit.sha.slice(0, 7)} ("${commit.subject}") looks like a bug fix and changed no test file. A regression test in a later commit is not linked to it.` });
  }
}

/** The findings that a summary shows inline: highest priority first, at most `perRule` of each rule and `max` in total. */
export function summaryItems(findings, { max = 20, perRule = 5 } = {}) {
  const counts = new Map(), shown = [];
  for (const item of findings) {
    if (shown.length === max) break;
    if ((counts.get(item.ruleId) ?? 0) === perRule) continue;
    counts.set(item.ruleId, (counts.get(item.ruleId) ?? 0) + 1);
    shown.push(item);
  }
  return shown;
}
