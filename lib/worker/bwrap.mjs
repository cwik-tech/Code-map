// The bubblewrap (bwrap) command of a run on Linux. The run sees a new root with only these folders: the system folders and
// some files of /etc read-only, the Node.js folder read-only, the workspace read-write, and the read-only links. --unshare-all
// gives it new namespaces: no network, its own process IDs, and no view of the other processes. Nothing else of the host is there.
import { lstatSync, readlinkSync } from 'node:fs';
import { isInside } from '../inspect.mjs';

/** The system folders. On a merged /usr system, /bin, /sbin and /lib are symlinks into /usr, and they stay symlinks. */
const systemFolders = ['/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64'];
/** The files of /etc that the dynamic linker, the time zone and the user names need. A missing file is left out (--ro-bind-try). */
const etcFiles = ['/etc/alternatives', '/etc/group', '/etc/hosts', '/etc/ld.so.cache', '/etc/ld.so.conf', '/etc/ld.so.conf.d', '/etc/localtime', '/etc/nsswitch.conf', '/etc/passwd'];
const entryOf = (path) => { try { return lstatSync(path); } catch { return null; } };

/**
 * bwrap with the policy and the command words after "--". `cwd` is the folder of the snapshot copy. --die-with-parent stops
 * the run when Code-map stops it, and --new-session keeps the run from writing into the terminal of the user.
 * `entry` and `readLink` are parameters for the tests.
 */
export function bwrapCommand(executable, policy, command, { cwd, entry = entryOf, readLink = readlinkSync }) {
  const args = ['--unshare-all', '--die-with-parent', '--new-session'];
  const bind = (flag, source, target) => {
    const protectedPath = [...policy.protected, ...policy.secrets].find((path) => isInside(source, path));
    if (protectedPath) throw new Error(`The bind source ${source} contains protected path ${protectedPath}. Code-map refuses the run.`);
    args.push(flag, source, target);
  };
  for (const folder of systemFolders) {
    const info = entry(folder);
    if (info?.isSymbolicLink()) args.push('--symlink', readLink(folder), folder);
    else if (info) bind('--ro-bind', folder, folder);
  }
  for (const file of etcFiles) bind('--ro-bind-try', file, file);
  const linked = new Set(policy.links.map((link) => link.source));
  for (const path of policy.readable) {
    if (path === policy.workspace || linked.has(path) || systemFolders.some((folder) => isInside(folder, path))) continue;
    bind('--ro-bind', path, path);
  }
  // /tmp is the private temporary folder of the workspace, so a tool that ignores TMPDIR still writes only into the workspace.
  bind('--bind', `${policy.workspace}/tmp`, '/tmp');
  bind('--bind', policy.workspace, policy.workspace);
  for (const link of policy.links) bind('--ro-bind', link.source, link.target);
  args.push('--proc', '/proc', '--dev', '/dev', '--chdir', cwd, '--', ...command);
  return { file: executable, args };
}
