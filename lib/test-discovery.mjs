// Command-bound discovery attestation. Only presentation and discovery switches are removed.
function commandKey(words) {
  const result = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (word === '--') { result.push(...words.slice(index)); break; }
    if (['list', 'run'].includes(word) && /(?:^|[/\\])vitest(?:\.m?js)?$/.test(words[index - 1] ?? '')) continue;
    if (['--list', '--listTests', '--dry-run', '--json', '--filesOnly'].includes(word)) continue;
    if (/^--(?:reporter|reporters|outputFile|output-file)=/.test(word)) continue;
    if (['--reporter', '--reporters', '--outputFile', '--output-file'].includes(word)) { index++; continue; }
    result.push(word);
  }
  return JSON.stringify(result);
}
/** Matches discovery and execution commands while retaining selection arguments. */
export function matchesDiscovery(list, report) {
  return !!list.run && !!report.run && list.run.workingDirectory === report.run.workingDirectory
    && commandKey(list.run.command) === commandKey(report.run.command);
}
/** Uses each discovery producer's separator for suite and case titles. */
export function discoveryName(item, kind) {
  return item.suite && item.suite !== item.file ? `${item.suite}${kind === 'mocha-list' ? ' ' : ' > '}${item.name}` : item.name;
}
/** Returns the discovered denominator and executed numerator for one bound report. */
export function attestDiscovery(list, reports) {
  const side = list.side ?? 'head';
  const matched = (reports[side] ?? []).filter((report) => matchesDiscovery(list, report));
  const counts = new Map();
  for (const report of matched) {
    const own = new Map();
    for (const item of report.cases) {
      const title = discoveryName(item, list.kind);
      const key = JSON.stringify([item.file, title]);
      const position = own.get(key) ?? 0;
      own.set(key, position + 1);
      if (item.status === 'skipped') continue;
      const positions = counts.get(key) ?? new Set();
      positions.add(position);
      counts.set(key, positions);
    }
  }
  const named = list.cases !== null;
  const inventory = named ? list.cases : list.files.map((file) => ({ file }));
  const own = new Map();
  let ran = 0;
  const files = new Set(matched.flatMap((report) => report.cases.filter((item) => item.status !== 'skipped').map((item) => item.file)));
  for (const item of inventory) {
    const key = JSON.stringify([item.file, item.name]), position = own.get(key) ?? 0;
    own.set(key, position + 1);
    if (named ? counts.get(key)?.has(position) : files.has(item.file)) ran++;
  }
  return { artifact: list.artifact, side, reports: matched.map((report) => report.artifact),
    filtered: list.filtered || matched.some((report) => report.filtered), discovered: inventory.length, ran, notRan: inventory.length - ran,
    unit: named ? 'cases' : 'files' };
}
