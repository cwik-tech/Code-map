// I/O shell for v1. Reuses the comparisons and scanners that inspect exposes.
import { compareApi } from '../api-compare.mjs';
import { compareSchemas } from '../schemas/compare.mjs';
import { compareSupply } from '../supply/compare.mjs';
import { callSites } from '../impact/calls.mjs';
import { readHead } from '../impact/head-files.mjs';
import { findReferences, placeOf, referenceTerms } from '../impact/references.mjs';
import { oracleTestBytes } from '../oracle-files.mjs';
import { supplyPolicy } from '../supply/policy.mjs';
import { bindOracles, readOracles } from '../oracles.mjs';
import { changedCoverage } from '../changed-coverage.mjs';
import { functionList } from '../complexity.mjs';
/** Builds uncapped rule-set evidence from both stored analyses and the selected snapshot. */
export function collectEvidence(repository, { head, base, comparison, change, provenance, executions, mutation, coverage, lines, config }) {
  const api = compareApi(base, head, { renames: comparison.renames, complete: change.complete, state: comparison.result.state, reasons: comparison.result.reasons });
  const texts = readHead(head, (path) => placeOf(path) !== null), terms = referenceTerms(api.items, change.files, comparison.renames, head.data.analysis);
  const references = findReferences(texts.texts, terms, []);
  // The reference scanner excludes known consumers. They still count as stale when they import a removed name or path.
  for (const item of api.items.filter((x) => x.status === 'REMOVED')) for (const consumer of item.consumers?.items ?? []) references.hits.push({ path: consumer.path, place: placeOf(consumer.path), term: item.name });
  const calls = api.state === 'COMPARABLE' ? callSites(api.items, head, texts.texts) : { sites: [], unread: [] };
  const isolatedArtifacts = new Set(executions.filter((x) => x.eligible && x.side === 'head' && x.attestation === 'isolated').map((x) => x.artifact));
  const isolatedCoverage = coverage.filter((x) => isolatedArtifacts.has(x.artifact));
  const schemas = compareSchemas(base.data.schemas, head.data.schemas, comparison.renames, change.complete);
  const policy = supplyPolicy(config.supplyChain), supply = compareSupply(base.data.analysis.supply, head.data.analysis.supply);
  if (policy && !head.data.analysis.supply?.lockfile) supply.state = 'unknown';
  const added = supply.changes.filter((x) => x.change === 'added');
  const newPackages = (head.data.analysis.supply?.packages ?? []).filter((x) => added.some((y) => y.name === x.name && y.to === x.version));
  const records = readOracles(repository)?.entries ?? [];
  return { api, calls, references, schemas, policy, supply, newPackages,
    schemaUnread: [base, head].some((x) => (x.data.schemas?.unread ?? []).length > 0),
    supplyFindings: head.findings.filter((x) => ['DEPENDENCY-LICENSE', 'DEPENDENCY-HOST', 'DEPENDENCY-NO-INTEGRITY'].includes(x.ruleId)),
    oracles: bindOracles(records, oracleTestBytes(head, records.map((x) => x.file))), cases: provenance.entries,
    harness: executions.filter((x) => x.side === 'head' && x.binding === 'BOUND' && x.eligible && x.harness && x.harness.mode !== 'migrate').map((x) => ({ ...x.harness, attestation: x.attestation, artifact: x.artifact })),
    mutation: mutation.filter((x) => isolatedArtifacts.has(x.artifact) || executions.some((y) => y.artifact === x.artifact && y.side === 'head' && y.eligible)),
    isolatedCoverage: isolatedCoverage.length ? changedCoverage(lines, isolatedCoverage, functionList(head.data.analysis.files)) : null };
}
