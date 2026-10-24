// Strict optional request fields for worker execution and copied-test declarations.
import { isRelativePath } from './adapters/run-manifest.mjs';
import { generatedCommand } from './verify-test-validation.mjs';
import { commandProblem } from './worker/command.mjs';

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = /^[A-Za-z0-9._-]{1,64}$/;
/** A copied test must stay outside repository metadata and dependency folders. */
export const safeTestPath = (path) => isRelativePath(path) && !path.split('/').some((part) => ['.git', 'node_modules'].includes(part.toLowerCase()));
const extra = (value, keys, prefix, error) => {
  for (const key of Object.keys(value)) if (!keys.includes(key)) error(`${prefix}.${key}`, 'Unknown field.');
};
/** Checks command declarations. Commands are required only for enabled execution. */
export function executionCommands(value, error) {
  if (value.enabled === true && (typeof value.authorization !== 'string' || !/^AUTH-[0-9a-f]{16}$/.test(value.authorization))) {
    // The existing validator reports null and missing authorizations.
    if (value.authorization !== null && value.authorization !== undefined) error('execution.authorization', 'Must be an authorization ID: AUTH-0123456789abcdef.');
  }
  if (value.commands === undefined && value.enabled !== true) return;
  if (!Array.isArray(value.commands) || value.commands.length < 1 || value.commands.length > 16) {
    error('execution.commands', 'Must list 1 to 16 commands.'); return;
  }
  const seen = new Set();
  value.commands.forEach((item, index) => {
    const prefix = `execution.commands[${index}]`;
    if (!record(item)) { error(prefix, 'Must be an object.'); return; }
    if (typeof item.id !== 'string' || !identifier.test(item.id) || seen.has(item.id)) error(`${prefix}.id`, 'Must be a unique command ID.');
    seen.add(item.id);
    const problem = commandProblem(item.words);
    if (problem) error(`${prefix}.words`, problem);
    if (!['junit', 'jest-json', 'vitest-json'].includes(item.kind)) error(`${prefix}.kind`, 'Must be junit, jest-json or vitest-json.');
    if (!isRelativePath(item.artifact)) error(`${prefix}.artifact`, 'Must be a relative report path.');
    if (!Array.isArray(item.sides) || !item.sides.length || item.sides.length > 2 || new Set(item.sides).size !== item.sides.length
      || !item.sides.every((side) => ['head', 'base'].includes(side))) error(`${prefix}.sides`, 'Must list head, base, or both without duplicates.');
    if (Object.hasOwn(item, 'generatedTestWords')) {
      const problem = commandProblem(item.generatedTestWords);
      if (problem) error(`${prefix}.generatedTestWords`, problem);
      else try { generatedCommand(item.generatedTestWords, 'test/generated.test.mjs'); }
      catch (cause) { error(`${prefix}.generatedTestWords`, cause.message); }
    }
    selectionPolicy(item, prefix, error);
    extra(item, ['baselineSuite', 'id', 'words', 'kind', 'artifact', 'sides', 'generatedTestWords'], prefix, error);
  });
}
/** Checks optional named cases. Missing names select every reported case in the file. */
export function testDeclarations(value, error) {
  for (const key of ['regressionTests', 'generatedTests']) {
    if (!Object.hasOwn(value, key)) continue;
    const list = value[key];
    if (!Array.isArray(list) || list.length > 100) { error(key, 'Must list at most 100 test declarations.'); continue; }
    const seen = new Set();
    list.forEach((item, index) => {
      const prefix = `${key}[${index}]`;
      if (!record(item)) { error(prefix, 'Must be an object.'); return; }
      if (!safeTestPath(item.file)) error(`${prefix}.file`, 'Must be a relative test path outside .git and node_modules.');
      if (Object.hasOwn(item, 'name') && (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 1000)) error(`${prefix}.name`, 'Must be nonempty text of at most 1000 characters.');
      const identity = JSON.stringify([item.file, item.name]);
      if (seen.has(identity)) error(prefix, 'Duplicate test declaration.');
      seen.add(identity);
      if (Object.hasOwn(item, 'mutationAuthorization') && (key !== 'generatedTests' || typeof item.mutationAuthorization !== 'string'
        || !/^AUTH-[0-9a-f]{16}$/.test(item.mutationAuthorization))) error(`${prefix}.mutationAuthorization`, 'Must be an authorization ID for a generated test.');
      extra(item, key === 'generatedTests' ? ['file', 'name', 'mutationAuthorization'] : ['file', 'name'], prefix, error);
    });
  }
}

/** Selection is opt-in and requires one whole-word selector and bounded safe paths. */
function selectionPolicy(item, prefix, error) {
  const words = Array.isArray(item.words) ? item.words : [];
  const selector = testFilesSelector(words);
  if (item.baselineSuite === undefined && !selector.present) return;
  if (!Array.isArray(item.baselineSuite) || item.baselineSuite.length > 200
    || !item.baselineSuite.every((path) => safeTestPath(path) && !path.startsWith('-'))
    || new Set(item.baselineSuite).size !== item.baselineSuite.length) {
    error(`${prefix}.baselineSuite`, 'Must list at most 200 unique safe relative test paths.');
  }
  if (!selector.present || selector.problem) error(`${prefix}.words`, selector.problem ?? 'Selection needs one whole-word {testFiles} selector.');
}

/** Checks the shared whole-word selector syntax before command expansion. */
export function testFilesSelector(words) {
  const selectors = Array.isArray(words) ? words.filter((word) => typeof word === 'string' && word.includes('{testFiles}')) : [];
  return { present: selectors.length > 0, problem: selectors.length && (selectors.length !== 1 || selectors[0] !== '{testFiles}')
    ? 'Selection needs one whole-word {testFiles} selector.' : null };
}
