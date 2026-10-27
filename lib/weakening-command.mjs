// Record a person's acceptance of one current working-tree weakening entry.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { analysisId, analysisInputs } from './inputs.mjs';
import { checkStore, ensure } from './inspect.mjs';
import { storeLocation } from './store.mjs';
import { changedFiles } from './verify-change.mjs';
import { testChanges } from './test-changes.mjs';
import { readReviewTarget } from './weakening-files.mjs';
import { readReviews, reviewDigest, reviewFile, writeReviews } from './weakening-reviews.mjs';
const needed = ['entry', 'reason', 'reviewed-by'];
const allowed = new Set([...needed, 'base', 'store', 'compact']);
/** The shell supplies the date. A model must not write a review record. */
export function recordWeakening(repository, config, options, { today, words = [], env = process.env }) {
  if (words.length) throw new Error('review-weakening takes no extra words.');
  const extra = Object.entries(options).filter(([name, value]) => !allowed.has(name) && value !== undefined && value !== false && !(name === 'port' && value === '4477'));
  if (extra.length) throw new Error(`review-weakening does not accept ${extra.map(([name]) => `--${name}`).join(', ')}.`);
  for (const name of needed) if (typeof options[name] !== 'string' || !options[name].trim()) throw new Error(`review-weakening needs --${name}.`);
  const location = storeLocation(options.store, env);
  checkStore(repository, config, {}, location);
  if (options.base !== undefined && (!options.base || options.base.startsWith('-') || options.base === 'worktree')) throw new Error('--base must name a commit.');
  const head = ensure(repository, config, { worktree: true }, location);
  const base = ensure(repository, config, { ref: options.base ?? 'HEAD', worktree: false }, location);
  const change = changedFiles(repository, base.stored.data.sha, null);
  const tests = testChanges(repository, { baseSha: base.stored.data.sha, headSha: null, change,
    baseAnalysis: base.stored.data.analysis, headAnalysis: head.stored.data.analysis });
  const found = tests.reviews.entries.find((x) => x.id === options.entry);
  if (!found || !found.digest) throw new Error('The entry must identify a current weakening with a readable head file.');
  const before = readReviews(repository);
  const record = { id: found.id, file: found.path, digest: found.digest, reason: options.reason, reviewedBy: options['reviewed-by'], date: today };
  const bytes = readReviewTarget(repository, null, found.path);
  const digest = found.deleted && !existsSync(join(repository, found.path)) ? reviewDigest('code-map:missing-file') : bytes ? reviewDigest(bytes) : null;
  if (digest !== found.digest || analysisId(analysisInputs(repository, config, { worktree: true }, null)) !== head.stored.id) {
    throw new Error('The current code changed while recording the review. Run the command again.');
  }
  const written = writeReviews(repository, [...(before?.entries ?? []).filter((x) => x.id !== record.id), record], before?.digest ?? null);
  return { reportType: 'code-map-weakening-review', schemaVersion: 1, path: reviewFile, digest: written, entry: record };
}
