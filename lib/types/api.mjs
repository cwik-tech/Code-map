// Adds compiler-backed comparison, unambiguous rename pairs, and per-package release annotations.
import { digestOf } from '../api-signatures.mjs';

/** Checker records use the declaring name after a public re-export. */
export function checkerRecord(stored, path, record) {
  return stored.data.analysis.typed?.exports[record?.declaredIn ?? path]?.[record?.declaredName ?? record?.name];
}
/** Compares known checker shapes for inferred and explicitly annotated exports. */
export function typedChange(base, head, path, old, before, after) {
  if (before.kind !== after.kind || before.digest !== after.digest) return undefined;
  const left = base.data.analysis.typed, right = head.data.analysis.typed;
  if (!left && !right) return undefined;
  if (left?.state !== 'COMPLETE' || right?.state !== 'COMPLETE') return { status: 'UNKNOWN', reasons: ['checker-unavailable'] };
  const a = checkerRecord(base, old, before), b = checkerRecord(head, path, after);
  if (!a || !b || a.state !== 'KNOWN' || b.state !== 'KNOWN') return { status: 'UNKNOWN', reasons: ['checker-type-unknown'] };
  return a.text === b.text && a.shapeDigest === b.shapeDigest ? null : { status: 'CHANGED', reasons: ['checker-type'] };
}
const signature = (item, side) => {
  const record = item[side];
  // Export names are not part of a rename signature. Keep parameter and member names intact.
  const text = record.text.replace(new RegExp(`\\b${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), '<export>');
  return digestOf(`${record.kind}:${text}`);
};
const renameTypesMatch = (base, head, removed, added) => {
  const a = base.data.analysis.typed, b = head.data.analysis.typed;
  if (!a && !b) return true;
  if (a?.state !== 'COMPLETE' || b?.state !== 'COMPLETE') return false;
  const before = a.exports[removed.basePath ?? removed.path]?.[removed.name];
  const after = b.exports[added.path]?.[added.name];
  return before?.state === 'KNOWN' && after?.state === 'KNOWN' && before.text === after.text && before.shapeDigest === after.shapeDigest;
};
const version = (value) => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ? value.split('.').map(Number) : null;
function policy(base, head, item) {
  const before = base.data.analysis.api, after = head.data.analysis.api;
  const entry = after.entryPoints.files.find((entry) => entry.path === item.path)
    ?? before.entryPoints.files.find((entry) => entry.path === (item.basePath ?? item.path));
  const override = after.breaking;
  const a = version(before.packages?.[entry?.package]), b = version(after.packages?.[entry?.package]);
  const bump = a && b && (b[0] > a[0] || a[0] === 0 && b[0] === 0 && b[1] > a[1]);
  return { allowed: override ? override === 'allowed' : !!bump, reason: override ? 'configured' : bump ? 'breaking-release' : 'no-breaking-release', package: entry?.package ?? null };
}
/** Mutates only the new comparison items. Ambiguous same-signature additions remain separate. */
export function finishApi(items, base, head) {
  const consumed = new Set();
  for (const item of items.filter((item) => item.status === 'REMOVED' && !item.base.truncated && item.base.kind !== 'unknown')) {
    const matches = items.filter((other) => other.status === 'ADDED' && !other.head.truncated && other.head.kind !== 'unknown' && other.group === item.group && other.path === item.path
      && signature(item, 'base') === signature(other, 'head') && renameTypesMatch(base, head, item, other));
    const peers = items.filter((other) => other.status === 'REMOVED' && other.group === item.group && other.path === item.path
      && signature(item, 'base') === signature(other, 'base'));
    if (matches.length !== 1 || peers.length !== 1) continue;
    const added = matches[0];
    item.status = 'RENAMED'; item.pair = { from: item.name, to: added.name }; item.head = added.head;
    consumed.add(added);
  }
  const result = items.filter((item) => !consumed.has(item));
  for (const item of result) if (item.group === 'public' && ['REMOVED', 'RENAMED', 'CHANGED'].includes(item.status)) item.releasePolicy = policy(base, head, item);
  return result;
}
