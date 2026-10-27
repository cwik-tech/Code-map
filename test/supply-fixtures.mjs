// Fixtures for the supply-chain tests: lockfiles in npm's own two-space layout, as `npm install` writes them, and the
// JSON output of `npm audit --json` (npm 7 and later).

/** A `packages` entry of a registry package: resolved URL, integrity and license. */
export const registry = (name, version, extra = {}) => ({ version, resolved: `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${version}.tgz`,
  integrity: `sha512-${Buffer.from(`${name}@${version}`).toString('base64')}`, license: 'MIT', ...extra });

/** A lockfile of version 2 or 3: the root project and these `packages` entries. */
export const lockfile = (packages, version = 3) => `${JSON.stringify({ name: 'app', version: '1.0.0', lockfileVersion: version, requires: true,
  packages: { '': { name: 'app', version: '1.0.0', license: 'MIT' }, ...packages } }, null, 2)}\n`;

/** The line of a `packages` key in a lockfile text. */
export const lineOf = (text, key) => text.split('\n').indexOf(`    ${JSON.stringify(key)}: {`) + 1;

/** One package of an inventory, with the fields that readSupply records. */
export const item = (name, version, extra = {}) => ({ path: `node_modules/${name}`, name, version, kind: 'remote', host: 'registry.npmjs.org', integrity: true,
  installScript: false, license: 'MIT', dev: false, optional: false, peer: false, line: null, ...extra });

/** An inventory as the analysis stores it: one read lockfile and these packages. */
export const supplyOf = (packages, extra = {}) => ({ lockfile: 'package-lock.json', lockfileVersion: 3,
  lockfiles: [{ path: 'package-lock.json', manager: 'npm', state: 'read', lockfileVersion: 3, packages: packages.length }], nested: { count: 0, paths: [] },
  packages, policy: null, ...extra });

/** An npm audit report: two advisories of lodash, one transitive effect and one advisory of minimist. */
export const auditJson = () => ({
  auditReportVersion: 2,
  vulnerabilities: {
    lodash: { name: 'lodash', severity: 'critical', isDirect: true, effects: ['request-helper'], range: '<=4.17.20', nodes: ['node_modules/lodash'], fixAvailable: true, via: [
      { source: 1096305, name: 'lodash', dependency: 'lodash', title: 'Prototype Pollution in lodash', url: 'https://github.com/advisories/GHSA-jf85-cpcp-j695',
        severity: 'critical', cwe: ['CWE-1321'], cvss: { score: 9.1, vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N' }, range: '<4.17.12' },
      { source: 1094499, name: 'lodash', dependency: 'lodash', title: 'Command Injection in lodash', url: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm',
        severity: 'high', cwe: ['CWE-77'], cvss: { score: 7.2, vectorString: null }, range: '<4.17.21' }] },
    'request-helper': { name: 'request-helper', severity: 'critical', isDirect: false, via: ['lodash'], effects: [], range: '1.0.0 - 1.2.0',
      nodes: ['node_modules/request-helper'], fixAvailable: { name: 'request-helper', version: '2.0.0', isSemVerMajor: true } },
    minimist: { name: 'minimist', severity: 'moderate', isDirect: false, effects: [], range: '<0.2.4', nodes: ['node_modules/minimist'], fixAvailable: true, via: [
      { source: 1096466, name: 'minimist', dependency: 'minimist', title: 'Prototype Pollution in minimist', url: 'https://github.com/advisories/GHSA-xvch-5gv4-984h',
        severity: 'moderate', cwe: [], cvss: {}, range: '<0.2.4' }] },
  },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 2, total: 3 },
    dependencies: { prod: 4, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 4 } },
});
