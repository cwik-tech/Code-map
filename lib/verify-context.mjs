// The context of one verification run for a language model (C44): the request, the failed and the unknown checks with their
// evidence IDs, and the next actions, in at most 256 KiB of JSON. `code-map verify --context <run ID>` reads the results of a
// finished run. It runs no analysis and writes nothing. A model can answer with a hypotheses file (lib/hypotheses.mjs).
import { caseName } from './profiles/static-baseline-v0.mjs';
import { requireResults } from './verification-schema.mjs';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { hypothesesVersion, hypothesisKinds } from './hypotheses.mjs';
import { requirePrivateFolder } from './store.mjs';
import { fileNames, requireSafe, runIdPattern, sortChecks } from './verify-report.mjs';
import { message, readLimited, shown } from './verify-reports.mjs';

/** The context has at most 256 KiB of JSON with an indentation of 2. Each text has at most 2000 characters, the intent 10000. */
export const maxContextBytes = 256 * 1024;
const maxResultsBytes = 64 * 1024 * 1024, maxText = 2000, maxEvidence = 50;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const cut = (value, max = maxText) => typeof value !== 'string' ? value ?? null : value.length > max ? `${value.slice(0, max - 3)}...` : value;
const exists = (path) => { try { lstatSync(path); return true; } catch { return false; } };
const rule = 'To give hypotheses, write a JSON file with hypothesesVersion 1, the model name and items of id, kind, claim and evidenceIds (and an optional proposedTest of file, name and text), '
  + 'and name it in "hypotheses" of the request. Use only evidence IDs of these checks or of the results of the run. A hypothesis is model output. It changes no check, rating or readiness.';

/** The results of one finished run under `root`, the output folder of verify. The run ID and the folders are checked as writeRun checks them. */
export function readRun(root, runId) {
  if (typeof runId !== 'string' || !runIdPattern.test(runId)) throw new Error(`"${shown(runId)}" is not a valid run ID. A run ID has 1 to 128 letters, digits, ".", "_" or "-", and it starts with a letter or a digit.`);
  const runs = join(root, 'runs'), folder = join(runs, runId), path = join(folder, fileNames.results);
  if (!exists(path)) throw new Error(`No verification run ${runId} exists in ${shown(root)}. Give the run ID that code-map verify printed, with the same --out-dir or --store.`);
  // Another user who can change these folders can plant forged results.
  requireSafe(root, runs);
  requirePrivateFolder(folder, 'Remove it, or choose another output folder with --out-dir <folder>.');
  let results;
  try { results = JSON.parse(readLimited(path, maxResultsBytes, 'results file').toString('utf8')); } catch (error) { throw new Error(`Cannot read the results of run ${runId}: ${message(error)}`); }
  if (!isRecord(results) || results.reportType !== 'code-map-verification' || results.runId !== runId) throw new Error(`The file ${shown(path)} does not hold the results of run ${runId}.`);
  return requireResults(results);
}

/** Keep complete reverse-dependency paths selected by a failed or unknown check. Import edges point from consumer to dependency. */
function graphPaths(graph, paths) {
  const edges = new Map();
  for (const item of paths) for (let index = 1; index < item.path.length; index++) {
    const source = item.path[index], target = item.path[index - 1];
    edges.set(JSON.stringify([source, target]), { source, target });
  }
  return { ...graph, paths, edges: [...edges.values()], omittedPaths: (graph.omittedPaths ?? 0) + graph.paths.length - paths.length };
}

/** Reuse the impact walk (at most 2000 files and depth 10). Keep at most 100 check/consumer paths, with upstream uncertainty. */
export function graphContext({ obligations, changedPaths, impact, findings, reports = { head: [] } }) {
  const changed = new Set(changedPaths), byEvidence = new Map(findings.map((finding) => [finding.id, finding.paths]));
  const caseFiles = new Map();
  for (const report of reports.head) for (const item of report.cases) {
    if (!item.file) continue;
    const id = `case:${report.artifact}:${caseName(item)}`;
    if (!caseFiles.has(id)) caseFiles.set(id, new Set());
    caseFiles.get(id).add(item.file);
  }
  const paths = [], walks = new Map(), metadata = { complete: true, truncated: null, dynamicImports: { files: 0, sites: 0 } };
  let total = 0;
  const { failed, unknown } = sortChecks(obligations);
  for (const check of [...failed, ...unknown]) {
    const seeds = new Map(), targets = new Map();
    for (const id of check.evidenceIds ?? []) {
      for (const file of caseFiles.get(id) ?? []) {
        if (!targets.has(file)) targets.set(file, []);
        targets.get(file).push(id);
      }
      const selected = id.startsWith('path:') ? [id.slice(5)]
        : id.startsWith('import:') ? [id.slice(7, id.lastIndexOf(':'))] : byEvidence.get(id) ?? [];
      for (const seed of selected.filter((path) => changed.has(path))) {
        if (!seeds.has(seed)) seeds.set(seed, []);
        seeds.get(seed).push(id);
      }
    }
    if (targets.size) for (const seed of changed) if (!seeds.has(seed)) seeds.set(seed, []);
    for (const [seed, seedEvidence] of seeds) {
      // Walk each seed separately so another changed file cannot hide a connecting dependency path.
      if (!walks.has(seed)) walks.set(seed, impact(seed));
      const walk = walks.get(seed), parents = new Map(walk.files.map((file) => [file.path, file.imports]));
      metadata.complete &&= walk.complete;
      metadata.truncated ??= walk.truncated;
      metadata.dynamicImports = walk.dynamicImports;
      for (const file of walk.files) {
        const evidenceIds = [...new Set([...seedEvidence, ...(targets.get(file.path) ?? [])])];
        if (!evidenceIds.length) continue;
        const path = [file.path], seen = new Set(path);
        let parent = file.imports;
        while (parent && !seen.has(parent) && path.length <= 10) {
          path.unshift(parent); seen.add(parent);
          if (parent === seed) break;
          parent = parents.get(parent);
        }
        if (path[0] !== seed) continue;
        total++;
        if (paths.length < 100) paths.push({ checkId: check.id, evidenceIds, changed: seed, path, test: file.test, kind: file.kind });
      }
    }
  }
  return graphPaths({ paths, ...metadata, omittedPaths: total - paths.length }, paths);
}

