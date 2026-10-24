// Per-call V8 block counters. Only the declared subject file contributes.
import { Session } from 'node:inspector';
import { isRelativePath } from '../adapters/run-manifest.mjs';
/** Extracts stable file-and-offset identities for executed V8 ranges. Pure. */
export function coverageBlocks(scripts, url, file) {
  const blocks = new Set();
  for (const script of scripts) {
    if (script.url !== url) continue;
    for (const fn of script.functions) for (const range of fn.ranges) {
      if (range.count <= 0) continue;
      // V8 omits child ranges whose counters equal their parent. Subtract explicit children.
      const children = fn.ranges.filter(child => child !== range && child.startOffset >= range.startOffset
        && child.endOffset <= range.endOffset).sort((a, b) => a.startOffset - b.startOffset);
      let start = range.startOffset;
      for (const child of children) {
        if (start < child.startOffset) blocks.add(`${file}:${start}:${child.startOffset}`);
        start = Math.max(start, child.endOffset);
      }
      if (start < range.endOffset) blocks.add(`${file}:${start}:${range.endOffset}`);
      if (blocks.size > 10000) throw new Error('Subject coverage exceeds 10000 blocks');
    }
  }
  return [...blocks].sort();
}
/** Checks bounded, unique block identities from a worker report. Pure. */
export function validBlockCoverage(value) {
  return value !== null && typeof value === 'object' && Array.isArray(value.blocks) && value.blocks.length <= 10000
    && new Set(value.blocks).size === value.blocks.length && value.blocks.every(block => {
      if (typeof block !== 'string' || block.length > 4096) return false;
      const match = /^(.*):(\d+):(\d+)$/.exec(block);
      return match !== null && isRelativePath(match[1]) && Number.isSafeInteger(Number(match[2]))
        && Number.isSafeInteger(Number(match[3])) && Number(match[2]) < Number(match[3]);
    });
}
/** Starts precise counters after module loading. The caller must finish or terminate the process. */
export async function startBlockCoverage(url, file) {
  const session = new Session();
  const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params,
    (error, result) => error ? reject(error) : resolve(result)));
  session.connect();
  try {
    await post('Profiler.enable');
    await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  } catch (error) { session.disconnect(); throw error; }
  return async () => {
    try {
      const { result } = await post('Profiler.takePreciseCoverage');
      return { blocks: coverageBlocks(result, url, file) };
    } finally { session.disconnect(); }
  };
}
/** Checks cumulative progress without treating coverage as proof of paths or assertions. Pure. */
export function validCoverageProgress(value, calls, corpus) {
  if (!value || value.measure !== 'v8-block' || !Number.isSafeInteger(value.coveredBlocks) || value.coveredBlocks < 0
    || value.coveredBlocks > 10000 || !Array.isArray(value.history) || value.history.length !== calls.length
    || typeof value.note !== 'string' || value.note.length > 1000) return false;
  let blocks = 0, size = 0, elapsed = 0;
  const measured = new Set();
  for (const [index, point] of value.history.entries()) {
    if (!point || point.call !== index + 1 || !Number.isSafeInteger(point.coveredBlocks) || point.coveredBlocks < blocks
      || point.coveredBlocks > 10000 || !Number.isSafeInteger(point.corpusSize) || point.corpusSize < size || point.corpusSize > point.call
      || typeof point.elapsedMs !== 'number' || !Number.isFinite(point.elapsedMs) || point.elapsedMs < elapsed) return false;
    for (const block of calls[index].result.coverage?.blocks ?? []) measured.add(block);
    if (point.coveredBlocks !== measured.size) return false;
    blocks = point.coveredBlocks; size = point.corpusSize; elapsed = point.elapsedMs;
  }
  return blocks === value.coveredBlocks && size === corpus?.size && blocks === corpus?.blocks?.length && corpus.blocks.every(block => measured.has(block));
}
