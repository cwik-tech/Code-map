// Unresolved TypeScript aliases belong to the importing file's project, as in createResolver in lib/analyze.mjs.
import { posix } from 'node:path';

/** Matches aliases and baseUrl folders only in the project that owns the importing file. */
export function aliasMatcher(aliases, paths) {
  const matchers = new Map();
  return (from, specifier) => {
    const source = posix.resolve('/', from);
    const project = aliases.projects?.find((item) => item.files.has(source))
      ?? aliases.projects?.find((item) => /\/(?:tsconfig|jsconfig)\.json$/.test(item.path)
        && (item.directory === '/' || source.startsWith(item.directory + '/')));
    if (aliases.projects && !project) return false;
    const key = project ?? aliases;
    if (!matchers.has(key)) {
      const patterns = project ? Object.keys(project.options.paths ?? {}) : (aliases.aliases ?? []).map((item) => item.pattern);
      const baseUrl = project?.options.baseUrl ?? (project ? null : aliases.baseUrl);
      const base = typeof baseUrl === 'string' ? posix.relative('/', posix.resolve('/', baseUrl)) : null;
      const tops = new Set(base === null ? [] : paths.filter((path) => base === '' || path.startsWith(`${base}/`))
        .map((path) => (base === '' ? path : path.slice(base.length + 1)).split('/')[0].replace(/\.[^.]+$/, '')));
      matchers.set(key, (name) => tops.has(name.split('/')[0]) || patterns.some((pattern) => {
        const star = pattern.indexOf('*');
        return star < 0 ? name === pattern : name.startsWith(pattern.slice(0, star)) && name.endsWith(pattern.slice(star + 1));
      }));
    }
    return matchers.get(key)(specifier);
  };
}
