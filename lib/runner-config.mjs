// The test-runner settings that a change can weaken (C27): Vitest and Jest coverage thresholds, excluded test files,
// passWithNoTests, bail and retry. It reads vitest.config.*, vite.config.*, jest.config.* (also jest.config.json) and the "jest"
// field of package.json as text with the TypeScript parser, and it reads only object literals: a setting that code computes is
// UNKNOWN. Pure: no file access and no execution.
import ts from 'typescript';
import { scriptKind } from './analyze.mjs';
import { unwrap } from './source-metrics.mjs';

const UNKNOWN = Symbol('unknown');
const configFile = /(^|\/)(vitest|vite|jest)\.config\.[cm]?[jt]s$|(^|\/)(jest)\.config\.json$/, packageFile = /(^|\/)package\.json$/;
const metrics = ['lines', 'functions', 'branches', 'statements'], wrappers = new Set(['defineConfig', 'defineProject']);
/** The items that a runner excludes without a list: Jest ignores /node_modules/, and Vitest has its own defaults (configDefaults.exclude). */
const defaults = { jest: ['/node_modules/'], vitest: ['...configDefaults.exclude'] }, defaultItem = /^\.\.\.\s*(configDefaults\.exclude|defaultExclude)$/;
const flat = (node) => node.getText().replace(/\s+/g, ' ').slice(0, 160);

/** 'vitest', 'vite', 'jest' or 'package' for a file that can hold runner settings, or null. */
export function runnerKind(path) {
  const match = configFile.exec(path);
  return match ? match[2] ?? match[4] : packageFile.test(path) ? 'package' : null;
}

const keyOf = (property) => property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)) ? property.name.text : null;
/** The value of a property: its node, undefined when the object does not set it, or UNKNOWN. A spread or a computed name can set any property before it. */
function property(node, key) {
  if (node === undefined) return undefined;
  if (node === UNKNOWN || !ts.isObjectLiteralExpression(unwrap(node))) return UNKNOWN;
  let value;
  for (const item of unwrap(node).properties) {
    const name = keyOf(item);
    if (name === null) value = UNKNOWN;
    else if (name === key) value = ts.isPropertyAssignment(item) ? item.initializer : UNKNOWN;
  }
  return value;
}
const path = (node, keys) => keys.reduce((value, key) => property(value, key), node);

function number(node) {
  if (node === undefined || node === UNKNOWN) return node;
  const value = unwrap(node);
  if (ts.isNumericLiteral(value)) return Number(value.text);
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand)) return -Number(value.operand.text);
  return value.kind === ts.SyntaxKind.TrueKeyword ? 1 : value.kind === ts.SyntaxKind.FalseKeyword ? 0 : UNKNOWN;
}
function flag(node) {
  if (node === undefined || node === UNKNOWN) return node;
  const kind = unwrap(node).kind;
  return kind === ts.SyntaxKind.TrueKeyword ? true : kind === ts.SyntaxKind.FalseKeyword ? false : UNKNOWN;
}
/** The items of an array literal: the text of a string or a regular expression, or the source text of another item. */
function list(node) {
  if (node === undefined || node === UNKNOWN) return node;
  const value = unwrap(node);
  if (!ts.isArrayLiteralExpression(value)) return UNKNOWN;
  if (value.elements.some((item) => !ts.isStringLiteralLike(item) && !ts.isRegularExpressionLiteral(item)
    && !(ts.isSpreadElement(item) && defaultItem.test(flat(item))))) return UNKNOWN;
  return value.elements.map((item) => (ts.isStringLiteralLike(item) || ts.isRegularExpressionLiteral(item) ? item.text : flat(item)));
}

/** The settings of a Vitest `test` object: Map(name -> value or UNKNOWN). The older form keeps the thresholds in `coverage`, and "100: true" sets all four. */
function vitestSettings(test) {
  const coverage = path(test, ['coverage']), thresholds = property(coverage, 'thresholds'), settings = new Map();
  const hundred = [flag(property(thresholds, '100')), flag(property(coverage, '100'))];
  for (const metric of metrics) {
    const found = [number(property(thresholds, metric)), number(property(coverage, metric)), ...hundred.map((value) => (value === true ? 100 : value === false ? undefined : value))];
    settings.set(`test.coverage.thresholds.${metric}`, found.find((value) => value !== undefined));
  }
  settings.set('test.exclude', list(property(test, 'exclude')));
  settings.set('test.passWithNoTests', flag(property(test, 'passWithNoTests')));
  for (const name of ['bail', 'retry']) settings.set(`test.${name}`, number(property(test, name)));
  return settings;
}

