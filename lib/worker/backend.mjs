// The restricted worker: the backend that isolates a run, the policy that the backend enforces, and the clean environment
// of the run. A run never falls back to the user's normal environment: without a backend, Code-map refuses to run.
// A protected folder is a folder that the run cannot read, except through the workspace, the Node.js folder and the read-only links.
import { statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { isInside, realPath } from '../inspect.mjs';
import { bwrapCommand } from './bwrap.mjs';
import { seatbeltCommand } from './seatbelt.mjs';

/** The fixed places of the backends. Code-map never looks them up in PATH, because a planted program there can fake the isolation. */
const backendPrograms = { darwin: [{ name: 'seatbelt', executable: '/usr/bin/sandbox-exec' }],
  linux: [{ name: 'bwrap', executable: '/usr/bin/bwrap' }, { name: 'bwrap', executable: '/bin/bwrap' }] };
/** The folders and files in the home folder that hold credentials. They stay closed, also when an exception is inside the home folder. */
const credentialFolders = ['.ssh', '.aws', '.azure', '.config', '.docker', '.gnupg', '.kube', '.netrc', '.npmrc', '.pypirc', '.git-credentials', '.yarnrc', '.yarnrc.yml', 'Library/Keychains'];
const systemPath = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];
const localeNames = ['LANG', 'LC_ALL', 'LC_CTYPE'], localeValue = /^[A-Za-z0-9_.@-]{1,64}$/;
const statOrNull = (path) => { try { return statSync(path); } catch { return null; } };

/**
 * The backend of this system, or null. A backend program counts only when it is a file that root owns and that no other
 * user can change. `stat` is a parameter for the tests.
 */
export function findBackend({ platform = process.platform, stat = statOrNull } = {}) {
  for (const backend of backendPrograms[platform] ?? []) {
    const info = stat(backend.executable);
    if (info && info.isFile() && info.uid === 0 && (info.mode & 0o022) === 0) return { ...backend };
  }
  return null;
}

/** Why there is no backend on this system. */
export function noBackendMessage(platform = process.platform) {
  const missing = platform === 'darwin' ? 'Code-map found no /usr/bin/sandbox-exec that root owns.'
    : platform === 'linux' ? 'Code-map found no bubblewrap program (bwrap) in /usr/bin or /bin that root owns. Install the bubblewrap package to use code-map run.'
      : `Code-map has no backend for the system "${platform}". It knows sandbox-exec on macOS and bubblewrap (bwrap) on Linux.`;
  return `${missing} Code-map refuses to run the command, because it never runs it without isolation.`;
}

/**
 * The protected folders when the caller gives none. On macOS the run can read the system folders. It cannot read the user
 * folders, the external volumes, the temporary folders, the system keychains, the repository or the store. On Linux, bubblewrap
 * shows the run only the folders that the policy binds, so this list only decides which parent folders need an exception.
 */
export function defaultProtectedFolders({ platform = process.platform, home, temporary, repository, store }) {
  const system = platform === 'darwin' ? ['/Users', '/Volumes', '/private/var/folders', '/private/tmp', '/Library/Keychains'] : ['/home', '/root', '/tmp', '/var/tmp', '/media', '/mnt'];
  return [...new Set([...system, home, temporary, repository, store].map(realPath))];
}

const checkAbsolute = (path, what) => {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw new Error(`The ${what} must be an absolute path, not ${JSON.stringify(path)}.`);
  return realPath(path);
};

/**
 * The policy of one run. `readable`: the workspace, the Node.js folder and the sources of the read-only links. `ancestors`:
 * each parent folder of a readable path inside a protected folder, whose metadata Node.js must read to resolve a path.
 * `secrets`: the credential folders of the home folder. A workspace, a Node.js folder or a link inside a credential folder is refused.
 */
export function buildPolicy({ workspace, nodePrefix, links = [], protectedFolders, home }) {
  const space = checkAbsolute(workspace, 'workspace'), prefix = checkAbsolute(nodePrefix, 'Node.js folder');
  const sources = links.map((link) => ({ source: checkAbsolute(link.source, 'link source'), target: checkAbsolute(link.target, 'link target') }));
  const homeFolder = checkAbsolute(home, 'home folder'), closed = protectedFolders.map((path) => checkAbsolute(path, 'protected folder'));
  const secrets = credentialFolders.map((name) => realPath(join(homeFolder, name)));
  for (const [path, what] of [[space, 'workspace'], [prefix, 'Node.js folder'], ...sources.map((link) => [link.source, 'read-only link'])]) {
    const secret = secrets.find((folder) => isInside(folder, path));
    if (secret) throw new Error(`The ${what} ${path} is inside the credential folder ${secret}. Code-map refuses to run, because the run must never read credentials. Choose another store with --store <folder>.`);
  }
  // bubblewrap binds a readable folder with all of its contents, so a readable folder must not hold the home folder or a credential folder.
  for (const [path, what] of [[prefix, 'Node.js folder'], ...sources.map((link) => [link.source, 'read-only link'])]) {
    const held = [homeFolder, ...secrets].find((folder) => isInside(path, folder));
    if (held) throw new Error(`The ${what} ${path} holds ${held}. Code-map refuses to run, because the run must never read the home folder or credentials. Install Node.js in a folder of its own, for example with nvm.`);
  }
  const readable = [...new Set([space, prefix, ...sources.map((link) => link.source)])], ancestors = new Set();
  for (const path of readable) {
    for (let parent = dirname(path); parent !== dirname(parent); parent = dirname(parent)) if (closed.some((folder) => isInside(folder, parent))) ancestors.add(parent);
  }
  return { workspace: space, readable, protected: closed, ancestors: [...ancestors].sort(), secrets, links: sources };
}

/** The environment of a run: PATH with the Node.js folder and the system folders, HOME and TMPDIR in the workspace, CI=1 and the locale. Nothing else. */
export function cleanEnvironment({ workspace, nodeDirectory, env = process.env }) {
  const locale = Object.fromEntries(localeNames.filter((name) => typeof env[name] === 'string' && localeValue.test(env[name])).map((name) => [name, env[name]]));
  return { PATH: [nodeDirectory, ...systemPath].join(':'), HOME: join(workspace, 'home'), TMPDIR: join(workspace, 'tmp'), CI: '1', ...(Object.keys(locale).length ? locale : { LANG: 'C' }) };
}

/** The program and the arguments that start the command words in the backend. The words go to the program as they are, never through a shell. */
export function sandboxCommand(backend, policy, command, cwd) {
  if (backend.name === 'seatbelt') return seatbeltCommand(backend.executable, policy, command);
  if (backend.name === 'bwrap') return bwrapCommand(backend.executable, policy, command, { cwd });
  throw new Error(`Code-map knows no backend "${backend.name}".`);
}
