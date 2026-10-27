// The budgets of one run: wall clock, output, memory, optional disk and concurrency. Code-map enforces each budget from outside the sandbox.
// The memory budget is a sampled limit: Code-map reads the resident memory of the run with ps at a fixed interval.
// A slot is a private file in the store for each active run. The concurrency budget limits the number of slots at one time.
import { execFile, spawnSync } from 'node:child_process';
import { closeSync, constants, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requirePrivateFolder } from '../store.mjs';
import { budgetLimits } from '../verify-request.mjs';

export const budgetFlags = { wallClockSeconds: 'wall-clock-seconds', memoryMegabytes: 'memory-megabytes', outputMegabytes: 'output-megabytes', concurrency: 'concurrency', diskMegabytes: 'disk-megabytes' };
/** The maxima of an authorization when the user gives no budget options: 10 minutes, 2048 MB, 64 MB of output and one run at one time. */
export const defaultBudgets = { wallClockSeconds: 600, memoryMegabytes: 2048, outputMegabytes: 64, concurrency: 1 };
/** Code-map samples the memory of the run at this interval, and it waits this long after SIGTERM before it sends SIGKILL. */
export const sampleMs = 250, graceMs = 2000;
const psProgram = ['/bin/ps', '/usr/bin/ps'].find((path) => existsSync(path)) ?? '/bin/ps', psArgs = ['-A', '-o', 'pid=,ppid=,pgid=,rss=,stat=,lstart='];
const slotName = /^R-\d{8}T\d{6}Z-[0-9a-f]{8}\.json$/, mib = 1024 * 1024;

/** The budgets that the command-line options give. A missing option is left out. Each value is a whole number within the request limits. */
export function budgetsFrom(options) {
  const budgets = {};
  for (const [name, flag] of Object.entries(budgetFlags)) {
    const text = options[flag], maximum = budgetLimits.maximum[name];
    if (text === undefined) continue;
    if (typeof text !== 'string' || !/^\d+$/.test(text) || Number(text) < budgetLimits.minimum || Number(text) > maximum) {
      throw new Error(`--${flag} must be a whole number from ${budgetLimits.minimum} to ${maximum}, not "${text}".`);
    }
    budgets[name] = Number(text);
  }
  return budgets;
}

/** Returns why the budgets are invalid, or null. Required budgets and an optional disk budget must satisfy the request limits. */
export function budgetProblem(budgets) {
  if (typeof budgets !== 'object' || budgets === null || Array.isArray(budgets)) return 'the budgets are not an object';
  const names = Object.keys(budgetFlags), extra = Object.keys(budgets).find((name) => !names.includes(name));
  if (extra) return `"${extra}" is not a budget`;
  const wrong = names.filter((name) => name !== 'diskMegabytes' || budgets[name] !== undefined).find((name) => !Number.isInteger(budgets[name]) || budgets[name] < budgetLimits.minimum || budgets[name] > budgetLimits.maximum[name]);
  return wrong ? `the budget ${wrong} must be a whole number from ${budgetLimits.minimum} to ${budgetLimits.maximum[wrong]}` : null;
}

/** Refuses a budget of a run that is above the maximum of its authorization. */
export function checkBudgets(budgets, maxima) {
  for (const [name, flag] of Object.entries(budgetFlags)) {
    if (maxima[name] !== undefined && (budgets[name] === undefined || budgets[name] > maxima[name])) throw new Error(`The budget ${name} ${budgets[name]} is above the maximum ${maxima[name]} of the authorization. Give a smaller --${flag}, or ask the user for a new authorization.`);
  }
}

/** The process rows, without zombies. RSS is in kilobytes. The start time distinguishes reused process IDs. */
export function parsePs(text) {
  return text.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+(\S+)(?:\s+(.+?))?)?\s*$/.exec(line);
    return match && !match[5]?.startsWith('Z') ? [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), rss: Number(match[4]), started: match[6] ?? null }] : [];
  });
}