/** The settings of a Jest configuration object. A key of coverageThreshold is "global", a path or a glob. */
function jestSettings(config) {
  const settings = new Map(), found = property(config, 'coverageThreshold'), threshold = found === undefined || found === UNKNOWN ? found : unwrap(found);
  if (threshold === UNKNOWN || (threshold !== undefined && (!ts.isObjectLiteralExpression(threshold) || threshold.properties.some((item) => keyOf(item) === null)))) settings.set('coverageThreshold', UNKNOWN);
  else if (threshold !== undefined) for (const item of threshold.properties) for (const metric of metrics) {
    settings.set(`coverageThreshold.${keyOf(item)}.${metric}`, number(property(ts.isPropertyAssignment(item) ? item.initializer : UNKNOWN, metric)));
  }
  settings.set('testPathIgnorePatterns', list(property(config, 'testPathIgnorePatterns')));
  settings.set('passWithNoTests', flag(property(config, 'passWithNoTests')));
  settings.set('bail', number(property(config, 'bail')));
  return settings;
}

/** The exported object of a configuration module: `export default`, `export =` or `module.exports =`, through defineConfig() and a local const. */
function exported(source) {
  let value = null;
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) value = statement.expression;
    else if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && statement.expression.left.getText(source) === 'module.exports') value = statement.expression.right;
  }
  for (let depth = 0; value !== null && depth < 4; depth++) {
    value = unwrap(value);
    if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && wrappers.has(value.expression.text) && value.arguments.length === 1) value = value.arguments[0];
    else if (ts.isIdentifier(value)) value = localConst(source, value.text);
    else break;
  }
  return value;
}
function localConst(source, name) {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    const found = statement.declarationList.declarations.find((item) => ts.isIdentifier(item.name) && item.name.text === name);
    if (found) return found.initializer ?? null;
  }
  return null;
}

/**
 * The runner settings of one side: { relevant, settings, problem }. `text` null is a file that does not exist on that side,
 * so it has no setting. undefined is a file that Code-map cannot read. `settings` is null when the whole file is UNKNOWN.
 * A text that the parser cannot hold, for example one with very deep nesting, is UNKNOWN.
 */
function readSide(kind, filePath, text, side) {
  if (text === null) return { relevant: false, settings: new Map() };
  if (text === undefined) return { relevant: true, settings: null, problem: `Code-map cannot read the ${side} configuration.` };
  try { return parseSide(kind, filePath, text, side); } catch {
    return { relevant: kind !== 'package' || /"jest"\s*:/.test(text), settings: null, problem: `Code-map cannot parse the ${side} configuration.` };
  }
}
function parseSide(kind, filePath, text, side) {
  const runner = kind === 'jest' || kind === 'package' ? 'jest' : 'vitest', empty = { relevant: false, settings: new Map() };
  if (filePath.endsWith('.json')) {
    let value;
    try { value = JSON.parse(text); } catch { return { relevant: kind !== 'package' || /"jest"\s*:/.test(text), settings: null, problem: `The ${side} configuration is not valid JSON.` }; }
    const root = ts.parseJsonText(filePath, text).statements[0]?.expression;
    if (kind !== 'package') {
      return root && ts.isObjectLiteralExpression(root) ? { relevant: true, settings: jestSettings(root) } : { relevant: true, settings: null, problem: `The ${side} configuration is not an object.` };
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value) || !Object.hasOwn(value, 'jest')) return empty;
    const jest = property(root, 'jest');
    return jest === UNKNOWN || jest === undefined || !ts.isObjectLiteralExpression(jest) ? { relevant: true, settings: null, problem: `The "jest" field of the ${side} package.json is not an object.` }
      : { relevant: true, settings: jestSettings(jest) };
  }
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind(filePath)), config = exported(source);
  if (source.parseDiagnostics.length) return { relevant: true, settings: null, problem: `The ${side} configuration has invalid syntax.` };
  const literal = config !== null && ts.isObjectLiteralExpression(config);
  const relevant = kind !== 'vite' || /\bvitest\b/.test(text) || (literal && property(config, 'test') !== undefined);
  if (!literal) return { relevant, settings: null, problem: `The ${side} configuration is not an object literal.` };
  return { relevant, settings: runner === 'jest' ? jestSettings(config) : vitestSettings(property(config, 'test')) };
}

