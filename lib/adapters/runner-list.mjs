// Validates bounded Playwright and Mocha discovery trees. Paths are normalized by test-list.
const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const name = (value) => typeof value === 'string' && value.length > 0 && !value.includes('\0');

/** Converts runner JSON to validated file/name entries, or an error. */
export function runnerEntries(value, format, maxEntries, maxBytes) {
  const entries = [];
  let bytes = 0;
  const add = (file, title) => {
    if (!name(file) || !name(title)) return 'Each discovered case needs a file and a non-empty title.';
    if (entries.length >= maxEntries) return `The discovery report has more than ${maxEntries} entries.`;
    bytes += Buffer.byteLength(file, 'utf8') + Buffer.byteLength(title, 'utf8');
    if (bytes > maxBytes) return `The expanded discovery report is larger than ${maxBytes} bytes.`;
    entries.push({ file, name: title });
    return null;
  };
  if (!record(value)) return { error: 'The discovery report must be a JSON object.' };
  if (format === 'mocha-list') {
    if (!Array.isArray(value.tests)) return { error: 'The Mocha report needs a tests array.' };
    if (value.pending !== undefined && !Array.isArray(value.pending)) return { error: 'Mocha pending must be an array.' };
    if ((value.pending?.length ?? 0) > maxEntries) return { error: `The discovery report has more than ${maxEntries} pending entries.` };
    const pending = new Map();
    for (const item of value.pending ?? []) {
      if (!record(item) || !name(item.file) || !name(item.fullTitle)) return { error: 'Each pending Mocha test needs a file and fullTitle.' };
      const key = JSON.stringify([item.file, item.fullTitle]);
      pending.set(key, (pending.get(key) ?? 0) + 1);
    }
    for (const item of value.tests) {
      if (!record(item) || !name(item.fullTitle)) return { error: 'Each Mocha test needs a fullTitle.' };
      const error = add(item.file, item.fullTitle);
      if (error) return { error };
      const key = JSON.stringify([item.file, item.fullTitle]), left = pending.get(key) ?? 0;
      if (left) { entries.at(-1).status = 'skipped'; pending.set(key, left - 1); }
    }
    for (const [key, count] of pending) for (let index = 0; index < count; index++) {
      const [file, title] = JSON.parse(key), error = add(file, title);
      if (error) return { error };
      entries.at(-1).status = 'skipped';
    }
  } else {
    if (!Array.isArray(value.suites)) return { error: 'The Playwright report needs a suites array.' };
    const stack = [{ suites: value.suites, titles: [], depth: 0 }];
    let nodes = 0;
    while (stack.length) {
      const { suites, titles, depth } = stack.pop();
      for (const suite of suites) {
        if (++nodes > maxEntries) return { error: `The discovery report has more than ${maxEntries} suite entries.` };
        if (!record(suite) || (suite.title !== undefined && typeof suite.title !== 'string')) return { error: 'Invalid Playwright suite.' };
        // File suites are containers, not part of a case title.
        const nested = depth === 0 ? titles : [...titles, suite.title].filter(Boolean);
        if (suite.specs !== undefined) {
          if (!Array.isArray(suite.specs)) return { error: 'Playwright specs must be an array.' };
          for (const spec of suite.specs) {
            if (!record(spec) || !name(spec.title) || !Array.isArray(spec.tests)) return { error: 'Invalid Playwright spec.' };
            for (const item of spec.tests) {
              if (!record(item)) return { error: 'Invalid Playwright project test.' };
              const error = add(spec.file ?? suite.file, [...nested, spec.title].join(' > '));
              if (error) return { error };
            }
          }
        }
        if (suite.suites !== undefined) {
          if (!Array.isArray(suite.suites)) return { error: 'Playwright suites must be an array.' };
          if (depth >= 64) return { error: 'Playwright suites exceed 64 nested levels.' };
          stack.push({ suites: suite.suites, titles: nested, depth: depth + 1 });
        }
      }
    }
  }
  return { entries };
}
