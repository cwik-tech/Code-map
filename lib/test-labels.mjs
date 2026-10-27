// Optional model labels for test cases: a person or an agent writes each case's intent, and the map shows it.
// A file's labels become "stale" when its test file changes after they were stamped, the same way descriptions do.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const intents = ['happy', 'unhappy', 'edge', 'regression'];
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

export function loadTestLabels(path) {
  if (!existsSync(path)) return { files: {} };
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(parsed)) throw new Error(`${path}: expected an object`);
  const files = {};
  for (const [file, entry] of Object.entries(isRecord(parsed.files) ? parsed.files : {})) {
    if (!isRecord(entry)) continue;
    const cases = {};
    for (const [name, label] of Object.entries(isRecord(entry.cases) ? entry.cases : {})) {
      if (isRecord(label) && intents.includes(label.intent)) cases[name] = { intent: label.intent, note: typeof label.note === 'string' ? label.note : '' };
    }
    files[file] = { hash: typeof entry.hash === 'string' ? entry.hash : undefined, cases };
  }
  return { files };
}

export const testHash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);
export const caseKey = (item) => item.suite ? `${item.suite} > ${item.name}` : item.name;

/** missing: no labels · unstamped: labels without a recorded test version · stale: the test changed since · current. */
export function labelStatus(entry, hash) {
  if (!entry || Object.keys(entry.cases).length === 0) return 'missing';
  if (entry.hash === undefined) return 'unstamped';
  return entry.hash === hash ? 'current' : 'stale';
}

/** The labels that the map shows: only test files that still exist, each with its freshness. */
export function labelsForMap(labels, testFacts, texts, file) {
  const files = {};
  for (const facts of testFacts) {
    const entry = labels.files[facts.path];
    if (entry) files[facts.path] = { status: labelStatus(entry, testHash(texts.get(facts.path) ?? '')), cases: entry.cases };
  }
  return { file, files };
}

/** A Markdown work list for the model pass: the cases of each test file whose labels are missing or stale. */
export function labelsTodo(labels, testFacts, texts, labelsPath, only = []) {
  const lines = ['# Code map: test intents to label', '',
    `For each case below, read the test and write its intent in \`${labelsPath}\` under "files" → test path → "cases" → case name.`,
    `Use one of: ${intents.map((intent) => `"${intent}"`).join(', ')}. "unhappy" means that the case checks a failure, an error or a rejected input.`,
    '"regression" means that the case guards against a bug that was fixed; label it "regression" only when that is its main purpose.',
    'Add a short "note" when the intent is not obvious from the name.',
    'Then run `code-map labels stamp` for new files, or `code-map labels stamp --file <test>` for each file whose labels you refreshed.',
    'Example: {"files": {"test/a.test.ts": {"cases": {"parse > rejects empty input": {"intent": "unhappy"}}}}}', ''];
  for (const facts of testFacts) {
    if (only.length && !only.includes(facts.path)) continue;
    const entry = labels.files[facts.path], status = labelStatus(entry, testHash(texts.get(facts.path) ?? ''));
    // A current file lists only the cases that still have no label; any other state lists every case.
    const cases = (facts.testScan?.cases ?? []).filter((item) => status !== 'current' || !entry.cases[caseKey(item)]);
    if (cases.length === 0) continue;
    lines.push(`## ${facts.path} (${status === 'current' ? 'labels missing for some cases' : status}, ${cases.length} cases)`);
    for (const item of cases) {
      const kinds = [...new Set(item.failures.map((failure) => failure.kind))];
      lines.push(`- line ${item.line}: ${caseKey(item)} · ${item.assertions} assertions${kinds.length ? ` · failure checks found: ${kinds.join(', ')}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Records the version of each labelled test file, so a later edit to the test marks its labels stale. Without `only`,
 * it stamps files that have no version yet (`all`: every labelled file). With `only`, it refreshes exactly those files,
 * after their labels were reviewed. Other content stays as written.
 */
export function stampTestLabels(path, testFacts, texts, all, only = []) {
  if (!existsSync(path)) return 0;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  let stamped = 0;
  const known = new Set(testFacts.map((facts) => facts.path));
  for (const [file, entry] of Object.entries(isRecord(raw?.files) ? raw.files : {})) {
    if (!known.has(file) || !isRecord(entry)) continue;
    if (only.length ? !only.includes(file) : typeof entry.hash === 'string' && !all) continue;
    entry.hash = testHash(texts.get(file) ?? '');
    stamped += 1;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(raw, null, 2) + '\n');
  return stamped;
}
