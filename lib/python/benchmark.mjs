// pytest-benchmark JSON is external timing information, never a readiness input.
import { plain } from '../verify-markdown.mjs';
import { isDeepStrictEqual } from 'node:util';
import { timingOptions } from '../bench-report.mjs';
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(v);
const number = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
// JSON.parse accepts overflowing exponents. Check every numeric leaf, including metadata.
const finite = (v, depth = 0) => depth <= 32 && (typeof v === 'number' ? Number.isFinite(v)
  : v !== null && typeof v === 'object' ? Object.values(v).every((x) => finite(x, depth + 1)) : true);
const keys = ['min', 'max', 'mean', 'median', 'stddev', 'iqr', 'rounds', 'iterations', 'ops'];

/** Published plugin.py pytest_benchmark_generate_json and stats.py Metadata.as_dict. */
export function pytestBenchmarkInformation(input, run) {
  const bad = (error) => ({ ok: false, error });
  if (typeof input !== 'string' || Buffer.byteLength(input) > 16 * 1024 * 1024) return bad('pytest-benchmark report exceeds 16 MiB.');
  let value;
  try { value = JSON.parse(input); } catch { return bad('Invalid pytest-benchmark JSON.'); }
  if (!record(value) || !finite(value) || !record(value.machine_info) || !record(value.commit_info) || !text(value.version)
    || !Array.isArray(value.benchmarks) || value.benchmarks.length > 10000) return bad('Invalid pytest-benchmark metadata or limits.');
  if (!['node', 'system', 'python_version'].every((key) => text(value.machine_info[key]))) return bad('Missing machine or Python runtime identity.');
  if (value.commit_info.id !== undefined && value.commit_info.id !== null && value.commit_info.id !== 'unversioned'
    && value.commit_info.id !== run.source?.sha) return bad('pytest-benchmark commit_info names another revision.');
  if (value.commit_info.dirty === true && !run.source?.worktreeDigest) return bad('Dirty benchmark source disagrees with a clean revision binding.');
  if (run.exitStatus !== 0 || !run.discovery || run.discovery.filters.length) return bad('Timing evidence needs a successful unfiltered bound run.');
  const seen = new Set();
  for (const b of value.benchmarks) {
    if (!record(b) || !text(b.fullname) || seen.has(b.fullname) || !(b.group === null || text(b.group))
      || !(b.params === null || record(b.params)) || !record(b.stats) || !keys.every((k) => number(b.stats[k]))
      || !['rounds', 'iterations'].every((k) => Number.isSafeInteger(b.stats[k]) && b.stats[k] > 0)
      || b.stats.min > b.stats.max || b.stats.median < b.stats.min || b.stats.median > b.stats.max
      || b.stats.mean < b.stats.min || b.stats.mean > b.stats.max) return bad('Malformed pytest-benchmark entry. The whole report is refused.');
    seen.add(b.fullname);
  }
  return { ok: true, report: { machine_info: value.machine_info, commit_info: value.commit_info, version: value.version,
    benchmarks: value.benchmarks.map(({ fullname, group, params, stats, options }) => ({ fullname, group, params, stats: Object.fromEntries(keys.map((k) => [k, stats[k]])), options: options ?? null })),
    run: { command: (run.command ?? []).filter((word, index, words) => !word.startsWith('--benchmark-json=') && word !== '--benchmark-json' && words[index - 1] !== '--benchmark-json'), workingDirectory: run.workingDirectory ?? '.', tools: run.tools, environment: run.environment } } };
}

/** Match by fullname. IQR is the reported robust noise range, in seconds. */
export function comparePytestBenchmarks({ head, base }, options) {
  if (!head.length && !base.length) return null;
  const unknown = (reason) => ({ state: 'UNKNOWN', reason });
  if (head.length !== 1 || base.length !== 1) return unknown('Need one bound pytest-benchmark report per side.');
  const h = head[0], b = base[0], limits = timingOptions(options);
  if (!isDeepStrictEqual(h.machine_info, b.machine_info)) return unknown('Benchmark machine or Python runtime drift.');
  if (h.version !== b.version || !isDeepStrictEqual(h.run, b.run)) return unknown('Benchmark tools or environments differ.');
  const heads = new Map(h.benchmarks.map((e) => [e.fullname, e])), bases = new Map(b.benchmarks.map((e) => [e.fullname, e]));
  const entries = [...new Set([...heads.keys(), ...bases.keys()])].sort().map((fullname) => {
    const head = heads.get(fullname), base = bases.get(fullname);
    if (!head || !base) return { fullname, state: head ? 'ADDED' : 'REMOVED', head: head ?? null, base: base ?? null };
    if (!isDeepStrictEqual(head.options, base.options)) return { fullname, state: 'UNKNOWN', reason: 'Benchmark options differ.' };
    if (base.stats.median === 0) return { fullname, state: 'UNKNOWN', reason: 'Base median is zero.' };
    const changeMs = (head.stats.median - base.stats.median) * 1000, changePercent = changeMs / (base.stats.median * 1000) * 100;
    const noiseMs = 3 * (base.stats.iqr + head.stats.iqr) * 1000;
    if (![changeMs, changePercent, noiseMs].every(Number.isFinite)) return { fullname, state: 'UNKNOWN', reason: 'Timing arithmetic exceeds finite limits.' };
    const outsideNoise = Math.abs(changeMs) > noiseMs && Math.abs(changePercent) > limits.minimumChangePercent;
    return { fullname, state: outsideNoise ? 'CHANGED' : 'STABLE', head, base, changeMs, changePercent, noiseMs, outsideNoise };
  });
  return { state: 'COMPARED', entries, ...limits, noise: 'Three times the combined reported IQR. Load averages are not in pytest-benchmark JSON.' };
}

export function pytestBenchmarkLines(info, limit = 10) {
  if (!info) return [];
  return ['## Python throughput', '', 'Timing observations do not affect checks, ratings or readiness.',
    ...(info.state === 'UNKNOWN' ? [`UNKNOWN: ${info.reason}`] : info.entries.slice(0, limit).map((e) => `${plain(e.fullname)}: ${e.state}.${e.changeMs === undefined ? '' : ` Median change: ${e.changeMs.toFixed(3)} ms (${e.changePercent.toFixed(2)}%). Noise range: ±${e.noiseMs.toFixed(3)} ms.`}`)), ''];
}
