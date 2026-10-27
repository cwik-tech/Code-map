// The model files of a snapshot (C23, C24): `.code-map/models/*.json` holds state models and `.code-map/decisions/*.json` holds
// decision tables. Each file is untrusted input. Code-map refuses a symbolic link, a file larger than 256 KiB, more than 50 files
// in one folder and text that is not JSON. In a working tree, a link whose real path is outside the repository gets its own
// reason, and Code-map does not read it. Read-only: the files come from the mapped commit or from the working tree, as the code.
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { git } from '../git.mjs';

const modelRoot = '.code-map';
const modelFolders = { '.code-map/models': 'state-model', '.code-map/decisions': 'decision-table' };
export const maxModelBytes = 256 * 1024;
const maxModelFiles = 50;
const message = (error) => (error instanceof Error ? error.message : String(error));

/** The kind of a model file: a JSON file directly in a model folder. Other files and nested folders are not model files. */
function kindOf(path) {
  for (const [folder, kind] of Object.entries(modelFolders)) {
    const name = path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : null;
    if (name !== null && !name.includes('/') && name.endsWith('.json')) return kind;
  }
  return null;
}

/** The entries of `.code-map` in a commit, with their mode, object type and size. */
function commitEntries(repository, sha) {
  return git(repository, ['ls-tree', '-r', '-l', '-z', sha, '--', modelRoot]).split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t'), [mode, type, , size] = line.slice(0, tab).trim().split(/\s+/);
    return { path: line.slice(tab + 1), link: mode === '120000', file: type === 'blob', size: Number(size) };
  });
}

/** The reason to refuse a link in the working tree: its real path is outside the repository, or it is a link at all. */
function linkReason(repository, path) {
  try {
    const rest = relative(realpathSync.native(repository), realpathSync.native(join(repository, path)));
    return rest === '..' || rest.startsWith(`..${sep}`) || isAbsolute(rest) ? 'outside-repository' : 'symbolic-link';
  } catch { return 'symbolic-link'; } // a broken link
}

/** The bytes of a working-tree file of at most `maxModelBytes`. O_NOFOLLOW refuses a link that replaced the file after the check. */
function readWorktree(full) {
  const descriptor = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile()) return { reason: 'not-a-file' };
    if (info.size > maxModelBytes) return { reason: 'too-large' };
    return { text: readFileSync(descriptor, 'utf8') };
  } finally { closeSync(descriptor); }
}

const reasonTexts = {
  'outside-repository': (path) => `The real path of ${path} is outside the repository. Code-map reads model files only inside the repository.`,
  'symbolic-link': (path) => `${path} is a symbolic link. Code-map reads only model files and folders that are not links.`,
  'not-a-folder': (path) => `${path} is not a folder.`,
  'not-a-file': (path) => `${path} is not a file.`,
  'too-large': (path) => `${path} is larger than ${maxModelBytes} bytes.`,
  'too-many-files': (path) => `${path} is after the first ${maxModelFiles} files of its folder. Code-map reads at most ${maxModelFiles} files in each model folder.`,
};

/**
 * The model files of the snapshot: { files: [{ path, kind, value }], errors: [{ path, kind, reason, problems }] }, each sorted by
 * path. `sha` is the mapped commit, or null for the working tree. `paths` lists the files of the snapshot, and `texts` has the
 * text of the JSON files that the collector read from a commit.
 */
export function readModelFiles(repository, sha, paths, texts = new Map()) {
  const files = [], errors = [], counts = new Map();
  const refuse = (path, kind, reason, text = reasonTexts[reason](path)) => errors.push({ path, kind, reason, problems: [{ path: '', message: text }] });
  const entries = sha !== null ? commitEntries(repository, sha)
    : paths.filter((path) => path === modelRoot || path.startsWith(`${modelRoot}/`)).sort().map((path) => {
      let info = null;
      try { info = lstatSync(join(repository, path)); } catch { /* gone after the listing */ }
      return { path, link: !!info?.isSymbolicLink(), file: !!info?.isFile(), size: info?.size ?? 0, missing: info === null };
    });
  for (const entry of entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const { path } = entry;
    // A model folder (or .code-map itself) that Git lists as an entry is a link or a file, not a folder.
    if (path === modelRoot || Object.hasOwn(modelFolders, path)) {
      const kind = modelFolders[path] ?? 'model-folder';
      if (entry.link) refuse(path, kind, sha === null ? linkReason(repository, path) : 'symbolic-link'); else refuse(path, kind, 'not-a-folder');
      continue;
    }
    const kind = kindOf(path);
    if (kind === null || entry.missing) continue;
    if (sha === null) {
      const parents = [modelRoot, path.slice(0, path.lastIndexOf('/'))];
      const link = parents.find((parent) => lstatSync(join(repository, parent)).isSymbolicLink());
      if (link) { refuse(path, kind, linkReason(repository, link)); continue; }
    }
    const folder = path.slice(0, path.lastIndexOf('/')), count = (counts.get(folder) ?? 0) + 1;
    counts.set(folder, count);
    if (count > maxModelFiles) { refuse(path, kind, 'too-many-files'); continue; }
    if (entry.link) { refuse(path, kind, sha === null ? linkReason(repository, path) : 'symbolic-link'); continue; }
    if (!entry.file) { refuse(path, kind, 'not-a-file'); continue; }
    if (entry.size > maxModelBytes) { refuse(path, kind, 'too-large'); continue; }
    let text;
    try {
      const read = sha !== null ? { text: texts.get(path) ?? git(repository, ['cat-file', 'blob', `${sha}:${path}`]) } : readWorktree(join(repository, path));
      if (read.reason) { refuse(path, kind, read.reason); continue; }
      text = read.text;
    } catch (error) { refuse(path, kind, 'unreadable', `Code-map cannot read ${path}: ${message(error)}`); continue; }
    try { files.push({ path, kind, value: JSON.parse(text.replace(/^\uFEFF/, '')) }); } catch (error) { refuse(path, kind, 'not-json', `${path} is not valid JSON: ${message(error)}`); }
  }
  return { files, errors };
}
