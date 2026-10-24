// Works out what to map in an unknown codebase: source folders, tests, import aliases, name and optional limits.
// Everything can be overridden in an optional `.code-map.json` at the repository root. Its layer and ownership settings are checked here.
import { safeguardProblems } from './declared-patterns.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, posix } from 'node:path';
import ts from 'typescript';
import { timingOptions } from './bench-report.mjs';

import { trustPolicy } from './trust.mjs';
import { trustedKeys } from './worker/signing.mjs';
import { supplyPolicy } from './supply/policy.mjs';
import { migrationProblems } from './migrations.mjs';
import { isOwner } from './codeowners.mjs';

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
  timingOptions(parsed.timings);
  trustedKeys(parsed.trustedRunKeys);
  trustPolicy(parsed.trust);
  supplyPolicy(parsed.supplyChain); // throws for an invalid policy, so that it is never ignored in silence
  const problems = settingsProblems(parsed);
  if (problems.length) throw new Error(problems.join(' '));
  return { ...defaults, ...parsed };
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const layerName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Each pair of layers is one rule, so the number of rules grows with the square of this limit: 50 layers give 1225 rules. */
const maxLayers = 50;

/** Why a path glob of the settings is unsafe, or null. The globs use the syntax of lib/glob.mjs. */
function globProblem(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return 'Must be a nonempty string of at most 1024 characters.';
  if (value.includes('\u0000')) return 'Must not contain a NUL byte.';
  if (value.includes('\\')) return 'Must use "/" separators, not backslashes.';
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return 'Must be relative to the repository root.';
  if (value.split('/').includes('..')) return 'Must not contain a ".." segment.';
  return null;
}

/**
 * Every problem of the "layers", "allowed", "layerExceptions" and "ownership" settings, each with its field path. An empty list means
 * that they are valid. Code-map checks them before an analysis, so an invalid setting never gives a partial layer model.
 */
export function settingsProblems(config) {
  const problems = [...migrationProblems(config.migrations), ...safeguardProblems(config.safeguards)], problem = (path, text) => problems.push(`${path}: ${text}`), names = new Map();
  if (config.typeCheck !== undefined && typeof config.typeCheck !== 'boolean') problem('typeCheck', 'Must be a boolean.');
  if (config.typeBudgetMs !== undefined && (!Number.isInteger(config.typeBudgetMs) || config.typeBudgetMs < 1 || config.typeBudgetMs > 120000)) problem('typeBudgetMs', 'Must be from 1 to 120000.');
  if (config.api !== undefined && (!isRecord(config.api) || !['allowed', 'forbidden'].includes(config.api.breaking) || Object.keys(config.api).some((key) => key !== 'breaking'))) problem('api', 'Must be { breaking: allowed | forbidden }.');
  const unknown = (value, known, path, text) => { for (const key of Object.keys(value)) if (!known.includes(key)) problem(path, `Unknown field "${key}". ${text}`); };
  if (config.layers !== undefined && !Array.isArray(config.layers)) problem('layers', 'Must be a list of { "name", "paths" } objects, from the top layer to the bottom layer.');
  else if (config.layers?.length > maxLayers) problem('layers', `Must have at most ${maxLayers} layers. It has ${config.layers.length}.`);
  const globs = new Map();
  if (Array.isArray(config.layers)) config.layers.forEach((layer, index) => {
    const path = `layers[${index}]`;
    if (!isRecord(layer)) { problem(path, 'Must be an object { "name", "paths" }.'); return; }
    unknown(layer, ['name', 'paths'], path, 'A layer has only "name" and "paths".');
    if (typeof layer.name !== 'string' || !layerName.test(layer.name)) problem(`${path}.name`, 'Must be 1 to 64 letters, digits, ".", "_" or "-", and start with a letter or a digit.');
    else if (names.has(layer.name)) problem(`${path}.name`, `The name "${layer.name}" is also the name of layers[${names.get(layer.name)}].`);
    else names.set(layer.name, index);
    if (!Array.isArray(layer.paths) || layer.paths.length === 0) { problem(`${path}.paths`, 'Must be a nonempty list of globs.'); return; }
    layer.paths.forEach((glob, at) => {
      const text = globProblem(glob), other = globs.get(glob);
      if (text) problem(`${path}.paths[${at}]`, text);
      else if (other !== undefined && other !== index) problem(`${path}.paths[${at}]`, `The glob "${glob}" is also in the layer "${config.layers[other].name}". Each file must match the paths of one layer at most.`);
      else globs.set(glob, index);
    });
  });
  for (const field of ['allowed', 'layerExceptions']) if (config[field] !== undefined) {
    if (!Array.isArray(config.layers)) problem(field, 'Needs "layers".');
    else if (!Array.isArray(config[field])) problem(field, 'Must be a list of { "from", "to" } objects.');
    else config[field].forEach((entry, index) => {
      const path = `${field}[${index}]`;
      if (!isRecord(entry)) { problem(path, 'Must be an object { "from", "to" } with two layer names.'); return; }
      unknown(entry, ['from', 'to'], path, 'An exception has only "from" and "to".');
      const known = ['from', 'to'].filter((key) => {
        if (typeof entry[key] !== 'string') problem(`${path}.${key}`, 'Must be the name of a layer.');
        else if (!names.has(entry[key])) problem(`${path}.${key}`, `"${entry[key]}" is not the name of a layer.`);
        else return true;
        return false;
      });
      if (known.length < 2) return;
      if (entry.from === entry.to) problem(path, '"from" and "to" name the same layer. Files of one layer can always import each other.');
      else if (names.get(entry.from) < names.get(entry.to)) problem(path, `"${entry.from}" is above "${entry.to}", and a higher layer can always import a lower layer. "from" must name the lower layer.`);
    });
  }
  ownershipProblems(config.ownership, problem, unknown);
  return problems;
}

