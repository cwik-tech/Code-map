// Small helpers of the schema readers: a short digest and a line finder. No I/O.
import { createHash } from 'node:crypto';

/** Sixteen hexadecimal characters of the SHA-256 of a text. The store keeps digests where source text would be. */
export const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** A function that gives the line number (from 1) of an offset in `text`. */
export function lineFinder(text) {
  const breaks = [];
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) breaks.push(index);
  return (offset) => {
    let low = 0, high = breaks.length;
    while (low < high) { const middle = (low + high) >> 1; if (breaks[middle] < offset) low = middle + 1; else high = middle; }
    return low + 1;
  };
}
