// Informational startup comparisons. Missing measurements stay UNKNOWN.
import { validateStartup } from './startup-schema.cjs';
import { timingOptions, timingStatistics } from '../bench-report.mjs';

export function startupInformation(text, run) {
  if (Buffer.byteLength(text) > 4 * 1024 * 1024) return { ok: false, error: 'Electron startup report exceeds 4 MiB.' };
  let value;
  try { value = JSON.parse(text); } catch { return { ok: false, error: 'Electron startup report is not valid JSON.' }; }
  const checked = validateStartup(value);
  if (!checked.ok) return checked;
  if (run.exitStatus !== 0 || !run.discovery || run.discovery.filters.length) return { ok: false, error: 'Electron startup needs a successful unfiltered run.' };
  return checked;
}

function compareMetric(base, head, minimumChangePercent) {
  if ([...base, ...head].some((n) => n === null)) return { state: 'UNKNOWN', reason: 'A milestone was not observed in every sample.' };
  const b = timingStatistics(base), h = timingStatistics(head);
  if (b.medianMs === 0) return { state: 'UNKNOWN', reason: 'The base median is zero.' };
  const change = h.medianMs - b.medianMs, changePercent = change / b.medianMs * 100, noise = 3 * (b.madMs + h.madMs);
  return { state: 'COMPARED', base: { median: b.medianMs, mad: b.madMs, minimum: b.minimumMs },
    head: { median: h.medianMs, mad: h.madMs, minimum: h.minimumMs }, change, changePercent, noise, minimumChangePercent,
    outsideNoise: Math.abs(change) > noise && Math.abs(changePercent) > minimumChangePercent };
}

export function compareStartup({ head, base }, options) {
  const unknown = (reason) => ({ state: 'UNKNOWN', attestation: 'self-attested', reason });
  if (head.length !== 1 || base.length !== 1) return unknown('Need exactly one bound Electron startup report on each side.');
  const h = head[0], b = base[0];
  if (h.seconds !== b.seconds || h.samples.length !== b.samples.length) return unknown('Startup collection intervals or sample counts differ.');
  if (JSON.stringify(h.run) !== JSON.stringify(b.run)) return unknown('Startup commands, tools or environments differ.');
  const { minimumChangePercent } = timingOptions(options);
  const metrics = Object.fromEntries(['readyMs', 'readyToShowMs', 'didFinishLoadMs', 'totalMemoryKB'].map((key) => {
    const values = (report) => report.samples.map((sample) => key === 'totalMemoryKB'
      ? sample.processes.reduce((sum, process) => sum + process.workingSetKB, 0) : sample[key]);
    return [key, { ...compareMetric(values(b), values(h), minimumChangePercent), unit: key === 'totalMemoryKB' ? 'KB' : 'ms' }];
  }));
  return { state: 'COMPARED', attestation: 'self-attested', metrics };
}

export function startupLines(report) {
  if (!report) return [];
  return ['## Electron startup and memory', '', 'Self-attested observations do not affect ratings or readiness.',
    ...(report.state === 'UNKNOWN' ? [`UNKNOWN: ${report.reason}`] : Object.entries(report.metrics).map(([key, metric]) =>
      metric.state === 'UNKNOWN' ? `${key}: UNKNOWN. ${metric.reason}`
        : `${key}: median ${metric.base.median.toFixed(3)} to ${metric.head.median.toFixed(3)} ${metric.unit}. Change ${metric.changePercent.toFixed(2)}%. Noise ±${metric.noise.toFixed(3)} ${metric.unit}. Outside thresholds: ${metric.outsideNoise}.`)), ''];
}
