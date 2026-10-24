// Fixed trace files enter only the isolated workspace. The authorization covers the added Node preload words.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

export const traceArtifact = '.code-map-xstate/trace.jsonl';
/** The exact command that the user authorizes for trace mode. */
export function traceCommand(command) {
  if (!Array.isArray(command) || typeof command[0] !== 'string' || !['node', 'node.exe'].includes(basename(command[0] ?? ''))) throw new Error('XState tracing needs a direct Node command.');
  return [command[0], '--import', './.code-map-xstate/preload.mjs', ...command.slice(1)];
}
/** Copies the trusted preload modules without loading project code on the host. */
export function prepareTrace(workspace) {
  const folder = join(workspace.tree, '.code-map-xstate');
  mkdirSync(folder, { mode: 0o700 });
  for (const name of ['preload.mjs', 'loader.mjs', 'recorder.mjs']) {
    writeFileSync(join(folder, name), readFileSync(new URL(`trace/${name}`, import.meta.url)), { flag: 'wx', mode: 0o600 });
  }
  writeFileSync(join(folder, 'trace.jsonl'), '', { flag: 'wx', mode: 0o600 });
}
