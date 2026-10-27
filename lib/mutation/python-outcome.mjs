// An explicit pytest JUnit path supplies assertion evidence without changing authorized words.
import { readFileSync } from 'node:fs';
import { reportCases } from '../adapters/report-cases.mjs';
import { isRelativePath } from '../adapters/run-manifest.mjs';
export function junitArtifact(command) {
  const paths = command.flatMap((word, index) => word.startsWith('--junitxml=') ? [word.slice(11)]
    : word === '--junitxml' ? [command[index + 1]] : []);
  if (!paths.length) return null;
  if (paths.length !== 1 || !isRelativePath(paths[0])) throw new Error('Python mutation needs one safe relative --junitxml path.');
  return paths[0];
}
export function readMutationCases(result, mutant, testFiles = new Set()) {
  const path = mutant ? result.paths.mutationArtifact : result.paths.artifact;
  if (!path) return null;
  const parsed = reportCases(readFileSync(path, 'utf8'), 'junit', result.record.workspace.tree, { workingDirectory: '.' }, testFiles);
  return parsed.error || parsed.mismatches.length || parsed.fileFailures.length || parsed.cases.some((item) => item.file === null) ? null : parsed.cases;
}