/** The process IDs of a run: the root process, the members of its process group, and all descendants of either. */
export function members(rows, root) {
  const children = new Map(), found = new Set(), queue = [root, ...rows.filter((row) => row.pgid === root).map((row) => row.pid)];
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid]);
  while (queue.length) {
    const pid = queue.pop();
    if (found.has(pid)) continue;
    found.add(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return found;
}

const psTable = () => {
  const result = spawnSync(psProgram, psArgs, { encoding: 'utf8', maxBuffer: 16 * mib, timeout: 5000 });
  if (result.error || result.status !== 0) throw new Error('Code-map cannot check the processes of the run.', { cause: result.error });
  return parsePs(result.stdout);
};
const signal = (pid, name) => { try { process.kill(pid, name); } catch { /* the process or the group is gone */ } };

/**
 * Watches one run until its output closes, and enforces the budgets. A budget stops the whole run: SIGTERM to the process group
 * and to each descendant, and SIGKILL after `grace` milliseconds. When the run ends, Code-map kills what is left of its process
 * group and the descendants that it observed. Collection is refused when a process remains or the process check fails.
 * `write(stream, bytes)` receives the output that the output budget keeps. The result names the budget that stopped the run.
 * The run is in its own process group, so it does not get the signals of the terminal. Thus, when Code-map gets SIGINT,
 * SIGTERM or SIGHUP, it stops the run in the same way, and the result says "interrupted".
 */
export function supervise(child, { budgets, write, intervalMs = sampleMs, grace = graceMs, workspace }) {
  return new Promise((resolve) => {
    const limit = budgets.outputMegabytes * mib, memoryLimit = budgets.memoryMegabytes * 1024, timers = [];
    const state = { stoppedBy: null, kept: 0, seen: { stdout: 0, stderr: 0 }, peak: 0, samples: 0, exit: null, error: null, done: false, sampling: false };
    const observed = new Map(), started = new Set(child.pid ? [child.pid] : []), disk = { peakMegabytes: null, samples: 0, limit: 'sampled', intervalMs };
    let remaining = [], diskPending = null;
    const sampleDisk = () => {
      if (!workspace || budgets.diskMegabytes === undefined || diskPending || state.done || state.exit !== null) return;
      diskPending = new Promise((done) => {
        execFile('/usr/bin/du', ['-sk', workspace], { encoding: 'utf8', timeout: 5000, maxBuffer: mib }, (error, stdout) => {
          const match = /^(\d+)\s/.exec(stdout ?? '');
          if (error || !match) {
            state.error ??= new Error('Code-map cannot measure the workspace disk size.', { cause: error });
            stop('diskMegabytes');
          } else {
            const megabytes = Math.ceil(Number(match[1]) / 1024);
            disk.peakMegabytes = Math.max(disk.peakMegabytes ?? 0, megabytes); disk.samples++;
            if (megabytes > budgets.diskMegabytes) stop('diskMegabytes');
          }
          done();
        });
      }).finally(() => { diskPending = null; });
    };
    const running = (rows) => {
      const found = members(rows, child.pid);
      for (const row of rows) if (observed.get(row.pid) === row.started) for (const pid of members(rows, row.pid)) found.add(pid);
      const live = rows.filter((row) => found.has(row.pid)).map((row) => row.pid);
      observed.clear();
      for (const row of rows) if (found.has(row.pid)) { observed.set(row.pid, row.started); started.add(row.pid); }
      return live;
    };
    const signalRun = (name) => {
      try {
        const pids = running(psTable());
        signal(-child.pid, name);
        for (const pid of pids) signal(pid, name);
      } catch (error) { state.error ??= error; signal(-child.pid, name); }
    };
    const stop = (budget) => {
      if (state.stoppedBy !== null || state.exit !== null) return;
      state.stoppedBy = budget;
      signalRun('SIGTERM');
      timers.push(setTimeout(() => signalRun('SIGKILL'), grace));
    };
    const interrupt = () => stop('interrupted'), interrupts = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const finish = () => {
      if (state.done) return;
      state.done = true;
      for (const timer of timers) clearTimeout(timer);
      for (const name of interrupts) process.removeListener(name, interrupt);
      clearInterval(sampler);
      signalRun('SIGKILL');
      const settle = async () => {
        await diskPending;
        try {
          remaining = running(psTable());
          if (remaining.length) state.error ??= new Error('Processes of the run remain. Code-map refuses artifact collection.');
        } catch (error) { state.error ??= error; }
        const total = state.seen.stdout + state.seen.stderr;
        resolve({ error: state.error, exitStatus: state.exit?.code ?? null, signal: state.exit?.signal ?? null, stoppedBy: state.stoppedBy,
          processes: { started: [...started].sort((a, b) => a - b), remaining }, disk,
          output: { stdoutBytes: state.seen.stdout, stderrBytes: state.seen.stderr, keptBytes: state.kept, truncated: total > state.kept },
          memory: { peakMegabytes: state.samples ? Math.ceil(state.peak / 1024) : null, samples: state.samples, limit: 'sampled', intervalMs } });
      };
      setTimeout(settle, grace);
    };
    const onData = (stream) => (chunk) => {
      state.seen[stream] += chunk.length;
      const room = limit - state.kept, part = room <= 0 ? null : chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (part) { write(stream, part); state.kept += part.length; }
      if (state.seen.stdout + state.seen.stderr > limit) stop('outputMegabytes');
    };
    const sampler = setInterval(() => {
      sampleDisk();
      if (state.sampling || state.exit !== null || state.done) return;
      state.sampling = true;
      execFile(psProgram, psArgs, { encoding: 'utf8', maxBuffer: 16 * mib, timeout: 5000 }, (error, stdout) => {
        state.sampling = false;
        if (state.done || state.exit !== null) return;
        if (error) { state.error ??= new Error('Code-map cannot sample run processes.', { cause: error }); stop('interrupted'); return; }
        const rows = parsePs(stdout), pids = new Set(running(rows)), rss = rows.filter((row) => pids.has(row.pid)).reduce((sum, row) => sum + row.rss, 0);
        state.peak = Math.max(state.peak, rss);
        state.samples++;
        if (rss > memoryLimit) stop('memoryMegabytes');
      });
    }, intervalMs);
    sampleDisk();
    timers.push(setTimeout(() => stop('wallClockSeconds'), budgets.wallClockSeconds * 1000));
    for (const name of interrupts) process.on(name, interrupt);
    child.stdout.on('data', onData('stdout'));
    child.stderr.on('data', onData('stderr'));
    child.on('error', (error) => { state.error = error; finish(); });
    child.on('exit', (code, name) => {
      state.exit = { code, signal: name };
      for (const timer of timers) clearTimeout(timer);
      signalRun('SIGKILL');
      // A process that left the group can keep the output open. The run is over, so Code-map stops waiting for it.
      timers.push(setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(); }, grace));
    });
    child.on('close', finish);
  });
}

