// Syntax-only Electron security, packaging entries and platform inventory. No project code executes.
import ts from 'typescript';
import { posix } from 'node:path';
import { isCode, isTest } from '../project.mjs';
import { syntax } from './electron-ipc-syntax.mjs';
import { electronMajor } from './electron-version.mjs';

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const literal = (node) => node && ts.isStringLiteral(node) ? node.text : null;
const name = (node) => node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : null;
const member = (node, method) => node && ts.isPropertyAccessExpression(node) && node.name.text === method;
const normalize = (path) => posix.relative('/', posix.resolve('/', path));
const boolean = (node) => node?.kind === ts.SyntaxKind.TrueKeyword ? true : node?.kind === ts.SyntaxKind.FalseKeyword ? false : null;
const unsafe = { nodeIntegration: true, contextIsolation: false, sandbox: false, webSecurity: false, allowRunningInsecureContent: true };
const unknown = () => ({ state: 'UNKNOWN', value: null, source: 'unknown' });

/** Snapshot paths, source texts and parsed compiler configurations are the only inputs. */
export function analyzeElectron(analysis, { texts, aliases }) {
  const packages = [];
  let rootManifest = null;
  for (const [path, text] of texts) {
    if (posix.basename(path) !== 'package.json') continue;
    let value;
    try { value = JSON.parse(text); } catch { continue; /* invalid manifests have no readable dependency */ }
    if (!record(value)) continue;
    if (path === 'package.json') rootManifest = value;
    for (const field of ['dependencies', 'devDependencies']) if (record(value[field]) && Object.hasOwn(value[field], 'electron')) {
      const range = value[field].electron;
      packages.push({ path, field, version: typeof range === 'string' ? range : null, major: electronMajor(range) });
      break;
    }
  }
  if (!packages.length) return undefined;
  const { checker, sources: boundSources } = syntax(texts, analysis.files);
  const sourceByPath = new Map(boundSources.map((source) => [source.fileName, source]));
  packages.sort((a, b) => a.path.localeCompare(b.path));
  const sources = new Set(analysis.files.map((file) => file.path)), entries = [], unresolvedEntries = [], windows = [], platforms = [], external = [], permissions = new Set();
  const owner = (path) => packages.filter((p) => p.path === 'package.json' || path.startsWith(posix.dirname(p.path) + '/')).sort((a, b) => b.path.length - a.path.length)[0];
  const sourceOf = (target) => {
    const paths = new Set([normalize(target)]);
    for (const project of aliases?.projects ?? []) {
      const { outDir, rootDir } = project.options;
      if (typeof outDir !== 'string' || typeof rootDir !== 'string') continue;
      const out = normalize(outDir), normalized = normalize(target);
      if (normalized.startsWith(out + '/')) paths.add(posix.join(normalize(rootDir), normalized.slice(out.length + 1)));
    }
    const found = new Set();
    for (const path of paths) {
      if (sources.has(path)) found.add(path);
      const stem = path.replace(/\.(?:[cm]?js|jsx)$/, '');
      for (const extension of ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx']) {
        if (sources.has(stem + extension)) found.add(stem + extension);
      }
    }
    return found.size === 1 ? [...found][0] : null;
  };
  const entry = (role, target, from, line = null) => {
    const path = typeof target === 'string' ? sourceOf(target) : null;
    if (!path) unresolvedEntries.push({ role, target, from, line, reason: target === null ? 'dynamic-path' : 'not-resolved' });
    else if (!entries.some((item) => item.path === path && item.role === role)) entries.push({ path, role });
    return path;
  };
  const main = typeof rootManifest?.main === 'string' ? entry('main', rootManifest.main, 'package.json') : entry('main', null, 'package.json');
  const outputDirs = (path) => {
    const result = [];
    for (const project of aliases?.projects ?? []) {
      if (!project.files.has(posix.resolve('/', path))) continue;
      const { rootDir, outDir } = project.options;
      if (typeof rootDir !== 'string' || typeof outDir !== 'string') continue;
      const root = normalize(rootDir);
      if (path.startsWith(root + '/')) result.push(posix.dirname(posix.join(normalize(outDir), path.slice(root.length + 1))));
    }
    return result.length ? [...new Set(result)] : [posix.dirname(path)];
  };
  for (const [path, text] of texts) {
    if (!isCode(path) || isTest(path) || /\.d\.[cm]?ts$/.test(path)) continue;
    const pkg = owner(path);
    if (!pkg) continue;
    const source = sourceByPath.get('/snapshot/' + path) ?? ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true), constants = new Map();
    const walk = (node, visit) => { visit(node); ts.forEachChild(node, (child) => walk(child, visit)); };
    walk(source, (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (node.parent.flags & ts.NodeFlags.Const)) {
        const list = constants.get(node.name.text) ?? []; list.push(node.initializer); constants.set(node.name.text, list);
      }
    });
    const resolve = (node, depth = 0) => {
      if (!node || depth > 12) return null;
      if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return resolve(node.expression, depth + 1);
      if (ts.isIdentifier(node)) { const values = constants.get(node.text); return values?.length === 1 ? resolve(values[0], depth + 1) : null; }
      return node;
    };
    // Spreads or computed properties leave earlier properties unknown. A later explicit property is readable.
    const property = (object, key) => {
      const node = resolve(object);
      if (!node || !ts.isObjectLiteralExpression(node)) return { missing: false, node: null };
      let result = { missing: true, node: null };
      for (const prop of node.properties) {
        if (ts.isSpreadAssignment(prop) || (prop.name && ts.isComputedPropertyName(prop.name))) result = { missing: false, node: null };
        else if (name(prop.name) === key) result = { missing: false, node: ts.isPropertyAssignment(prop) ? prop.initializer : ts.isShorthandPropertyAssignment(prop) ? prop.name : null };
      }
      return result;
    };
    const pathMethod = (expression) => {
      if (expression.getText(source) === 'path.join') return 'join';
      if (!ts.isIdentifier(expression)) return null;
      const decl = checker.getSymbolAtLocation(expression)?.declarations?.[0];
      if (!decl || !ts.isImportSpecifier(decl) || decl.isTypeOnly || decl.parent.parent.isTypeOnly
        || !['path', 'node:path'].includes(decl.parent.parent.parent.moduleSpecifier.text)) return null;
      const method = (decl.propertyName ?? decl.name).text;
      return ['join', 'resolve'].includes(method) ? method : null;
    };
    const urlHelper = (expression) => {
      const namespace = member(expression, 'fileURLToPath');
      const local = namespace ? expression.expression : expression;
      if (!ts.isIdentifier(local)) return false;
      const decl = checker.getSymbolAtLocation(local)?.declarations?.[0];
      if (!decl) return false;
      if (namespace && ts.isNamespaceImport(decl)) {
        return !decl.parent.isTypeOnly && ['url', 'node:url'].includes(decl.parent.parent.moduleSpecifier.text);
      }
      return !namespace && ts.isImportSpecifier(decl) && !decl.isTypeOnly && !decl.parent.parent.isTypeOnly
        && (decl.propertyName ?? decl.name).text === 'fileURLToPath'
        && ['url', 'node:url'].includes(decl.parent.parent.parent.moduleSpecifier.text);
    };
    const esmPreload = (value) => {
      if (!value || !ts.isCallExpression(value) || !urlHelper(value.expression) || value.arguments.length !== 1) return null;
      const url = value.arguments[0];
      if (!ts.isNewExpression(url) || !ts.isIdentifier(url.expression) || url.expression.text !== 'URL'
        || checker.getSymbolAtLocation(url.expression) || url.arguments?.length !== 2) return null;
      const [relative, base] = url.arguments, target = literal(relative);
      if (target === null || !/^(?:\.\.?\/)/.test(target) || !member(base, 'url')
        || !ts.isMetaProperty(base.expression) || base.expression.keywordToken !== ts.SyntaxKind.ImportKeyword
        || base.expression.name.text !== 'meta') return null;
      return target;
    };
    const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const platformSet = new Set();
    const platformRead = (node) => node && ((member(node, 'platform') && node.expression.getText(source) === 'process')
      || (ts.isCallExpression(node) && member(node.expression, 'platform') && node.expression.expression.getText(source) === 'os'));
    walk(source, (node) => {
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind)) {
        const value = platformRead(node.left) ? literal(node.right) : platformRead(node.right) ? literal(node.left) : null;
        if (value !== null) platformSet.add(value);
      }
      if (ts.isCallExpression(node)) {
        if (member(node.expression, 'setPermissionRequestHandler')) permissions.add(path);
        if (member(node.expression, 'openExternal') && node.expression.expression.getText(source) === 'shell' && literal(node.arguments[0]) === null) external.push({ path, line: lineOf(node) });
      }
      if (!ts.isNewExpression(node) || !['BrowserWindow', 'BrowserView'].includes(node.expression.getText(source))) return;
      const line = lineOf(node), options = node.arguments?.[0], prefs = options ? property(options, 'webPreferences') : { missing: true, node: null };
      const preferences = {};
      for (const key of Object.keys(unsafe)) {
        const item = prefs.missing ? { missing: true, node: null } : property(prefs.node, key);
        const value = boolean(resolve(item.node));
        if (value !== null) preferences[key] = { state: 'KNOWN', value, source: 'explicit' };
        else if (item.missing && pkg.major !== null) {
          const defaults = { nodeIntegration: pkg.major < 5, contextIsolation: pkg.major >= 12, sandbox: pkg.major >= 20, webSecurity: true, allowRunningInsecureContent: false };
          preferences[key] = { state: 'KNOWN', value: defaults[key], source: 'default' };
        } else preferences[key] = unknown();
      }
      windows.push({ path, line, kind: node.expression.getText(source), preferences });
      const preload = property(prefs.node, 'preload');
      if (prefs.missing || preload.missing) return;
      const value = resolve(preload.node), direct = literal(value);
      if (direct !== null) entry('preload', direct, path, line);
      else if (value && ts.isCallExpression(value) && pathMethod(value.expression) && value.arguments[0]?.getText(source) === '__dirname'
        && value.arguments.length >= 2 && value.arguments.slice(1).every((arg) => literal(arg) !== null)) {
        const targets = outputDirs(path).map((dir) => normalize(posix[pathMethod(value.expression)]('/' + dir, ...value.arguments.slice(1).map(literal))));
        const resolved = [...new Set(targets.map(sourceOf).filter(Boolean))];
        entry('preload', resolved.length === 1 ? resolved[0] : targets[0], path, line);
      } else {
        const relative = esmPreload(value);
        const targets = relative === null ? [] : outputDirs(path).map((dir) => normalize(posix.join(dir, relative)));
        const resolved = [...new Set(targets.map(sourceOf).filter(Boolean))];
        entry('preload', resolved.length === 1 ? resolved[0] : targets[0] ?? null, path, line);
      }
    });
    if (platformSet.size) platforms.push({ path, platforms: [...platformSet].sort() });
  }
  // Main-process imports count permission handlers. A renderer handler does not cover a main-process window.
  const mainFiles = new Set(main ? [main] : windows.map((w) => w.path));
  const queue = [...mainFiles], byPath = new Map(analysis.files.map((file) => [file.path, file]));
  for (let i = 0; i < queue.length; i++) for (const edge of byPath.get(queue[i])?.imports ?? []) {
    if (edge.target && edge.kind !== 'type' && !mainFiles.has(edge.target)) { mainFiles.add(edge.target); queue.push(edge.target); }
  }
  const noPermissionHandler = windows.length > 0 && ![...permissions].some((path) => mainFiles.has(path));
  return { detected: true, packages, entries: entries.sort((a, b) => a.path.localeCompare(b.path) || a.role.localeCompare(b.role)), unresolvedEntries,
    windows, platforms: platforms.sort((a, b) => a.path.localeCompare(b.path)), external, noPermissionHandler };
}

