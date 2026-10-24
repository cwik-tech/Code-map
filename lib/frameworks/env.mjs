// Environment variables (C26): the reads in the parsed code files, and the names that the template files of each package
// declare. Code-map reads only the template files below. It never reads .env, .env.local, .env.production or another file
// that can hold secret values, and it keeps only the names of a template, never a value. Syntax only: no source runs.
import { posix } from 'node:path';
import ts from 'typescript';

/** The template files at the root of a package.json folder. Code-map reads no other env file. */
export const envTemplates = ['.env.example', '.env.sample', '.env.template', '.env.defaults'];
/** A larger template file is untrusted input that Code-map does not read. */
const maxTemplateBytes = 256 * 1024;
/** The names that a platform, a runtime or a build tool sets. They are not leads. This is the only list of them. */
const platformNames = new Set(['NODE_ENV', 'CI', 'NEXT_RUNTIME', 'NEXT_PHASE', 'NEXT_DEPLOYMENT_ID', 'VERCEL', 'NETLIFY', 'PORT', 'HOSTNAME', 'HOME', 'PATH', 'PWD',
  'USER', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'TZ', 'LANG', 'NODE_OPTIONS', 'GITHUB_ACTIONS', 'MODE', 'BASE_URL', 'DEV', 'PROD', 'SSR']);
const platformPrefixes = ['VERCEL_', 'NEXT_PUBLIC_VERCEL_', '__NEXT_', 'GITHUB_', 'RUNNER_', 'NETLIFY_', 'AWS_LAMBDA_', 'npm_'];

/** True for a name that the platform sets, such as NODE_ENV, CI or VERCEL_URL. */
export const isPlatformName = (name) => platformNames.has(name) || platformPrefixes.some((prefix) => name.startsWith(prefix));
const isTemplate = (path) => envTemplates.includes(posix.basename(path));
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const lineOf = (source, node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

/** The folders of the package.json files outside node_modules, deepest first. */
const packageFolders = (paths) => [...new Set(paths.filter((path) => posix.basename(path) === 'package.json' && !path.split('/').includes('node_modules')).map(posix.dirname))]
  .sort((a, b) => Number(a === '.') - Number(b === '.') || b.length - a.length || (a < b ? -1 : 1));
/** The deepest package folder that holds a path, or null. */
const packageOf = (folders, path) => folders.find((folder) => folder === '.' || path.startsWith(`${folder}/`)) ?? null;

/** The template paths that Code-map reads: one of `envTemplates` in the folder of a package.json. */
function envTemplatePaths(paths) {
  const folders = new Set(packageFolders(paths));
  return paths.filter((path) => isTemplate(path) && !path.split('/').includes('node_modules') && folders.has(posix.dirname(path))).sort();
}

/**
 * The names that one template declares, with their lines: the text before `=` on each line. Comments, blank lines and the
 * lines of a quoted value that spans lines give no name. The value is never kept.
 */
export function templateEntries(text) {
  const names = [], seen = new Set();
  let open = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    if (open) { if (raw.includes(open)) open = null; return; }
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(raw);
    if (!match || raw.trim().startsWith('#')) return;
    const quote = /^["'`]/.exec(match[2])?.[0];
    if (quote && !match[2].slice(1).includes(quote)) open = quote;
    if (!seen.has(match[1])) { seen.add(match[1]); names.push({ name: match[1], line: index + 1 }); }
  });
  return names;
}

/**
 * The templates of a snapshot. `stat(paths)` gives `{ link, file, size }` for each path, before a read (refer to
 * sourceReader), and `read(paths)` gives the texts. Code-map does not follow a symlink, in the working tree or in a commit,
 * because it can point to a file with secret values. It reads no file that is not a regular file or that is too large.
 * Each text stays in this function.
 */
export function templateFacts(paths, read, stat) {
  const wanted = envTemplatePaths(paths), info = stat(wanted);
  const skip = (item) => (!item || (!item.link && !item.file) ? 'missing' : item.link ? 'symlink' : item.size > maxTemplateBytes ? 'too-large' : null);
  const texts = read(wanted.filter((path) => skip(info.get(path)) === null));
  return wanted.map((path) => {
    const state = skip(info.get(path)), text = texts.get(path);
    if (state) return { path, state, names: [] };
    if (text === undefined) return { path, state: 'missing', names: [] };
    return Buffer.byteLength(text) > maxTemplateBytes ? { path, state: 'too-large', names: [] } : { path, state: 'read', names: templateEntries(text) };
  });
}

/** 'process.env' or 'import.meta.env' when the node is that object, else null. */
function envObject(node) {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== 'env') return null;
  const owner = node.expression;
  if (ts.isIdentifier(owner) && owner.text === 'process') return 'process.env';
  return ts.isMetaProperty(owner) && owner.keywordToken === ts.SyntaxKind.ImportKeyword && owner.name.text === 'meta' ? 'import.meta.env' : null;
}

