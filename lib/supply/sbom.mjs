// CycloneDX 1.5 inventory export. No execution, clock or network access.
const algorithms = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };
/** Decode supported SRI tokens. Unknown algorithms and malformed tokens give no hash. */
export function integrityHashes(value) {
  if (typeof value !== 'string') return [];
  return value.split(/\s+/).flatMap((token) => {
    const match = /^(sha1|sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})(?:\?\S*)?$/.exec(token);
    if (!match) return [];
    const content = Buffer.from(match[2], 'base64').toString('hex');
    return content.length === { sha1: 40, sha256: 64, sha384: 96, sha512: 128 }[match[1]] ? [{ alg: algorithms[match[1]], content }] : [];
  });
}
/** Build the BOM from the selected snapshot inventory. Unresolved edges stay absent. */
export function buildSbom(supply) {
  if (!supply?.lockfile) throw new Error('SBOM needs a supported lockfile that Code-map can read.');
  const packages = supply.packages;
  if (new Set(packages.map((p) => p.path)).size !== packages.length) throw new Error('SBOM component references must be unique. Duplicate install paths are refused.');
  const components = packages.map((item) => ({ type: 'library', 'bom-ref': item.path, name: item.name,
    ...(item.version ? { version: item.version, purl: `pkg:npm/${item.name.split('/').map(encodeURIComponent).join('/')}@${encodeURIComponent(item.version)}` } : {}),
    ...(item.license ? { licenses: [{ expression: item.license }] } : {}),
    ...(item.hashes?.length ? { hashes: item.hashes } : {}) }));
  const dependencies = packages.map((item) => ({ ref: item.path, dependsOn: [...new Set(item.dependencies ?? [])].sort() }));
  return { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1, components, dependencies };
}
