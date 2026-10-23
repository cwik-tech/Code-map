// Works out what to map in an unknown codebase: source folders, tests, import aliases, name and optional limits.
// Everything can be overridden in an optional `.code-map.json` at the repository root.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, posix } from 'node:path';
import ts from 'typescript';

export const codeExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const testPattern = /(^|\/)(__tests__|__mocks__|tests?|e2e|spec|specs|cypress|playwright)\/|\.(test|spec|e2e)\.[cm]?[jt]sx?$/;
const ignoredDirectories = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'public', 'docs', 'vendor', 'tmp',
  'temp', 'storybook-static', 'generated', '__generated__']);

export const defaults = {
  descriptions: 'docs/code-map/descriptions.json',
  testLabels: 'docs/code-map/test-labels.json',
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

/** Test scripts in other languages (for example `tests/e2e/run-smoke.sh`): listed as tests that the scan cannot read. */
export function isTestScript(path) {
  return !isCode(path) && !ignored(path) && /(^|\/)(__tests__|tests?|e2e|spec|specs|smoke)\//.test(path) && !/(^|\/)(__)?fixtures?(__)?\//.test(path)
    && /\.(sh|bash|zsh|py|rb|ps1)$/.test(path);
}

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

/** Source files in other languages that the analysis does not read, counted by extension. Ignored folders are left out. */
const otherLanguages = new Set(['.py', '.pyi', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.scala', '.swift', '.m', '.mm', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.cs', '.fs', '.php', '.vue', '.svelte', '.astro', '.mdx', '.dart', '.ex', '.exs', '.erl', '.clj', '.lua', '.jl']);
export function unsupportedFiles(paths) {
  const counts = {};
  for (const path of paths) {
    const extension = posix.extname(path).toLowerCase();
    if (otherLanguages.has(extension) && !ignored(path)) counts[extension] = (counts[extension] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

export function projectName(texts, repository) {
  try {
    const name = JSON.parse(texts.get('package.json') ?? '{}').name;
    if (typeof name === 'string' && name.length > 0) return name;
  } catch { /* not a Node project, or invalid package.json */ }
  return basename(repository);
}

/** Read configs against the mapped files, never the checked-out filesystem. */
export function readAliases(texts) {
  const { absolute, host } = snapshotConfigHost(texts);
  const configPaths = [...absolute.keys()].filter((path) => /\/(?:tsconfig|jsconfig)(?:\.[^/]*)?\.json$/.test(path));
  const projects = [], seen = new Set();
  const read = (path) => {
    if (seen.has(path)) return;
    seen.add(path);
    const parsed = ts.getParsedCommandLineOfConfigFile(path, undefined, host);
    if (!parsed) return;
    projects.push({ path, directory: posix.dirname(path), files: new Set(parsed.fileNames), options: parsed.options });
    for (const reference of parsed.projectReferences ?? []) {
      const target = reference.path.endsWith('.json') ? reference.path : posix.join(reference.path, 'tsconfig.json');
      if (absolute.has(target)) read(target);
    }
  };
  for (const path of configPaths.sort()) read(path);
  projects.sort((a, b) => b.directory.length - a.directory.length
    || Number(!a.path.endsWith('/tsconfig.json')) - Number(!b.path.endsWith('/tsconfig.json'))
    || a.path.localeCompare(b.path));
  return { baseUrl: null, aliases: [], projects };
}

function snapshotConfigHost(texts) {
  const absolute = new Map([...texts].map(([path, text]) => [posix.resolve('/', path), text]));
  const directories = new Map();
  for (const path of absolute.keys()) {
    let child = path, directory = posix.dirname(child);
    while (child !== directory) {
      if (!directories.has(directory)) directories.set(directory, { files: new Set(), directories: new Set() });
      const entries = directories.get(directory);
      (child === path ? entries.files : entries.directories).add(posix.basename(child));
      child = directory; directory = posix.dirname(child);
    }
  }
  const host = {
    useCaseSensitiveFileNames: true,
    getCurrentDirectory: () => '/',
    fileExists: (path) => absolute.has(posix.normalize(path)),
    readFile: (path) => absolute.get(posix.normalize(path)),
    // TypeScript 6.0.3 uses this same matcher in sys.readDirectory. Supply snapshot
    // directory entries so include/exclude and inherited paths stay compiler-defined.
    readDirectory: (path, extensions, excludes, includes, depth) => ts.matchFiles(path, extensions, excludes, includes,
      true, '/', depth, (directory) => {
        const entries = directories.get(posix.resolve('/', directory));
        return { files: [...(entries?.files ?? [])], directories: [...(entries?.directories ?? [])] };
      }, (path) => path),
    // Malformed configs have no usable project; mapping other files can continue.
    onUnRecoverableConfigFileDiagnostic: () => undefined,
  };
  return { absolute, host };
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
