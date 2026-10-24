// The Seatbelt profile of a run on macOS. /usr/bin/sandbox-exec applies it before it starts the command, and every child
// process keeps it. The profile denies everything by default. In Seatbelt the last matching rule wins, so each exception
// comes after the rule that it relaxes. Each path is a parameter (-D), so a path with quotes or brackets cannot change the profile.

/** The devices that a run can write. A test runner writes to /dev/null, and some tools open /dev/stdout by its name. */
const devices = ['/dev/null', '/dev/zero', '/dev/stdout', '/dev/stderr'];
/**
 * The devices that a run can read, and its own file descriptors in /dev/fd. Every other device stays closed: the user owns the
 * terminals (/dev/ttys*) and the console. Without this rule, a run can read another terminal.
 */
const readDevices = ['/dev/null', '/dev/zero', '/dev/random', '/dev/urandom', '/dev/stdin', '/dev/stdout', '/dev/stderr', '/dev/dtracehelper'];
const literals = (paths) => paths.map((path) => `(literal "${path}")`).join(' ');
/**
 * The kernel values that a run can read: the hardware, the system version and the load, which Node.js reads for its os module.
 * Other kernel values, for example the network interfaces and the process list, stay closed.
 */
const sysctls = ['(sysctl-name-prefix "hw.")', '(sysctl-name-prefix "machdep.cpu.")', ...['kern.argmax', 'kern.boottime', 'kern.hostname', 'kern.maxfilesperproc', 'kern.maxproc',
  'kern.osproductversion', 'kern.osrelease', 'kern.ostype', 'kern.osvariant_status', 'kern.osversion', 'kern.secure_kernel', 'kern.usrstack64', 'kern.version',
  'sysctl.proc_cputype', 'sysctl.proc_translated', 'vm.loadavg'].map((name) => `(sysctl-name "${name}")`)];

/**
 * The profile text and its parameters. The run can start processes and signal only its own processes. It can read every
 * path except the protected folders and the devices, and in them only the exceptions. It can write only in the workspace.
 * It has no network, no Unix socket, no Mach service (so also no DNS), and no change of file flags or access control lists.
 * A flag or an access control list can keep the workspace from removal.
 */
export function seatbeltProfile(policy) {
  const params = [['WORKSPACE', policy.workspace]];
  const filters = (prefix, paths, kind) => paths.map((path, index) => { params.push([`${prefix}_${index}`, path]); return `(${kind} (param "${prefix}_${index}"))`; }).join(' ');
  const lines = ['(version 1)', '(deny default)', '(allow process-fork)', '(allow process-exec)', '(allow signal (target same-sandbox))',
    '(allow process-info* (target same-sandbox))', `(allow sysctl-read ${sysctls.join(' ')})`, '(allow file-map-executable)', '(allow file-read*)',
    '(deny file-read* (subpath "/dev"))', `(allow file-read* ${literals(readDevices)} (subpath "/dev/fd"))`, '(allow file-read-metadata (literal "/dev"))'];
  if (policy.protected.length) lines.push(`(deny file-read* ${filters('PROTECTED', policy.protected, 'subpath')})`);
  lines.push(`(allow file-read* ${filters('READ', policy.readable, 'subpath')})`);
  if (policy.ancestors.length) lines.push(`(allow file-read-metadata ${filters('PARENT', policy.ancestors, 'literal')})`);
  lines.push('(allow file-write* (subpath (param "WORKSPACE")))', `(allow file-write-data ${literals(devices)} (subpath "/dev/fd"))`,
    '(deny file-write-flags)', '(deny file-write-acl)');
  if (policy.secrets.length) lines.push(`(deny file-read* file-write* ${filters('SECRET', policy.secrets, 'subpath')})`);
  lines.push('(deny network*)');
  return { profile: `${lines.join('\n')}\n`, params };
}

/** sandbox-exec with the profile, its parameters and the command words after "--". */
export function seatbeltCommand(executable, policy, command) {
  const { profile, params } = seatbeltProfile(policy);
  return { file: executable, args: ['-p', profile, ...params.flatMap(([name, value]) => ['-D', `${name}=${value}`]), '--', ...command] };
}
