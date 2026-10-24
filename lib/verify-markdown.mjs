// Safe Markdown for the verification report: one-line text with escaped Markdown and HTML characters, code spans, tables and
// series of names, and the two sections of verify output that come from new evidence: the oracle provenance of the test cases
// and the hypotheses of a language model. Pure: no file and no command.

export const resultsFile = 'verification-results.json';
export const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
/** One line of text: control characters and line breaks become spaces, and a long value is cut at `max` characters. */
export const flat = (value, max) => { const text = String(value ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text; };
/** Escapes the Markdown and HTML characters, so that a value cannot add a table cell, a link, emphasis or a tag. */
export const plain = (value, max = 400) => flat(value, max).replace(/[\\`*_[\]<>|]/g, '\\$&');
/** Untrusted text with each control character that is not white space, and each bidirectional control, as a visible escape such as \u001b. */
export const visible = (value) => String(value ?? '').replace(/[\t\n\v\f\r]+/g, ' ').replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
/** A code span with a fence that is longer than each backtick run inside. "|" stays escaped, because tables split cells on it even in code. */
export const code = (value, max = 200) => {
  const text = flat(value, max) || 'none', fence = '`'.repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length)) + 1), pad = /^`|`$/.test(text) ? ' ' : '';
  return `${fence}${pad}${text.replace(/\|/g, '\\|')}${pad}${fence}`;
};
export const table = (header, body) => [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...body.map((row) => `| ${row.join(' | ')} |`)];
export const rest = (shown, total, what) => total > shown ? [`The table lists ${shown} of ${total} ${what}. The other ${total - shown} are in ${resultsFile}.`] : [];
/** "a", "a and b", "a, b and c", or the first `max` items and "and N more". */
export const series = (items, max = items.length, shown = items.slice(0, max)) => items.length > max ? `${shown.join(', ')} and ${items.length - max} more`
  : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0] ?? '';

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The cell of the row "Test oracles": the provenance counts of the cases that the bound head reports ran, and the criteria with linked cases. */
export function provenanceCell(provenance) {
  const counts = provenance.counts ?? {}, number = (label) => Number.isInteger(counts[label]) ? counts[label] : 0;
  if (!Number.isInteger(provenance.total) || provenance.total === 0) return 'No bound head report ran a test case, so no test oracle has a provenance label.';
  const linked = (Array.isArray(provenance.criteria) ? provenance.criteria : []).filter((entry) => entry?.linked > 0)
    .map((entry) => `${code(entry.id, 64)} (${entry.passed ?? 0} of ${entry.linked} passed)`);
  return [`The bound head reports ran ${plural(provenance.total, 'test case', 'test cases')}. Oracle provenance: ${number('spec-linked')} spec-linked, ${number('pre-existing')} pre-existing, `
    + `${number('changed-with-change')} changed with the change and ${number('unknown')} unknown.`, linked.length ? `Acceptance criteria with linked cases: ${series(linked, 5)}.` : '',
  'The labels change no check, rating or readiness.'].filter(Boolean).join(' ');
}

/**
 * The section of the hypotheses of a language model, or no line when the request names no hypotheses file. The table has at
 * most 5 rows, and fewer when the section must fit in `room` lines, so that model output cannot push the report over its limit.
 */
export function hypothesisLines({ llmHypotheses, llmHypothesesFile: file }, room = Infinity) {
  if (!isRecord(file)) return [];
  const head = ['## Model hypotheses (model output, not evidence)', ''], path = code(file.path, 300);
  if (file.state !== 'VALID') {
    // The path of an unknown field is a key of the model's file, so it gets the same escapes as a claim.
    const errors = (Array.isArray(file.errors) ? file.errors : []).slice(0, 3)
      .map((error) => error?.path ? `the field ${code(visible(error.path), 100)}: ${plain(visible(error.message), 200)}` : plain(visible(error?.message), 200));
    return [...head, `The request names the hypotheses file ${path}, but Code-map did not use it: ${errors.join(' ') || 'the file is not valid.'} `
      + 'The file has no effect on the checks, the ratings or the readiness.', ''];
  }
  const items = Array.isArray(llmHypotheses) ? llmHypotheses : [], total = items.length, grounded = items.filter((item) => item?.grounded === true).length;
  const intro = `A language model (${plain(visible(file.model), 100)}) wrote ${plural(total, 'hypothesis', 'hypotheses')} in ${path}: ${grounded} grounded and ${total - grounded} ungrounded. `
    + 'This section is model output, not evidence. Code-map did not verify the claims, and the hypotheses change no check, rating or readiness. '
    + 'A grounded hypothesis names only evidence IDs that these results use. An ungrounded hypothesis names at least one other ID.';
  const ids = (list) => series((Array.isArray(list) ? list : []).map((id) => code(visible(id), 120)), 3);
  const row = (item) => [code(item.id, 64), plain(item.kind, 40), plain(visible(item.claim), 300),
    item.grounded === true ? `Grounded. Evidence: ${ids(item.evidenceIds)}.` : `Ungrounded: ${ids(item.missingEvidenceIds)} ${item.missingEvidenceIds?.length === 1 ? 'is' : 'are'} not in the results.`,
    isRecord(item.proposedTest) ? `${plain(visible(item.proposedTest.name), 100)} in ${code(visible(item.proposedTest.file), 120)}` : 'None'];
  // The heading, the paragraph and their empty lines take 4 lines. A table takes 3 more lines and 1 for each row, and a cut table 2 more.
  let fit = Math.min(5, total);
  while (fit > 0 && 7 + fit + (total > fit ? 2 : 0) > room) fit--;
  if (fit === 0) return [...head, `${intro}${total ? ` The hypotheses are in ${resultsFile}.` : ''}`, ''];
  return [...head, intro, '', ...table(['Hypothesis', 'Kind', 'Claim (model output)', 'Evidence IDs', 'Proposed test'], items.slice(0, fit).map(row)), '',
    ...(total > fit ? [...rest(fit, total, 'hypotheses'), ''] : [])];
}