/** The changes of one setting from the base to the head that make the runner weaker, or UNKNOWN. */
function weaker(name, runner, base, head) {
  const kind = /\.(lines|functions|branches|statements)$/.test(name) ? 'threshold' : /exclude|IgnorePatterns/.test(name) ? 'list' : /passWithNoTests/.test(name) ? 'flag' : 'count';
  if (kind === 'threshold') {
    if (base === UNKNOWN || (typeof base === 'number' && head === UNKNOWN)) return UNKNOWN;
    return typeof base !== 'number' ? null : head === undefined ? { change: 'removed', base, head: null } : head < base ? { change: 'lowered', base, head } : null;
  }
  if (base === UNKNOWN || head === UNKNOWN) return UNKNOWN;
  if (kind === 'list') {
    const known = new Set((base ?? defaults[runner]).map((item) => (defaultItem.test(item) ? defaults.vitest[0] : item)));
    const added = (head ?? []).filter((item) => !known.has(defaultItem.test(item) ? defaults.vitest[0] : item) && !defaultItem.test(item));
    return added.length ? { change: 'added', base: base ?? null, head: head ?? null, added } : null;
  }
  if (kind === 'flag') return head === true && base !== true ? { change: 'enabled', base: base ?? null, head } : null;
  if (name === 'bail' || name === 'test.bail') return head > 0 && (!(base > 0) || head < base)
    ? { change: base > 0 ? 'lowered' : 'enabled', base: base ?? null, head } : null;
  return (head ?? 0) > (base ?? 0) ? { change: 'raised', base: base ?? null, head } : null;
}

/**
 * The comparison of one changed runner configuration file, or null when neither side holds runner settings.
 * `baseText` and `headText` are the texts, null for a file that does not exist on that side, or undefined when Code-map cannot
 * read it. The state is WEAKER when one setting is weaker, else UNKNOWN when Code-map cannot read a setting, else NOT_WEAKER.
 */
export function compareRunnerFile({ path: filePath, basePath = filePath, baseText, headText }) {
  const kind = runnerKind(filePath) ?? runnerKind(basePath), runner = kind === 'jest' || kind === 'package' ? 'jest' : 'vitest';
  // A file that the change renames to or from another name has no runner settings under that other name.
  const base = readSide(runnerKind(basePath), basePath, runnerKind(basePath) ? baseText : null, 'base'), head = readSide(runnerKind(filePath), filePath, runnerKind(filePath) ? headText : null, 'head');
  if (!base.relevant && !head.relevant) return null;
  const entry = { path: filePath, basePath, runner, state: 'UNKNOWN', changes: [], unknown: [], reason: null };
  if (!base.settings || !head.settings) return { ...entry, reason: [base.problem, head.problem].filter(Boolean).join(' ') };
  const names = [...new Set([...base.settings.keys(), ...head.settings.keys()])].filter((name) => name !== 'coverageThreshold');
  const thresholdUnknown = base.settings.get('coverageThreshold') === UNKNOWN || head.settings.get('coverageThreshold') === UNKNOWN;
  if (thresholdUnknown) entry.unknown.push('coverageThreshold');
  for (const name of names) {
    if (thresholdUnknown && name.startsWith('coverageThreshold.')) continue;
    const found = weaker(name, runner, base.settings.get(name), head.settings.get(name));
    if (found === UNKNOWN) entry.unknown.push(name);
    else if (found) entry.changes.push({ setting: name, ...found });
  }
  const state = entry.changes.length ? 'WEAKER' : entry.unknown.length ? 'UNKNOWN' : 'NOT_WEAKER';
  return { ...entry, state, reason: state === 'UNKNOWN' ? `These settings have no literal value: ${entry.unknown.join(', ')}.` : null };
}
