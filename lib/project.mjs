// Works out what to map in an unknown codebase: source folders, tests, import aliases, name and optional limits.
// Everything can be overridden in an optional `.code-map.json` at the repository root.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import ts from 'typescript';

export const codeExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const testPattern = /(^|\/)(__tests__|__mocks__|tests?|e2e|spec|specs|cypress|playwright)\/|\.(test|spec|e2e)\.[cm]?[jt]sx?$/;
const ignoredDirectories = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'public', 'docs', 'vendor', 'tmp',
  'temp', 'storybook-static', 'generated', '__generated__']);

export const defaults = {
  descriptions: 'docs/code-map/descriptions.json',
  out: 'docs/code-map/code-map.html',
  history: 400,
};

export function loadConfig(repository) {
  const path = join(repository, '.code-map.json');
  if (!existsSync(path)) return { ...defaults };
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('.code-map.json must be an object');
  return { ...defaults, ...parsed };
}

export function isCode(path) {
  return codeExtensions.some((extension) => path.endsWith(extension)) && !/\.d\.[cm]?ts$/.test(path);
}

function ignored(path) {
  return path.split('/').slice(0, -1).some((part) => part.startsWith('.') || ignoredDirectories.has(part));
}

export function isTest(path) { return isCode(path) && !ignored(path) && testPattern.test(path); }

/** `src/` when it exists; otherwise every top-level folder holding code (Next.js apps: app, components, lib…). */
export function detectRoots(paths, config) {
  if (Array.isArray(config.roots) && config.roots.length > 0) return config.roots.map((root) => root.replace(/\/+$/, ''));
  const candidates = paths.filter((path) => isCode(path) && !isTest(path) && !ignored(path));
  if (candidates.some((path) => path.startsWith('src/'))) return ['src'];
  const folders = [...new Set(candidates.filter((path) => path.includes('/')).map((path) => path.split('/')[0]))]
    .filter((folder) => !['scripts', 'config', 'configs'].includes(folder));
  return folders.length > 0 ? folders.sort() : ['.'];
}

export function underRoots(path, roots) {
  return roots.some((root) => root === '.' ? !path.includes('/') || !ignored(path) : path.startsWith(root + '/'));
}

export function selectSources(paths, roots) {
  return paths.filter((path) => isCode(path) && !isTest(path) && !ignored(path) && underRoots(path, roots));
}

export function selectTests(paths) { return paths.filter(isTest); }

export function projectName(texts, repository) {
  try {
    const name = JSON.parse(texts.get('package.json') ?? '{}').name;
    if (typeof name === 'string' && name.length > 0) return name;
  } catch { /* not a Node project, or invalid package.json */ }
  return basename(repository);
}

/** Path aliases such as `@/*` from tsconfig.json or jsconfig.json (comments allowed). */
export function readAliases(texts) {
  for (const file of ['tsconfig.json', 'jsconfig.json']) {
    const text = texts.get(file);
    if (text === undefined) continue;
    const { config } = ts.parseConfigFileTextToJson(file, text);
    const options = config?.compilerOptions ?? {};
    const baseUrl = typeof options.baseUrl === 'string' ? options.baseUrl.replace(/^\.\/?/, '').replace(/\/$/, '') : '';
    const paths = typeof options.paths === 'object' && options.paths !== null ? options.paths : {};
    const aliases = Object.entries(paths).flatMap(([pattern, targets]) => (Array.isArray(targets) ? targets : [])
      .map((target) => ({ pattern, target: join(baseUrl, String(target).replace(/^\.\//, '')).replace(/\\/g, '/') })));
    return { baseUrl, aliases };
  }
  return { baseUrl: null, aliases: [] };
}

/** Optional line budgets per top-level folder: given in the config, or read from a size-check script. */
export function readBudgets(config, texts) {
  if (config.budgets && typeof config.budgets === 'object') return config.budgets;
  const source = typeof config.budgetsFrom === 'string' ? texts.get(config.budgetsFrom) : undefined;
  if (source === undefined) return {};
  const budgets = {};
  const block = /limits[^{]*\{([^}]*)\}/.exec(source)?.[1] ?? '';
  for (const match of block.matchAll(/(\w+):\s*([\d_]+)/g)) budgets[match[1]] = Number(match[2].replace(/_/g, ''));
  const total = /total > ([\d_]+)/.exec(source)?.[1];
  if (total !== undefined) budgets.total = Number(total.replace(/_/g, ''));
  return budgets;
}
