// Route parser operations by source language. Python never enters the TypeScript parser.
import { generateMutants, mutationCompileError, equivalentCandidate } from './generate.mjs';
import { pythonMutants, pythonCompileError } from '../python/mutation.mjs';
export const generatorName = (path) => path.endsWith('.py') ? 'Code-map Python mutants' : 'Code-map TypeScript/JavaScript mutants';
export function generateForLanguage(repository, config, path, text, lines) {
  if (path.endsWith('.py')) return pythonMutants(repository, config, path, text, lines);
  return /\.[cm]?[jt]sx?$/.test(path) ? generateMutants(path, text, lines) : [];
}
export function compileMutation(repository, config, path, text, edit) {
  return path.endsWith('.py') ? pythonCompileError(repository, config, path, text.slice(0, edit.start) + edit.replacement + text.slice(edit.end))
    : mutationCompileError(path, text, edit);
}
export function equivalentForLanguage(path, text, edit) {
  return path.endsWith('.py') ? null : equivalentCandidate(path, text, edit);
}
