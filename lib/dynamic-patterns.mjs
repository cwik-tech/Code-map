// Expand bounded relative template imports after cache lookup, against the current snapshot paths.
import { posix } from 'node:path';

/** Records fixed template parts. Interpolations match within one folder. */
export function templatePattern(node) {
  if (!node.templateSpans?.length) return null;
  const prefix = node.head.text, parts = node.templateSpans.map((span) => span.literal.text), suffix = parts.at(-1);
  return /^\.{1,2}\//.test(prefix) && suffix && parts.every((part) => !part.includes('/')) && !/[?!\\]/.test(prefix + parts.join(''))
    ? { prefix, suffix, middle: parts.slice(0, -1) } : null;
}

/** Matches fixed parts in order without overlap or regular-expression backtracking. */
function matches(path, prefix, { suffix, middle = [] }) {
  if (!path.startsWith(prefix) || !path.endsWith(suffix) || path.length < prefix.length + suffix.length) return false;
  const variable = path.slice(prefix.length, -suffix.length);
  let offset = 0;
  for (const part of middle) {
    const at = variable.indexOf(part, offset);
    if (at < 0) return false;
    offset = at + part.length;
  }
  return true;
}

/** Returns new facts. Unmatched patterns keep their unresolved expression edge. */
export function expandPatterns(file, paths) {
  const uses = { ...file.uses }, valueUses = { ...file.valueUses }, imports = new Set(file.imports);
  const edges = file.edges.flatMap((edge) => {
    if (!edge.pattern) return [edge];
    const joined = posix.join(posix.dirname(file.path), edge.pattern.prefix);
    const prefix = joined === './' ? '' : joined.replace(/^\.\//, '');
    if (prefix === '..' || prefix.startsWith('../') || posix.isAbsolute(prefix)) return [edge];
    const slash = prefix.lastIndexOf('/'), folder = slash < 0 ? '.' : prefix.slice(0, slash) || '.';
    const targets = paths.filter((path) => posix.dirname(path) === folder && matches(path, prefix, edge.pattern)).sort();
    if (!targets.length) return [edge];
    return targets.map((target) => {
      if (target !== file.path) { imports.add(target); uses[target] = [...new Set([...(uses[target] ?? []), '*'])]; valueUses[target] = [...new Set([...(valueUses[target] ?? []), '*'])]; }
      return { ...edge, target, kind: 'dynamic-pattern' };
    });
  });
  return { ...file, imports: [...imports].sort(), edges, uses, valueUses };
}