const unwrap = (node) => { while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression; return node; };
/** A plain assignment or a delete changes the variable. It is not a read. */
const isWrite = (node) => (ts.isBinaryExpression(node.parent) && node.parent.left === node && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) || ts.isDeleteExpression(node.parent);

/** The name of one element of `const { A, B: b, ['C']: c, ...rest } = process.env`, or null for a rest or computed element. */
function elementName(element) {
  if (element.dotDotDotToken) return { name: null, form: 'rest' };
  const key = element.propertyName ?? element.name;
  if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) return { name: key.text, form: 'destructuring' };
  if (ts.isComputedPropertyName(key) && ts.isStringLiteralLike(key.expression)) return { name: key.expression.text, form: 'destructuring' };
  return { name: null, form: 'computed' };
}

/**
 * The environment reads of one parsed file, in source order, or null when it has none. `process.env.NAME`,
 * `process.env['NAME']`, `import.meta.env.NAME` and a destructuring of `process.env` give a name. A computed name and a rest
 * element give a read with the name null.
 */
export function envReads(source) {
  if (!source.text.includes('env')) return null;
  const reads = [];
  const visit = (node) => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.initializer && ts.isObjectBindingPattern(node.name)) {
      const via = envObject(unwrap(node.initializer));
      if (via) for (const element of node.name.elements) reads.push({ ...elementName(element), via, line: lineOf(source, element) });
    }
    const via = (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) ? envObject(node.expression) : null;
    if (via && !isWrite(node)) {
      if (ts.isPropertyAccessExpression(node)) reads.push({ name: node.name.text, form: 'property', via, line: lineOf(source, node) });
      else if (ts.isStringLiteralLike(node.argumentExpression)) reads.push({ name: node.argumentExpression.text, form: 'element', via, line: lineOf(source, node) });
      else reads.push({ name: null, form: 'computed', via, line: lineOf(source, node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return reads.length ? reads.map(({ name, via, form, line }) => ({ name, via, form, line })) : null;
}

/**
 * The environment report of one analysis. `files` and `testFiles` are parsed files with their `env` reads, `templates` comes
 * from templateFacts, and `paths` is every path of the snapshot. The leads of the two rules:
 * - undeclared: a source file reads a name that no template of its package declares, when its package has a template.
 * - unused: a template declares a name that no parsed source or test file reads.
 * Platform names are never leads. Source and test files count as readers and can get undeclared leads.
 */
export function analyzeEnv({ paths = [], templates = [], files = [], testFiles = [] } = {}) {
  const folders = packageFolders(paths);
  const list = templates.map((item) => ({ path: item.path, package: packageOf(folders, item.path), state: item.state, names: item.names })).sort(byPath);
  const reads = [...files.map((file) => [file, false]), ...testFiles.map((file) => [file, true])]
    .flatMap(([file, test]) => (file.env ?? []).map((read) => ({ path: file.path, ...read, test }))).sort((a, b) => byPath(a, b) || a.line - b.line);
  const names = new Map(), entry = (name) => names.get(name) ?? names.set(name, { name, platform: isPlatformName(name), reads: 0, files: new Set(), templates: new Set() }).get(name);
  for (const read of reads) if (read.name !== null) { const item = entry(read.name); item.reads++; item.files.add(read.path); }
  for (const template of list) for (const { name } of template.names) entry(name).templates.add(template.path);
  // For each package: its template paths, whether Code-map read all of them, and the names that they declare.
  const packages = new Map(), dynamic = new Map(), undeclared = new Map(), unused = [];
  for (const template of list) {
    const item = packages.get(template.package) ?? packages.set(template.package, { paths: [], read: true, names: new Set() }).get(template.package);
    item.paths.push(template.path);
    item.read &&= template.state === 'read';
    for (const { name } of template.names) item.names.add(name);
  }
  for (const read of reads) {
    const owner = packageOf(folders, read.path), own = packages.get(owner);
    if (read.name === null) { dynamic.set(owner, (dynamic.get(owner) ?? 0) + 1); continue; }
    // Without a template, or with a template that Code-map did not read, the package gives no lead.
    if (isPlatformName(read.name) || !own?.read || own.names.has(read.name)) continue;
    const key = `${read.path}\n${read.name}`;
    if (!undeclared.has(key)) undeclared.set(key, { path: read.path, package: owner, name: read.name, lines: [], templates: own.paths });
    if (!undeclared.get(key).lines.includes(read.line)) undeclared.get(key).lines.push(read.line);
  }
  for (const template of list) for (const { name, line } of template.names) {
    if (!isPlatformName(name) && entry(name).reads === 0) unused.push({ path: template.path, package: template.package, name, line, dynamic: dynamic.get(template.package) ?? 0 });
  }
  const inventory = [...names.values()].sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((item) => ({ ...item, files: [...item.files].sort(), templates: [...item.templates].sort() }));
  return { templates: list, reads, names: inventory, leads: { undeclared: [...undeclared.values()], unused } };
}
