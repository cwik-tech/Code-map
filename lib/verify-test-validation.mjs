// Pure failure-sensitivity comparisons for declared regression and generated tests.
function positioned(cases) {
  const seen = new Map();
  return new Map(cases.map((item) => {
    const identity = JSON.stringify([item.file, item.suite ?? null, item.name]), position = seen.get(identity) ?? 0;
    seen.set(identity, position + 1);
    return [JSON.stringify([identity, position]), { ...item, position }];
  }));
}
/** Matches file, suite, name and position. Missing cases cannot confirm failure sensitivity. */
export function compareTestCases(base, head) {
  const before = positioned(base), after = positioned(head), keys = [...new Set([...before.keys(), ...after.keys()])];
  const cases = keys.map((key) => {
    const old = before.get(key), current = after.get(key), item = current ?? old;
    const base = old?.status ?? 'missing', head = current?.status ?? 'missing';
    return { file: item.file, suite: item.suite ?? null, name: item.name, position: item.position, base, head,
      confirmed: ['failed', 'errored'].includes(base) && head === 'passed' };
  });
  return { sameCases: cases.length > 0 && cases.every((item) => item.base !== 'missing' && item.head !== 'missing'), cases };
}

/** Summarizes only reported cases selected by the declared file and optional name. */
export function testOutcome(reports, declaration, runs) {
  const cases = reports.flatMap((report) => report.cases).filter((item) => item.file === declaration.file && (declaration.name === undefined || item.name === declaration.name));
  const failed = cases.some((item) => ['failed', 'errored'].includes(item.status));
  const status = !cases.length ? 'unavailable' : failed ? 'failed' : cases.every((item) => item.status === 'passed') ? 'passed' : 'skipped';
  return { status, cases, runs };
}

/** Expands one explicit whole-word selector. Authorization checks the expanded words. */
export function generatedCommand(words, file) {
  if (!Array.isArray(words) || words.filter((word) => word === '{testFile}').length !== 1
    || words.some((word) => typeof word !== 'string' || word.includes('{testFile}') && word !== '{testFile}')) {
    throw new Error('Generated mutation needs one whole-word {testFile} selector.');
  }
  return words.map((word) => word === '{testFile}' ? file : word);
}

/** A killed mutant needs the same reported cases and a failure, without runner errors. */
export function generatedMutantStatus(result, cases, baseline) {
  if (result.record.stoppedBy === 'wallClockSeconds') return 'Timeout';
  if (result.exitCode !== 0 || result.record.signal !== null || !compareTestCases(baseline, cases).sameCases
    || cases.some((item) => item.status === 'errored')) return 'RuntimeError';
  if (result.record.exitStatus === 0 && cases.every((item) => item.status === 'passed')) return 'Survived';
  return result.record.exitStatus !== 0 && cases.some((item) => item.status === 'failed') ? 'Killed' : 'RuntimeError';
}

/** Only unambiguous tagged cases that fail a killed mutant support an acceptance obligation. */
export function supportedObligations(mutants, links) {
  return [...new Set(mutants.filter((item) => item.status === 'Killed').flatMap((item) => item.cases
    .filter((entry) => entry.status === 'failed').flatMap((entry) => {
      const matches = links.filter((link) => link.file === entry.file && link.name === entry.name && link.suite === entry.suite);
      return matches.length === 1 ? (matches[0].criteria ?? []).map((id) => `acceptance.${id}`) : [];
    })))].sort();
}
/** Every generated declaration retains an unavailable outcome when execution has no applicable command. */
export function unavailableGenerated(declarations, reason) {
  return declarations.map(({ file, name }) => ({ file, ...(name === undefined ? {} : { name }), commandId: null,
    compilation: { status: 'unavailable', diagnostics: [], reason }, typeCheck: { status: 'unavailable', reason },
    head: { status: 'unavailable', cases: [], runs: [] }, base: { status: 'unavailable', cases: [], runs: [] },
    mutants: [], failureSensitive: false, supports: [], reason }));
}

/** A named declaration needs its own unambiguous failed case in a killed file-scoped mutant. */
export function generatedSensitivity(declaration, head, mutants) {
  if (head.status !== 'passed') return false;
  return mutants.some((mutant) => mutant.status === 'Killed' && mutant.cases.some((entry) => entry.status === 'failed'
    && entry.file === declaration.file && (declaration.name === undefined || entry.name === declaration.name
      && head.cases.filter((item) => item.name === entry.name && item.suite === entry.suite).length === 1)));
}