function ownershipProblems(value, problem, unknown) {
  if (value === undefined) return;
  if (!isRecord(value)) { problem('ownership', 'Must be an object { "forbidCrossOwnerImports", "allowed" }.'); return; }
  unknown(value, ['forbidCrossOwnerImports', 'allowed'], 'ownership', 'The ownership settings have only "forbidCrossOwnerImports" and "allowed".');
  if (value.forbidCrossOwnerImports !== undefined && typeof value.forbidCrossOwnerImports !== 'boolean') problem('ownership.forbidCrossOwnerImports', 'Must be true or false.');
  if (value.allowed !== undefined && !Array.isArray(value.allowed)) { problem('ownership.allowed', 'Must be a list of { "from", "to" } objects.'); return; }
  (value.allowed ?? []).forEach((entry, index) => {
    const path = `ownership.allowed[${index}]`;
    if (!isRecord(entry)) { problem(path, 'Must be an object { "from", "to" } with two owners.'); return; }
    unknown(entry, ['from', 'to'], path, 'An exception has only "from" and "to".');
    const valid = ['from', 'to'].filter((key) => {
      if (isOwner(entry[key])) return true;
      problem(`${path}.${key}`, typeof entry[key] === 'string' ? `"${entry[key]}" is not a user (@name), a team (@org/name) or an email address.` : 'Must be a user (@name), a team (@org/name) or an email address.');
      return false;
    });
    if (valid.length === 2 && entry.from.toLowerCase() === entry.to.toLowerCase()) problem(path, '"from" and "to" name the same owner. Files of one owner can always import each other.');
  });
}

export function isCode(path) {
  return codeExtensions.some((extension) => path.endsWith(extension)) && !/\.d\.[cm]?ts$/.test(path);
}

/** True for a path in a folder that the analysis skips: node_modules, build output, docs, dot folders and others. */
export function ignored(path) {
  const folders = path.split('/').slice(0, -1);
  return folders.some((part, index) => part.startsWith('.') || (ignoredDirectories.has(part)
    && !(part === 'docs' && folders.slice(0, index).some((folder) => folder === 'app' || folder === 'pages'))));
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

/** Code files outside the source roots that are not tests: the analysis does not read their imports. Ignored folders are left out. */
export function outsideRoots(paths, roots) {
  const outside = paths.filter((path) => isCode(path) && !isTest(path) && !ignored(path) && !underRoots(path, roots)).sort();
  return { count: outside.length, paths: outside.slice(0, 50) };
}

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
  return { baseUrl: null, aliases: [], projects, host };
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