/** The process ID in a slot file. A slot that is a symlink, that another user owns or that others can change is refused. */
function slotOwner(path) {
  let descriptor;
  try { descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`The slot ${path} is not a private file of Code-map: ${error instanceof Error ? error.message : String(error)}. Remove it.`, { cause: error });
  }
  try {
    const info = fstatSync(descriptor), uid = typeof process.getuid === 'function' ? process.getuid() : info.uid;
    if (!info.isFile() || info.uid !== uid || (info.mode & 0o022) !== 0) throw new Error(`The slot ${path} is not a private file of Code-map. Remove it.`);
    try { const { pid } = JSON.parse(readFileSync(descriptor, 'utf8')); return Number.isInteger(pid) && pid > 0 ? pid : null; } catch { return null; }
  } finally { closeSync(descriptor); }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; } };

/**
 * Claims a slot for the run, or refuses the run when `concurrency` other runs are active. A slot of a process that ended is
 * removed. The result releases the slot. Two runs that start at the same moment can both be refused, but never both run over the budget.
 */
export function claimSlot(folder, runId, concurrency) {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  requirePrivateFolder(folder, 'Remove it, or choose another store with --store <folder>.');
  const mine = join(folder, `${runId}.json`), release = () => rmSync(mine, { force: true });
  writeFileSync(mine, JSON.stringify({ pid: process.pid, runId }), { mode: 0o600, flag: 'wx' });
  try {
    let others = 0;
    for (const name of readdirSync(folder)) {
      if (!slotName.test(name) || name === `${runId}.json`) continue;
      const pid = slotOwner(join(folder, name));
      if (pid !== null && alive(pid)) others++;
      else rmSync(join(folder, name), { force: true });
    }
    if (others >= concurrency) {
      throw new Error(`${others} other ${others === 1 ? 'run is' : 'runs are'} active, and the concurrency budget allows ${concurrency} at one time. Wait for the other runs to end, or give a larger --concurrency within the authorization.`);
    }
  } catch (error) { release(); throw error; }
  return release;
}
