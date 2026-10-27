// Bounded style inputs for the unused-package check. The snapshot reader rejects symlinks before reading content.
import { posix } from 'node:path';
import { ignored } from '../project.mjs';
import { classify } from './manifests.mjs';

export const styleLimits = { file: 1024 * 1024, total: 16 * 1024 * 1024 };
export const isStyle = (path) => /\.(?:css|scss|sass|less|pcss)$/i.test(path) && !ignored(path);

/** Reads style files below package folders, with per-file and total byte limits. */
export function readStyles(paths, reader) {
  const folders = paths.filter((path) => posix.basename(path) === 'package.json' && !ignored(path)).map(posix.dirname);
  const styles = paths.filter((path) => isStyle(path) && folders.some((folder) => folder === '.' || path.startsWith(`${folder}/`))).sort();
  const parents = (path) => path.split('/').slice(0, -1).map((_, index) => path.split('/').slice(0, index + 1).join('/'));
  const stats = reader.stat([...new Set([...styles, ...styles.flatMap(parents)])]), selected = [];
  let total = 0;
  for (const path of styles) {
    const info = stats.get(path);
    if (!info?.file || info.link || parents(path).some((parent) => stats.get(parent)?.link) || info.size > styleLimits.file || total + info.size > styleLimits.total) continue;
    total += info.size;
    selected.push(path);
  }
  return reader.read(selected);
}

/** Literal targets of style directives, excluding comments and unrelated strings. */
function specifiers(text) {
  const tokens = /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|@(import|use|forward|plugin|config)\b/g;
  const target = /\s*(?:url\(\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s)'";]+))\s*\)|"([^"\r\n]*)"|'([^'\r\n]*)')/iy;
  const found = [];
  for (let token; (token = tokens.exec(text));) {
    if (!token[1]) continue;
    target.lastIndex = tokens.lastIndex;
    for (let match; (match = target.exec(text));) {
      found.push(match.slice(1).find((value) => value !== undefined));
      tokens.lastIndex = target.lastIndex;
      const comma = /^\s*,/.exec(text.slice(tokens.lastIndex));
      if (token[1] !== 'import' || !comma) break;
      target.lastIndex += comma[0].length;
    }
  }
  return found;
}

/** Package names from literal style directives. Relative paths and Sass built-ins do not name npm packages. */
export function styleUses(texts) {
  return [...texts].filter(([path]) => isStyle(path)).map(([path, text]) => {
    const names = new Set();
    for (const target of specifiers(text)) {
      const specifier = target.replace(/^~/, '');
      if (specifier.startsWith('.')) continue;
      const found = classify(specifier);
      if (found.kind === 'package') names.add(found.name);
    }
    return { path, jsx: false, names };
  });
}
