// Reads JUnit XML test results into test cases. A hand-written, linear scanner for the JUnit subset only:
// testsuites, testsuite, testcase, failure, error and skipped. It ignores system-out, system-err, properties and
// unknown elements. It rejects DOCTYPE and ENTITY declarations, so no external entity can load.
// Imported results show what ran only under the discovery scope and filters that the run manifest records.
// They do not prove that the runner found every test. Pure: no file access, no clock and no execution.

/** Declared producers. The parser checks the format, not the producer version. */
export const supportedProducers = [
  { name: 'JUnit XML written by Vitest, Jest (jest-junit), Playwright, pytest or Maven Surefire', versions: 'the common testsuites/testsuite/testcase subset' },
];
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const known = new Set(['testsuites', 'testsuite', 'testcase', 'failure', 'error', 'skipped']);
const namePattern = /^[A-Za-z_][\w.:-]*$/;
const maxMessage = 4096;

class JUnitError extends Error {}
const fail = (message) => { throw new JUnitError(message); };

/** Returns `{ ok: true, report }` or `{ ok: false, error }`. Untrusted input never throws. */
export function parseJUnit(text, { maxBytes = 50 * 1024 * 1024, maxCases = 200000, maxDepth = 64 } = {}) {
  if (typeof text !== 'string') return { ok: false, error: 'JUnit input must be a string.' };
  if (text.length > maxBytes || Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, error: `The JUnit input is larger than ${maxBytes} bytes.` };
  try {
    return { ok: true, report: build(scan(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text), maxCases, maxDepth) };
  } catch (error) {
    if (error instanceof JUnitError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Splits the text into start, end and text events. Each step moves forward, so the work is linear in the input size. */
function scan(text) {
  const events = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open < 0) { events.push({ type: 'text', value: decode(text.slice(index)) }); break; }
    if (open > index) events.push({ type: 'text', value: decode(text.slice(index, open)) });
    if (text.startsWith('<?', open)) index = after(text, '?>', open, 'processing instruction');
    else if (text.startsWith('<!--', open)) index = after(text, '-->', open, 'comment');
    else if (text.startsWith('<![CDATA[', open)) {
      const end = after(text, ']]>', open, 'CDATA section');
      events.push({ type: 'text', value: text.slice(open + 9, end - 3) });
      index = end;
    } else if (text.startsWith('<!', open)) fail('DOCTYPE and ENTITY declarations are not accepted.');
    else if (text.startsWith('</', open)) {
      const end = after(text, '>', open, 'end tag');
      const name = text.slice(open + 2, end - 1).trim();
      if (!namePattern.test(name)) fail(`The end tag </${name.slice(0, 40)}> has an invalid name.`);
      events.push({ type: 'end', name });
      index = end;
    } else index = startTag(text, open, events);
  }
  return events;
}

function after(text, marker, from, what) {
  const found = text.indexOf(marker, from);
  if (found < 0) fail(`A ${what} is not closed.`);
  return found + marker.length;
}

function startTag(text, open, events) {
  let index = open + 1;
  const word = () => { const begin = index; while (index < text.length && !' \t\r\n/>='.includes(text[index])) index++; return text.slice(begin, index); };
  const space = () => { while (index < text.length && ' \t\r\n'.includes(text[index])) index++; };
  const name = word();
  if (!namePattern.test(name)) fail(`A start tag has an invalid name: "${name.slice(0, 40)}".`);
  const attributes = Object.create(null);
  for (;;) {
    space();
    if (index >= text.length) fail(`The start tag <${name}> is not closed.`);
    if (text.startsWith('/>', index)) { events.push({ type: 'start', name, attributes }, { type: 'end', name }); return index + 2; }
    if (text[index] === '>') { events.push({ type: 'start', name, attributes }); return index + 1; }
    const key = word();
    if (!namePattern.test(key)) fail(`The tag <${name}> has an invalid attribute.`);
    space();
    if (text[index] !== '=') fail(`The attribute ${key} of <${name}> has no value.`);
    index++;
    space();
    const quote = text[index];
    if (quote !== '"' && quote !== "'") fail(`The attribute ${key} of <${name}> has no quoted value.`);
    const close = text.indexOf(quote, index + 1);
    if (close < 0) fail(`The attribute ${key} of <${name}> is not closed.`);
    const raw = text.slice(index + 1, close);
    if (raw.includes('<')) fail(`The attribute ${key} of <${name}> contains "<".`);
    if (Object.hasOwn(attributes, key)) fail(`The attribute ${key} appears twice in <${name}>.`);
    attributes[key] = decode(raw);
    index = close + 1;
  }
}

/** Decodes the five XML entities and numeric character references. Any other entity is an error. */
function decode(raw) {
  if (!raw.includes('&')) return raw;
  let out = '', index = 0;
  while (index < raw.length) {
    const amp = raw.indexOf('&', index);
    if (amp < 0) { out += raw.slice(index); break; }
    out += raw.slice(index, amp);
    const semi = raw.indexOf(';', amp);
    if (semi < 0 || semi - amp > 12) fail('An "&" does not start a valid entity.');
    const name = raw.slice(amp + 1, semi);
    if (Object.hasOwn(entities, name)) out += entities[name];
    else if (/^#[0-9]{1,7}$/.test(name) || /^#x[0-9A-Fa-f]{1,6}$/.test(name)) out += character(name);
    else fail(`The input uses the unknown entity "&${name.slice(0, 12)};".`);
    index = semi + 1;
  }
  return out;
}

function character(reference) {
  const code = reference[1] === 'x' ? Number.parseInt(reference.slice(2), 16) : Number.parseInt(reference.slice(1), 10);
  const valid = code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
  if (!valid) fail(`The character reference "&${reference};" is not a valid XML character.`);
  return String.fromCodePoint(code);
}

const count = (value) => value !== undefined && /^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : null;
const seconds = (value) => value !== undefined && /^\d{1,12}(?:\.\d{1,12})?$/.test(value.trim()) ? Number(value.trim()) : null;

/** Applies the JUnit nesting rules to the events and collects suites, cases, totals and count mismatches. */
function build(events, maxCases, maxDepth) {
  const stack = [], suites = [], cases = [], mismatches = [];
  let root = null, ignored = 0, suiteFrames = [];
  for (const event of events) {
    if (event.type === 'text') {
      if (!stack.length) { if (event.value.trim()) fail('Text appears outside the root element.'); continue; }
      const top = stack[stack.length - 1];
      if (top.result && !ignored) top.result.text += event.value;
      continue;
    }
    if (event.type === 'end') {
      const top = stack.pop();
      if (!top) fail(`</${event.name}> has no matching start tag.`);
      if (top.name !== event.name) fail(`</${event.name}> closes <${top.name}>; expected </${top.name}>.`);
      if (top.ignored) { ignored--; continue; }
      if (top.name === 'testsuite' || (top.name === 'testsuites' && stack.length === 0)) suiteFrames = closeSuite(top, suiteFrames, mismatches);
      if (top.result && top.result.message === null) top.result.message = top.result.text.trim().slice(0, maxMessage) || null;
      if (top.name === 'testcase') {
        finishCase(top.item);
        const counter = { failed: 'failures', errored: 'errors', skipped: 'skipped' }[top.item.status];
        for (const frame of top.frames) { frame.observed.tests++; if (counter) frame.observed[counter]++; }
      }
      continue;
    }
    const { name, attributes } = event, parent = stack[stack.length - 1];
    if (!parent) {
      if (root !== null) fail('The input has more than one root element.');
      if (name !== 'testsuites' && name !== 'testsuite') fail('The root element must be <testsuites> or <testsuite>.');
      root = name;
    }
    if (ignored || !known.has(name)) { ignored += 1; stack.push({ name, ignored: true }); continue; }
    if (name === 'testsuites' && parent) fail('<testsuites> can only be the root element.');
    if (name === 'testsuite') {
      if (parent && parent.name !== 'testsuites' && parent.name !== 'testsuite') fail('<testsuite> is inside a test case.');
      const suite = { name: attributes.name ?? null, tests: count(attributes.tests), failures: count(attributes.failures), errors: count(attributes.errors),
        skipped: count(attributes.skipped), time: seconds(attributes.time) };
      // Each case updates every enclosing suite, so a bounded depth keeps the parse linear in the input size.
      if (suiteFrames.length >= maxDepth) fail(`The suites are nested more than ${maxDepth} levels deep.`);
      suites.push(suite);
      const frame = { name, suite, observed: { tests: 0, failures: 0, errors: 0, skipped: 0 } };
      suiteFrames = [...suiteFrames, frame];
      stack.push(frame);
    } else if (name === 'testsuites') {
      const declared = { name: attributes.name ?? null, tests: count(attributes.tests), failures: count(attributes.failures), errors: count(attributes.errors), skipped: count(attributes.skipped) };
      const frame = { name, suite: declared, observed: { tests: 0, failures: 0, errors: 0, skipped: 0 } };
      suiteFrames = [...suiteFrames, frame];
      stack.push(frame);
    } else if (name === 'testcase') {
      if (!parent || parent.name !== 'testsuite') fail('A <testcase> is outside a testsuite.');
      if (typeof attributes.name !== 'string' || !attributes.name) fail('A <testcase> has no name.');
      if (cases.length === maxCases) fail(`The input has more than ${maxCases} test cases.`);
      const item = { suite: parent.suite.name, classname: attributes.classname ?? null, name: attributes.name, file: attributes.file ?? null,
        status: 'passed', todo: false, time: seconds(attributes.time), message: null, results: [] };
      cases.push(item);
      stack.push({ name, item, frames: suiteFrames });
    } else {
      if (!parent || parent.name !== 'testcase') fail(`A <${name}> is outside a testcase.`);
      const result = { kind: name, message: attributes.message ?? null, text: '' };
      parent.item.results.push(result);
      stack.push({ name, result });
    }
  }
  if (stack.length) fail(`<${stack[stack.length - 1].name}> is not closed.`);
  if (root === null) fail('The input has no root element.');
  const totals = { tests: cases.length, passed: 0, failed: 0, errored: 0, skipped: 0, todo: 0 };
  for (const item of cases) totals[item.status]++;
  return { format: 'junit', suites, cases: cases.map(({ results, ...item }) => item), totals, mismatches };
}

/** A case's status: an error wins over a failure, and a failure wins over a skip. Its message comes from that result. */
function finishCase(item) {
  const pick = ['error', 'failure', 'skipped'].map((kind) => item.results.find((result) => result.kind === kind)).find(Boolean);
  if (!pick) return;
  item.status = pick.kind === 'error' ? 'errored' : pick.kind === 'failure' ? 'failed' : 'skipped';
  item.message = pick.message === null ? null : pick.message.slice(0, maxMessage);
}

/** Adds the cases inside a closed suite to every enclosing suite, then compares declared counts with what it holds. */
function closeSuite(frame, frames, mismatches) {
  for (const key of ['tests', 'failures', 'errors', 'skipped']) {
    if (frame.suite[key] !== null && frame.suite[key] !== frame.observed[key]) mismatches.push({ suite: frame.suite.name, field: key, declared: frame.suite[key], observed: frame.observed[key] });
  }
  return frames.filter((entry) => entry !== frame);
}
