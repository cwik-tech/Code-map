// Installation and command execution share one wall-clock and output allowance.
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { sandboxCommand } from './backend.mjs';
import { graceMs, sampleMs, supervise } from './budgets.mjs';
import { installCommand } from './install.mjs';
import { runProblems } from './outcome.mjs';

const mib = 1024 * 1024;
const peak = (left, right) => left === null ? right : right === null ? left : Math.max(left, right);
function combine(first, last) {
  return { ...last, output: { stdoutBytes: first.output.stdoutBytes + last.output.stdoutBytes,
    stderrBytes: first.output.stderrBytes + last.output.stderrBytes, keptBytes: first.output.keptBytes + last.output.keptBytes,
    truncated: first.output.truncated || last.output.truncated },
  memory: { ...last.memory, peakMegabytes: peak(first.memory.peakMegabytes, last.memory.peakMegabytes), samples: first.memory.samples + last.memory.samples },
  disk: { ...last.disk, peakMegabytes: peak(first.disk.peakMegabytes, last.disk.peakMegabytes), samples: first.disk.samples + last.disk.samples },
  processes: { started: [...new Set([...first.processes.started, ...last.processes.started])], remaining: last.processes.remaining } };
}

/** Runs npm first when requested. An unsuccessful install never starts the project command. */
export async function runPhases({ backend, policy, command, install, workspace, environment, budgets, write, context }) {
  const start = performance.now();
  const launch = (words, limits) => {
    const sandbox = sandboxCommand(backend, policy, words, workspace.tree);
    const child = spawn(sandbox.file, sandbox.args, { cwd: workspace.tree, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    return supervise(child, { budgets: limits, write, intervalMs: context.sampleMs ?? sampleMs,
      grace: context.graceMs ?? graceMs, workspace: workspace.folder });
  };
  if (!install) return { result: await launch(command, budgets), installation: null };
  const words = installCommand(install), first = await launch(words, budgets);
  const prepared = first.exitStatus === 0 && runProblems(first, budgets).length === 0;
  const installation = { policy: install, command: words, status: prepared ? 'prepared' : 'failed', exitStatus: first.exitStatus };
  if (!prepared) return { result: first, installation };
  const remaining = { ...budgets, wallClockSeconds: budgets.wallClockSeconds - (performance.now() - start) / 1000,
    outputMegabytes: budgets.outputMegabytes - (first.output.stdoutBytes + first.output.stderrBytes) / mib };
  if (remaining.wallClockSeconds <= 0 || remaining.outputMegabytes <= 0) {
    return { result: { ...first, stoppedBy: remaining.wallClockSeconds <= 0 ? 'wallClockSeconds' : 'outputMegabytes' }, installation };
  }
  return { result: combine(first, await launch(command, remaining)), installation };
}