/** Add only Electron findings. Other finding identities stay unchanged. */
export function electronFindings(analysis, add) {
  const electron = analysis.frameworks?.electron;
  if (!electron) return;
  const emit = (rule, path, line, identity, text, facts) => add(rule, [path, ...identity], {
    location: { path, line, symbol: null }, paths: [path], text: `${text} This is a static lead.`, facts,
    evidence: [{ path, line, text }],
  });
  const ordinals = new Map();
  for (const window of electron.windows) {
    const ordinal = ordinals.get(window.path) ?? 0; ordinals.set(window.path, ordinal + 1);
    for (const [preference, bad] of Object.entries(unsafe)) if (window.preferences[preference].value === bad) emit('ELECTRON-UNSAFE-WEB-PREFERENCES', window.path, window.line,
      [ordinal, preference], `${window.kind} uses ${preference}: ${bad}.`, { preference, ...window.preferences[preference] });
  }
  if (electron.noPermissionHandler) emit('ELECTRON-NO-PERMISSION-HANDLER', electron.windows[0].path, electron.windows[0].line, [],
    'The project creates windows without a main-process setPermissionRequestHandler call.', {});
  const externalOrdinals = new Map();
  for (const item of electron.external) {
    const ordinal = externalOrdinals.get(item.path) ?? 0; externalOrdinals.set(item.path, ordinal + 1);
    emit('ELECTRON-OPEN-EXTERNAL-UNCHECKED', item.path, item.line, [ordinal], 'shell.openExternal receives a non-literal URL. Check the allowed schemes and hosts.', {});
  }
}

/** Platforms of changed files on both sides, including deleted branches. Information only. */
export function electronInformation(base, head, paths) {
  if (!base.frameworks?.electron && !head.frameworks?.electron) return {};
  const changed = new Set(paths);
  return { electron: { platformsTouched: [...new Set([...(base.frameworks?.electron?.platforms ?? []), ...(head.frameworks?.electron?.platforms ?? [])]
    .filter((file) => changed.has(file.path)).flatMap((file) => file.platforms))].sort() } };
}

/** Summary inventories are bounded. The full analysis retains every item. */
export function electronSummary(analysis) {
  const electron = analysis.frameworks?.electron;
  if (!electron) return {};
  const page = (items) => ({ total: items.length, items: items.slice(0, 20) });
  return { electron: { detected: true, packages: page(electron.packages), entries: page(electron.entries),
    unresolvedEntries: page(electron.unresolvedEntries), windows: page(electron.windows), platforms: page(electron.platforms),
    external: page(electron.external), noPermissionHandler: electron.noPermissionHandler } };
}