/** The context of the results of one run. When it is larger than maxContextBytes, it lists fewer items, and `omitted` counts the items that it left out. */
export function verificationContext(results) {
  const { failed, unknown } = sortChecks(Array.isArray(results.obligations) ? results.obligations : []), request = isRecord(results.request) ? results.request : {};
  const check = (item) => ({ id: item.id, title: cut(item.title), category: item.category, required: item.required, blocking: item.blocking, result: item.result, eligible: item.eligible,
    rationale: cut(item.rationale), evidenceIds: (item.evidenceIds ?? []).slice(0, maxEvidence), nextAction: cut(item.nextAction) });
  const actions = [...new Set([...failed, ...unknown].map((item) => cut(item.nextAction)).filter(Boolean))];
  const criteria = (request.acceptanceCriteria ?? []).map((item) => ({ id: item.id, text: cut(item.text) })), paths = Array.isArray(request.allowedPaths) ? request.allowedPaths : null;
  const side = (value) => isRecord(value) ? { ref: value.ref, sha: value.sha } : null;
  const graph = isRecord(results.graph) && Array.isArray(results.graph.paths) ? results.graph : null;
  const build = (limit) => {
    const take = (list) => list.slice(0, limit), counts = { failedChecks: failed.length, unknownChecks: unknown.length, acceptanceCriteria: criteria.length, allowedPaths: paths?.length ?? 0, nextActions: actions.length };
    const omitted = Object.fromEntries(Object.entries(counts).map(([name, total]) => [name, Math.max(0, total - limit)]));
    const selectedChecks = new Set([...take(failed), ...take(unknown)].map((check) => check.id));
    return { reportType: 'code-map-verification-context', schemaVersion: 1, runId: results.runId, createdAt: results.createdAt ?? null, profileId: results.profileId ?? null, ...(results.profileStatus ? { profileStatus: results.profileStatus } : {}),
      ratingRulesVersion: results.ratingRulesVersion ?? null, readiness: { state: results.readiness?.state ?? null, exitCode: results.readiness?.exitCode ?? null },
      ratings: Object.fromEntries(Object.entries(isRecord(results.ratings) ? results.ratings : {}).map(([name, rating]) => [name, { state: rating?.state ?? null, value: rating?.value ?? null, label: rating?.label ?? null }])),
      request: { intent: cut(results.intent, 10000), changeType: results.changeType ?? null, base: side(results.base), head: side(results.head), acceptanceCriteria: take(criteria),
        allowedPaths: paths && take(paths.map((path) => cut(path))), hypotheses: request.hypotheses ?? null, digest: request.digest ?? null },
      checks: { failed: take(failed).map(check), unknown: take(unknown).map(check) }, nextActions: take(actions),
      ...(graph ? { graph: graphPaths(graph, take(graph.paths).filter((path) => selectedChecks.has(path.checkId))) } : {}),
      hypotheses: { hypothesesVersion, kinds: hypothesisKinds, rule }, omitted: Object.values(omitted).some((count) => count > 0) ? omitted : null };
  };
  const size = (value) => Buffer.byteLength(JSON.stringify(value, null, 2));
  let limit = Math.max(failed.length, unknown.length, criteria.length, paths?.length ?? 0, actions.length, graph?.paths.length ?? 0), value = build(limit);
  while (size(value) > maxContextBytes && limit > 0) value = build(limit = Math.floor(limit / 2));
  if (size(value) > maxContextBytes) throw new Error(`The context of run ${results.runId} is larger than ${maxContextBytes} bytes, also without checks.`);
  return value;
}
