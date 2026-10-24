// Structural and completeness checks of evidence-v1. Each check uses existing comparison evidence.
import { completePythonTypeReport, pythonTypeKinds } from './python-compiler-evidence.mjs';
/** Public export failures need a consumer diagnostic, or a definite argument-count break without compiler evidence. */
export function publicInterface(context) {
  const { api, calls } = context.evidence, compilers = context.compiler.head.filter((report) => report.kind !== 'ruff-json'
    && (!pythonTypeKinds.includes(report.kind) || completePythonTypeReport(report)));
  const items = api.items.filter((x) => x.group === 'public' && x.status !== 'ADDED');
  const changed = items.filter((x) => ['REMOVED', 'CHANGED'].includes(x.status));
  const consumers = new Set(changed.flatMap((x) => x.consumers?.items ?? []).map((x) => x.path));
  if (compilers.some((x) => x.diagnostics.some((d) => d.category === 'error' && consumers.has(d.file)))) return ['FAIL', 'A changed public export still has a consumer with a compiler error.'];
  if (!compilers.length && calls.sites.some((x) => x.likelyBreak && changed.some((y) => y.path === x.export.path && y.name === x.export.name))) return ['FAIL', 'A public consumer call is outside the new argument range.'];
  if (api.state !== 'COMPARABLE' || !api.complete || items.some((x) => x.status === 'UNKNOWN')) return ['UNKNOWN', 'The public export comparison has an unknown result.'];
  if (consumers.size && !compilers.length) return ['UNKNOWN', 'Changed public exports have consumers without a bound head compiler report.'];
  return ['PASS', 'No changed public export has a demonstrated incompatible consumer.'];
}
/** A missing migration or documentation change fails before an unread schema gives UNKNOWN. */
export function migrationsDocs(context) {
  const e = context.evidence;
  if (e.schemas.migrations.some((x) => x.state === 'MIGRATION_MISSING')) return ['FAIL', 'A database schema changed without a new migration.'];
  const publicChange = e.api.items.some((x) => x.group === 'public' && ['REMOVED', 'CHANGED'].includes(x.status));
  if (publicChange && !context.change.paths.some((x) => /\.(?:md|mdx|markdown)$/i.test(x))) return ['FAIL', 'A removed or changed public export has no documentation change.'];
  if (e.schemaUnread || e.api.state !== 'COMPARABLE') return ['UNKNOWN', 'Code-map cannot read a schema or compare the public interface.'];
  return ['PASS', 'No missing migration or public-interface documentation change was found.'];
}
/** New packages alone are subject to this policy check. Without a policy it does not apply. */
export function dependencyPolicy(context) {
  const e = context.evidence;
  if (!e.policy) return ['NOT_APPLICABLE', 'The project declares no supply-chain policy.'];
  const added = e.supply.changes.filter((x) => x.change === 'added');
  const matches = (name, version) => added.some((x) => x.name === name && x.to === version);
  if (e.supplyFindings.some((x) => matches(x.facts.name, x.facts.version))
    || e.policy.forbidInstallScripts && (e.newPackages ?? []).some((x) => x.installScript)) return ['FAIL', 'A new dependency breaks the declared policy.'];
  if (e.supply.state !== 'compared') return ['UNKNOWN', 'Code-map cannot read the lockfile comparison.'];
  return ['PASS', 'No new dependency breaks the declared policy.'];
}

/** Preserve v0 failures. V1 also requires current reviews for every detected assertion and runner weakening. */
export function testsNotWeakened(context, previous) {
  const reviews = context.tests?.reviews;
  if (previous.result === 'FAIL') return ['FAIL', previous.rationale];
  if (reviews?.unreviewed > 0) return ['FAIL', `${reviews.unreviewed} assertion or runner weakening entries need a current human review.`];
  if (reviews?.error) return ['UNKNOWN', `Cannot read weakening reviews: ${reviews.error}`];
  if (previous.result === 'UNKNOWN') return ['UNKNOWN', previous.rationale];
  if (reviews?.incomplete || context.tests?.assertionWeakening?.unread?.length || context.tests?.runnerSettings?.unknown) return ['UNKNOWN', 'A changed test or runner configuration cannot be compared.'];
  return ['PASS', 'No unreviewed assertion or runner weakening remains.'];
}
