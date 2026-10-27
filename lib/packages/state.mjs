// Snapshot-bound install inputs. Read only package-folder existence and installed exports, including nested node_modules.
import { posix } from 'node:path';
import ts from 'typescript';
import { sourceReader } from '../git.mjs';
import { ignored, isCode } from '../project.mjs';
import { installedPackages } from './installed.mjs';
import { classify, isDeclaration } from './manifests.mjs';

/** The installed state that can change package findings for this snapshot, without reading other installed package fields. */
export function packageInstallState(repository, ref) {
  const reader = sourceReader(repository, ref), view = installedPackages(repository);
  const paths = reader.list().filter((path) => !ignored(path) && !posix.basename(path).startsWith('.pnp.')
    && (isCode(path) || isDeclaration(path) || posix.basename(path) === 'package.json'));
  const folders = new Map(), packages = new Map();
  for (const [path, text] of reader.read(paths)) {
    const folder = posix.dirname(path);
    folders.set(folder, view.installed(folder));
    if (posix.basename(path) === 'package.json') continue;
    for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) {
      if (fileName.startsWith('.')) continue;
      const found = classify(fileName);
      if (found.kind !== 'package') continue;
      const location = view.find(folder, found.name);
      packages.set(`${folder}\0${found.name}`, { location, exports: location === null ? null : view.exportsOf(location) });
    }
  }
  return { folders: Object.fromEntries([...folders].sort()), packages: Object.fromEntries([...packages].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) };
}
