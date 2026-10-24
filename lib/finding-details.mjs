// The evidence behind one finding, read from the stored analysis. Lists come back as pages; `parts` holds each complete
// list, so a caller can page through all of it. Pure: `pager(name, list)` makes the first page, `fileCommand(path)` a command.
import { openapiFindingDetails } from './contracts/openapi-report.mjs';
import { envFindingDetails } from './frameworks/env-report.mjs';
import { nextFindingDetails } from './frameworks/next-findings.mjs';
import { packageFindingDetails, packageRules } from './packages/findings.mjs';

export function findingDetails(analysis, finding, pager, fileCommand) {
  const parts = {}, part = (name, list) => { parts[name] = list; return pager(name, list); };
  const fileOf = (path) => [...analysis.files, ...(analysis.importFiles ?? [])].find((entry) => entry.path === path);
  const sourceCommand = (path) => analysis.files.some((file) => file.path === path) ? fileCommand(path) : null;
  const tests = analysis.tests;
  const caseOf = (id) => { const item = tests.cases[id]; return { id, path: item.path, name: item.name, suite: item.suite, line: item.line, status: item.status, type: item.type, assertions: item.assertions, failures: item.failures }; };
  const testFileOf = (path) => { const file = tests.testFiles.find((entry) => entry.path === path); return file ? { path, kind: file.kind, framework: file.framework, type: file.type, declared: file.declared, inferred: file.inferred, effects: file.effects } : { path }; };
  const { path } = finding.location, facts = finding.facts;
  switch (finding.ruleId) {
    case 'ARCH-RULE': {
      const violation = analysis.rules.violations.find((item) => item.rule === facts.rule && item.from === facts.from && item.to === facts.to);
      return { details: { violation, files: { from: fileCommand(facts.from), to: fileCommand(facts.to) } }, parts };
    }
    case 'OWNER-CROSS-IMPORT': {
      const violation = analysis.ownership.violations.find((item) => item.from === facts.from && item.to === facts.to);
      return { details: { violation, files: { from: fileCommand(facts.from), to: fileCommand(facts.to) } }, parts };
    }
    case 'IMPORT-NAME-MISSING': {
      const source = fileOf(facts.source), target = fileOf(facts.target);
      const lines = source ? source.imports.filter((edge) => edge.target === facts.target && [...edge.typeNames, ...edge.valueNames].includes(facts.name)).map((edge) => edge.line) : [finding.location.line];
      return { details: { import: { source: facts.source, target: facts.target, name: facts.name, lines, kind: facts.kind, mode: facts.mode },
        exports: part('exports', (target?.exports ?? []).map((item) => item.name)),
        note: 'The export list shows the names that the target file declares or re-exports by name. The check also follows its export-star re-exports of local files.',
        files: { source: sourceCommand(facts.source), target: sourceCommand(facts.target) } }, parts };
    }
    case 'IMPORT-UNRESOLVED': {
      const edges = fileOf(path).imports.filter((edge) => edge.target === null && edge.specifier === facts.specifier);
      return { details: { import: { path, specifier: facts.specifier, lines: edges.map((edge) => edge.line), kind: facts.kind, mode: facts.mode }, file: sourceCommand(path) }, parts };
    }
    case 'CYCLE-VALUE': case 'CYCLE-ALL': {
      const group = analysis.cycles[finding.ruleId === 'CYCLE-VALUE' ? 'value' : 'all'].find((entry) => entry.files.join('\n') === finding.paths.join('\n'));
      const edges = group.edges.map(({ source, target, line, specifier, kind, mode }) => ({ source, target, line, specifier, kind, mode }));
      return { details: { files: part('files', group.files), edges: part('edges', edges) }, parts };
    }
    case 'SHARED-TYPE': {
      const item = analysis.sharedTypes.find((entry) => entry.owner === path && entry.name === facts.name);
      return { details: { type: { owner: item.owner, name: item.name, line: item.line }, consumers: part('consumers', item.consumers), file: fileCommand(path) }, parts };
    }
    case 'EXPORT-UNREFERENCED': case 'EXPORT-TEST-ONLY': {
      const file = fileOf(path), item = file.exports.find((entry) => entry.name === facts.name && entry.category === facts.category);
      return { details: { export: { path, name: item.name, category: item.category, usage: item.usage, line: item.line ?? null, localReferences: item.localReferences ?? null },
        consumers: part('consumers', item.consumers), importers: part('importers', file.importers), file: fileCommand(path) }, parts };
    }
    case 'TEST-NO-FAILURE-ASSERTION': case 'TEST-UNREACHED': case 'TEST-EXIT-NOT-RUN': {
      const unit = tests.units.find((entry) => entry.key === facts.unit), file = fileOf(unit.path);
      const { key, name, kind, line, end, exported, status, affects, failureDirect, viaFailure, candidates, via } = unit;
      return { details: { unit: { key, path: unit.path, name, kind, line, end, exported, status, affects, failureDirect, viaFailure, candidates },
        exits: part('exits', unit.exits),
        cases: { direct: part('cases.direct', unit.direct.map(caseOf)), via: part('cases.via', unit.viaCases.map((item) => ({ ...caseOf(item.id), route: item.route, checks: item.checks }))),
          viaTotal: via, note: 'The analysis keeps the first five cases that reach this function through callers, with their routes. The file-level test lists are complete.' },
        tests: { direct: part('tests.direct', file?.tests.direct ?? []), transitive: part('tests.transitive', file?.tests.transitive ?? []) }, file: fileCommand(unit.path) }, parts };
    }
    case 'TEST-FOCUSED': case 'TEST-NO-ASSERTIONS': case 'TEST-SWALLOWED-ERROR': case 'TEST-FIXED-WAIT': case 'TEST-PARKED': {
      const item = tests.cases[finding.caseIds[0]];
      return { details: { case: { ...caseOf(item.id), each: item.each, smells: item.smells, kinds: item.kinds, failureTargets: item.failureTargets, evidence: item.evidence }, testFile: testFileOf(item.path) }, parts };
    }
    case 'TEST-UNRECOGNIZED-FILE': case 'TEST-LAYER-MISMATCH': return { details: { testFile: testFileOf(path) }, parts };
    case 'FIX-WITHOUT-TEST': {
      const commit = tests.fixCommits.commits.find((entry) => entry.sha === facts.sha);
      return { details: { commit: { sha: commit.sha, date: commit.date, subject: commit.subject }, sources: part('sources', commit.sources) }, parts };
    }
    case 'NEXT-CLIENT-API-IN-SERVER': case 'NEXT-SERVER-IMPORT-IN-CLIENT': case 'NEXT-USE-SERVER-EXPORT': case 'NEXT-CLIENT-PRIVATE-ENV': return nextFindingDetails(analysis.frameworks.nextjs, finding, fileCommand);
    case 'FETCH-NO-SIGNAL': case 'INTERVAL-NOT-CLEARED': case 'CATCH-EMPTY': case 'EFFECT-NO-CLEANUP': return { details: { file: fileCommand(path) }, parts };
    case 'SYNTAX-ERROR': return { details: { syntax: (analysis.syntaxErrors ?? []).find((item) => item.path === path) ?? null, file: fileOf(path) ? fileCommand(path) : null }, parts };
    case 'ENV-UNDECLARED': case 'ENV-UNUSED': return envFindingDetails(analysis.frameworks.env, finding, fileCommand);
    case 'OPENAPI-NO-HANDLER': case 'OPENAPI-PARAM-NAME': case 'OPENAPI-UNDOCUMENTED-METHOD': return openapiFindingDetails(analysis, finding, fileCommand);
    default: return Object.values(packageRules).includes(finding.ruleId) ? packageFindingDetails(analysis, finding, fileCommand) : { details: {}, parts };
  }
}
