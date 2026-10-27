// Pure statistics, validation and informational comparisons for controlled timing reports.
import { commandProblem } from './worker/command.mjs';
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const number = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const median = (values) => { const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : sorted[mid - 1] + (sorted[mid] - sorted[mid - 1]) / 2; };

/** Measures the median, median absolute deviation and minimum of fixed millisecond samples. */
export function timingStatistics(samples) {
  if (!Array.isArray(samples) || !samples.length || samples.length > 100 || !samples.every(number)) throw new Error('Invalid timing samples.');
  const medianMs = median(samples);
  return { medianMs, madMs: median(samples.map((n) => Math.abs(n - medianMs))), minimumMs: Math.min(...samples) };
}

/** Validates optional timing thresholds. Load change uses absolute load-average units. */
export function timingOptions(value = {}) {
  if (!record(value) || Object.keys(value).some((k) => !['minimumChangePercent', 'maximumLoadChange'].includes(k))) throw new Error('Invalid timings settings.');
  const result = { minimumChangePercent: 10, maximumLoadChange: 1, ...value };
  if (!Object.values(result).every(number)) throw new Error('Invalid timings thresholds. Use finite nonnegative numbers.');
  return result;
}

/** Checks repeat counts before any worker starts. */
export function validateRepeats(value) {
  if (!record(value) || Object.keys(value).some((key) => !['runs', 'warmup'].includes(key))
    || !Number.isInteger(value.runs) || value.runs < 1 || value.runs > 100
    || !Number.isInteger(value.warmup) || value.warmup < 0 || value.warmup > 100) throw new Error('bench needs --runs from 1 to 100 and --warmup from 0 to 100.');
  return value;
}

/** Validates untrusted timing reports and checks their derived statistics. */
export function validateBench(value) {
  const bad = (error) => ({ ok: false, error });
  if (!record(value) || value.reportType !== 'code-map-bench' || value.schemaVersion !== 1) return bad('Expected code-map-bench schemaVersion 1.');
  if (Object.keys(value).some((key) => !['reportType', 'schemaVersion', 'command', 'warmup', 'warmupSamples', 'samples', 'statistics', 'machine', 'loadBefore', 'loadAfter'].includes(key))) return bad('Unknown bench field.');
  if (commandProblem(value.command)) return bad('Invalid bench command.');
  try { validateRepeats({ runs: value.samples?.length, warmup: value.warmup }); } catch (error) { return bad(error.message); }
  if (!Array.isArray(value.warmupSamples) || value.warmupSamples.length !== value.warmup || !value.warmupSamples.every(number)) return bad('Invalid warmup samples.');
  let statistics;
  try { statistics = timingStatistics(value.samples); } catch (error) { return bad(error.message); }
  if (!record(value.statistics) || Object.keys(value.statistics).length !== 3
    || !Object.entries(statistics).every(([key, n]) => value.statistics[key] === n)) return bad('Timing statistics disagree with samples.');
  const machine = value.machine;
  if (!record(machine) || typeof machine.id !== 'string' || !/^[a-f0-9]{64}$/.test(machine.id)
    || !Number.isInteger(machine.cpuCount) || machine.cpuCount < 1 || machine.cpuCount > 65536
    || !['cpuModel', 'platform', 'architecture', 'node'].every((key) => typeof machine[key] === 'string' && machine[key].length > 0 && machine[key].length <= 512)
    || Object.keys(machine).length !== 6) return bad('Invalid bench machine facts.');
  if (![value.loadBefore, value.loadAfter].every((load) => Array.isArray(load) && load.length === 3 && load.every(number))) return bad('Invalid load average.');
  return { ok: true, report: value };
}

/** Compares one bound report per side. These observations never change ratings or readiness. */
export function compareBench({ head, base }, options) {
  if (!head.length && !base.length) return null;
  const limits = timingOptions(options), unknown = (reason) => ({ state: 'UNKNOWN', reason });
  if (head.length !== 1 || base.length !== 1) return unknown('Need exactly one bound bench report on each side.');
  const h = head[0], b = base[0];
  if (JSON.stringify(h.command) !== JSON.stringify(b.command)) return unknown('Benchmark command words differ.');
  if (!Object.keys(b.machine).every((key) => b.machine[key] === h.machine[key])) return unknown('Benchmarks need the same machine and runtime.');
  if (JSON.stringify(h.run) !== JSON.stringify(b.run)) return unknown('Benchmark tools or sandbox environments differ.');
  if (h.samples.length !== b.samples.length || h.warmup !== b.warmup) return unknown('Benchmark repeat counts differ.');
  const loads = [h.loadBefore, h.loadAfter, b.loadBefore, b.loadAfter];
  const loadChange = Math.max(...[0, 1, 2].map((i) => Math.max(...loads.map((load) => load[i])) - Math.min(...loads.map((load) => load[i]))));
  if (loadChange > limits.maximumLoadChange) return unknown('Load average change exceeds timings.maximumLoadChange.');
  if (b.statistics.medianMs === 0) return unknown('The base median is zero.');
  const changeMs = h.statistics.medianMs - b.statistics.medianMs, changePercent = changeMs / b.statistics.medianMs * 100;
  const noiseMs = 3 * (b.statistics.madMs + h.statistics.madMs);
  if (![changeMs, changePercent, noiseMs].every(Number.isFinite)) return unknown('Timing comparison arithmetic exceeds finite limits.');
  return { state: 'COMPARED', base: b, head: h, changeMs, changePercent, noiseMs, loadChange, ...limits,
    outsideNoise: Math.abs(changeMs) > noiseMs && Math.abs(changePercent) > limits.minimumChangePercent };
}

/** A short human-readable observation section. */
export function benchLines(bench) {
  if (!bench) return [];
  return ['## Controlled timings', '', 'Timing observations do not affect ratings or readiness.',
    bench.state === 'UNKNOWN' ? `UNKNOWN: ${bench.reason}`
      : `Median change: ${bench.changeMs.toFixed(3)} ms (${bench.changePercent.toFixed(2)}%). Noise range: ±${bench.noiseMs.toFixed(3)} ms. Outside thresholds: ${bench.outsideNoise}.`, ''];
}

/** Reads a report only when its command agrees with the bound successful run manifest. */
export function benchInformation(text, run) {
  let value;
  try { value = JSON.parse(text); } catch { return { ok: false, error: 'The bench report is not valid JSON.' }; }
  const checked = validateBench(value);
  if (!checked.ok) return checked;
  if (run.exitStatus !== 0 || !run.discovery || run.discovery.filters.length
    || JSON.stringify(run.command) !== JSON.stringify(value.command)) return { ok: false, error: 'Bench report needs a successful unfiltered matching command.' };
  if (run.environment.node !== value.machine.node || run.environment.platform !== value.machine.platform) return { ok: false, error: 'Bench runtime disagrees with its manifest.' };
  return checked;
}
