// The dependency change from a base inventory to a head inventory: added, removed, upgraded, downgraded and changed packages,
// packages that now have an install script, and packages whose host or license changed. Packages match by name, so a move
// inside node_modules is no change. Local packages (workspace folders and file dependencies) are not compared. Pure.

/** The order of the complete list: the changes with the most risk first. The counts use the order of the documentation. */
const kinds = ['installScript', 'hostChanged', 'licenseChanged', 'added', 'downgraded', 'changed', 'upgraded', 'removed'];
const countOrder = ['added', 'removed', 'upgraded', 'downgraded', 'changed', 'installScript', 'hostChanged', 'licenseChanged'];
const semver = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const text = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const strip = (digits) => digits.replace(/^0+(?=\d)/, '');
/** Two whole numbers of any length, compared as text, so a long number keeps its precision. */
const number = (a, b) => strip(a).length - strip(b).length || text(strip(a), strip(b));

/** -1, 0 or 1 for two semantic versions, or null when one of them is not a semantic version (for example a Git commit). */
function compareVersions(a, b) {
  const x = semver.exec(a ?? ''), y = semver.exec(b ?? '');
  if (!x || !y) return null;
  for (let index = 1; index <= 3; index++) { const order = number(x[index], y[index]); if (order) return Math.sign(order); }
  if (!x[4] || !y[4]) return x[4] ? -1 : y[4] ? 1 : 0; // a prerelease comes before its release
  const p = x[4].split('.'), q = y[4].split('.');
  for (let index = 0; index < Math.max(p.length, q.length); index++) {
    if (p[index] === undefined || q[index] === undefined) return p[index] === undefined ? -1 : 1;
    const digits = [/^\d+$/.test(p[index]), /^\d+$/.test(q[index])];
    const order = digits[0] && digits[1] ? number(p[index], q[index]) : digits[0] !== digits[1] ? (digits[0] ? -1 : 1) : text(p[index], q[index]);
    if (order) return Math.sign(order);
  }
  return 0;
}

/** Semantic versions in their order, then the other versions by text. */
const ordered = (versions) => [...versions].sort((a, b) => compareVersions(a, b) ?? (semver.test(a ?? '') ? -1 : semver.test(b ?? '') ? 1 : text(String(a), String(b))));
const distinct = (values) => [...new Set(values)];

/** 'none' without a lockfile at the root, 'read' with a lockfile that Code-map read, and 'unread' when it cannot read one. */
const sideState = (supply) => !supply || !supply.lockfiles.length ? 'none' : supply.lockfile !== null ? 'read' : 'unread';

function byName(supply) {
  const names = new Map();
  for (const item of supply?.packages ?? []) if (item.kind !== 'local') names.set(item.name, [...(names.get(item.name) ?? []), item]);
  return names;
}

/**
 * { state: 'compared' | 'unknown', reasons, counts, changes }. Each change is { change, name, from, to }. For one name, the
 * versions that only one side has are paired from low to high. A version 1 lockfile records no install scripts and no
 * licenses, so Code-map does not claim a new install script or a license change of a package that both sides have.
 */
export function compareSupply(base, head) {
  const unread = [['base', base], ['head', head]].filter(([, supply]) => sideState(supply) === 'unread');
  if (unread.length) {
    return { state: 'unknown', counts: null, changes: [], reasons: unread.map(([side, supply]) => `The ${side} has no lockfile that Code-map can read: `
      + `${supply.lockfiles.map((entry) => `${entry.path} (${entry.state})`).join(', ')}. Code-map cannot compare the dependencies.`) };
  }
  const reasons = [['base', base], ['head', head]].filter(([, supply]) => supply?.lockfileVersion === 1 && ['package-lock.json', 'npm-shrinkwrap.json'].includes(supply.lockfile))
    .map(([side]) => `The ${side} lockfile has version 1, which records no install scripts and no licenses. The comparison does not report them for packages that both sides have.`);
  const before = byName(base), after = byName(head), changes = [];
  const add = (change, name, from, to) => changes.push({ change, name, from, to });
  for (const name of distinct([...before.keys(), ...after.keys()]).sort(text)) {
    const old = before.get(name) ?? [], now = after.get(name) ?? [];
    const oldVersions = distinct(old.map((item) => item.version)), newVersions = distinct(now.map((item) => item.version));
    const gone = ordered(oldVersions.filter((version) => !newVersions.includes(version))), come = ordered(newVersions.filter((version) => !oldVersions.includes(version)));
    for (let index = 0; index < Math.max(gone.length, come.length); index++) {
      const from = gone[index] ?? null, to = come[index] ?? null;
      if (from === null || to === null) { add(from === null ? 'added' : 'removed', name, from, to); continue; }
      const order = compareVersions(from, to);
      add(order === null ? 'changed' : order < 0 ? 'upgraded' : order > 0 ? 'downgraded' : 'changed', name, from, to);
    }
    const scripted = now.filter((item) => item.installScript === true);
    if (scripted.length && (!old.length || old.every((item) => item.installScript === false))) add('installScript', name, null, distinct(scripted.map((item) => item.version)).join(', '));
    if (!old.length || !now.length) continue;
    const pair = (pick) => [distinct(old.map(pick)).sort(text), distinct(now.map(pick)).sort(text)];
    const [oldHosts, newHosts] = pair((item) => item.host);
    if (!oldHosts.includes(null) && !newHosts.includes(null) && oldHosts.join('\n') !== newHosts.join('\n')) add('hostChanged', name, oldHosts.join(', '), newHosts.join(', '));
    const [oldLicenses, newLicenses] = pair((item) => item.license);
    if (!oldLicenses.includes(null) && !newLicenses.includes(null) && oldLicenses.join('\n') !== newLicenses.join('\n')) add('licenseChanged', name, oldLicenses.join(', '), newLicenses.join(', '));
  }
  changes.sort((a, b) => kinds.indexOf(a.change) - kinds.indexOf(b.change) || text(a.name, b.name) || text(String(a.from), String(b.from)) || text(String(a.to), String(b.to)));
  return { state: 'compared', reasons, counts: Object.fromEntries(countOrder.map((kind) => [kind, changes.filter((entry) => entry.change === kind).length])), changes };
}
