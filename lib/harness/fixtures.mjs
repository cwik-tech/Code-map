// Writes data and inert node:test skeletons only into the private run folder.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { harnessInformation } from './report.mjs';
/** Promotes bounded failure data without executing any project code. */
export function regressionFixtures(result) {
  if (!result.paths.artifact) return result;
  const text = readFileSync(result.paths.artifact, 'utf8');
  if (harnessInformation(text).error) return result;
  const report = JSON.parse(text);
  if (!['property', 'fuzz'].includes(report.mode)) return result;
  const failures = report.failures.filter((item) => report.mode === 'property' ? item.kind === 'property' && Object.hasOwn(item, 'shrunkInput') : item.kind === 'crash');
  if (!failures.length) return result;
  const folder = join(result.paths.folder, 'fixtures');
  mkdirSync(folder, { mode: 0o700 });
  failures.forEach((failure, index) => {
    const name = `case-${String(index + 1).padStart(4, '0')}`;
    const fixture = { fixtureVersion: 1, mode: report.mode, subject: report.subject, seed: report.seed, generatorVersion: report.generatorVersion,
      input: report.mode === 'property' ? failure.shrunkInput : failure.input, failure };
    writeFileSync(join(folder, `${name}.json`), JSON.stringify(fixture, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    writeFileSync(join(folder, `${name}.test.mjs`), `// Copy this fixture, import your subject, and replace the skipped assertion.\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nconst fixture = JSON.parse(readFileSync(new URL('./${name}.json', import.meta.url), 'utf8'));\ntest('regression seed ' + fixture.seed, { skip: 'Supply a reviewed expected result and subject import' }, () => {\n  assert.fail('Call the subject with fixture.input and assert the reviewed outcome');\n});\n`, { flag: 'wx', mode: 0o600 });
  });
  result.paths.fixtures = folder;
  return result;
}
