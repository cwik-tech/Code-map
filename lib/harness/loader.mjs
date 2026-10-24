// Resolves only a declared project loader. Resolution does not execute project code.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { jsonFile } from './files.mjs';
/** Node arguments for a TypeScript subject, or no arguments for compiled JavaScript. */
export function projectLoader(workspace, subjects) {
  if (!subjects.some((subject) => /\.[cm]?tsx?$/.test(subject.file))) return [];
  let pkg;
  try { pkg = jsonFile(workspace, 'package.json'); }
  catch { throw new Error('TypeScript needs the project tsx loader or a compiled JavaScript subject'); }
  if (!pkg?.dependencies?.tsx && !pkg?.devDependencies?.tsx) throw new Error('TypeScript needs the project tsx loader or a compiled JavaScript subject');
  const require = createRequire(pathToFileURL(`${workspace}/package.json`));
  try { return ['--import', require.resolve('tsx/esm')]; }
  catch { throw new Error('TypeScript needs an installed project tsx loader or a compiled JavaScript subject'); }
}
