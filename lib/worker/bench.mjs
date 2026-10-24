// Sequential command timings inside the existing worker workspace and authorization.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus, hostname, loadavg, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { supervise } from './budgets.mjs';
import { timingStatistics, validateRepeats } from '../bench-report.mjs';
import { runProblems } from './outcome.mjs';

/** Runs warmups and measured commands with one aggregate time and output budget. */
export async function measureBench({ command, sandbox, workspace, environment, budgets, write, intervalMs, grace, repeats }) {
  validateRepeats(repeats);
  const processors = cpus(), cpuModel = processors[0]?.model ?? 'unknown';
  const machine = { id: createHash('sha256').update(hostname()).digest('hex'), cpuModel, cpuCount: processors.length,
    platform: process.platform, architecture: arch(), node: process.versions.node };
  const loadBefore = loadavg(), samples = [], warmupSamples = [], start = performance.now();
  let bytes = 0, result;
  for (let index = 0; index < repeats.warmup + repeats.runs; index++) {
    const remaining = budgets.wallClockSeconds * 1000 - (performance.now() - start);
    if (remaining <= 0 && result) return { result: { ...result, stoppedBy: 'wallClockSeconds' }, report: null };
    if (remaining <= 0) throw new Error('Benchmark exhausted its wall-clock budget before the first command.');
    const started = performance.now();
    const child = spawn(sandbox.file, sandbox.args, { cwd: workspace.tree, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let durationMs = null;
    child.once('exit', () => { durationMs = performance.now() - started; });
    const current = await supervise(child, { budgets: { ...budgets, wallClockSeconds: remaining / 1000, outputMegabytes: budgets.outputMegabytes - bytes / 1048576 },
      write: (stream, chunk) => { bytes += chunk.length; write(stream, chunk); }, intervalMs, grace, workspace: workspace.folder });
    result = combineResults(result, current);
    if (runProblems(result, budgets).length || result.exitStatus !== 0 || durationMs === null) return { result, report: null };
    (index >= repeats.warmup ? samples : warmupSamples).push(durationMs);
  }
  return { result, report: { reportType: 'code-map-bench', schemaVersion: 1, command, warmup: repeats.warmup,
    warmupSamples, samples, statistics: timingStatistics(samples), machine, loadBefore, loadAfter: loadavg() } };
}

// Keep all observed output, process IDs and sampled resource totals in the run record.
function combineResults(previous, current) {
  if (!previous) return current;
  const peak = (a, b) => a === null && b === null ? null : Math.max(a ?? 0, b ?? 0);
  const output = Object.fromEntries(['stdoutBytes', 'stderrBytes', 'keptBytes'].map((key) => [key, previous.output[key] + current.output[key]]));
  return { ...current, output: { ...output, truncated: previous.output.truncated || current.output.truncated },
    memory: { ...current.memory, peakMegabytes: peak(previous.memory.peakMegabytes, current.memory.peakMegabytes), samples: previous.memory.samples + current.memory.samples },
    disk: { ...current.disk, peakMegabytes: peak(previous.disk.peakMegabytes, current.disk.peakMegabytes), samples: previous.disk.samples + current.disk.samples },
    processes: { ...current.processes, started: [...new Set([...previous.processes.started, ...current.processes.started])].sort((a, b) => a - b) } };
}
