// Ed25519 signatures authenticate canonical manifest values against explicitly trusted keys.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { closeSync, constants, fstatSync, linkSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requirePrivateFolder, storeFolder } from '../store.mjs';
// Sort object keys recursively so formatting and property order do not affect signatures.
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);

const fingerprint = (key) => `sha256:${createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex')}`;
const publicPem = (key) => key.export({ type: 'spki', format: 'pem' });
function publicKey(value) {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('trustedRunKeys needs Ed25519 public PEM keys.');
  const key = createPublicKey(value);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('trustedRunKeys needs Ed25519 public keys.');
  return key;
}

/** Validates the configured list and normalizes its public keys. */
export function trustedKeys(value = []) {
  if (!Array.isArray(value) || value.length > 64) throw new Error('trustedRunKeys must be a list of at most 64 Ed25519 public PEM keys.');
  try { return value.map((entry) => publicPem(publicKey(entry))); }
  catch (cause) { throw new Error('trustedRunKeys must contain only Ed25519 public PEM keys.', { cause }); }
}

function readKey(file) {
  let descriptor;
  try { descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || (typeof process.getuid === 'function' && info.uid !== process.getuid()) || (info.mode & 0o777) !== 0o600 || info.size > 4096) {
      throw new Error('The signing key must be a regular file owned by this user with mode 0600.');
    }
    const key = createPrivateKey(readFileSync(descriptor));
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('The signing key must use Ed25519.');
    return key;
  } finally { closeSync(descriptor); }
}

/** Loads the machine key, or creates it once with an atomic exclusive link and mode 0600. */
export function machineKey(root, { create = true } = {}) {
  const folder = create ? storeFolder(root, 'keys') : join(root, 'keys'), file = join(folder, 'run-ed25519.pem');
  if (!create) {
    try { requirePrivateFolder(folder, 'Choose a safe store.'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  let key = readKey(file);
  if (!key && create) {
    const generated = generateKeyPairSync('ed25519'), temporary = join(folder, `.key-${process.pid}-${fingerprint(generated.publicKey).slice(7)}.tmp`);
    try {
      writeFileSync(temporary, generated.privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
      try { linkSync(temporary, file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    } finally { rmSync(temporary, { force: true }); }
    key = readKey(file);
  }
  if (!key) return null;
  const pub = createPublicKey(key);
  return { file, publicKey: publicPem(pub), fingerprint: fingerprint(pub), privateKey: key };
}

/** Signs every manifest field except the signature itself. */
export function signManifest(manifest, root) {
  const { signature: ignored, ...payload } = manifest, key = machineKey(root);
  return { ...payload, signature: { algorithm: 'Ed25519', fingerprint: key.fingerprint,
    value: sign(null, Buffer.from(canonical(payload)), key.privateKey).toString('base64') } };
}

/** Returns valid, invalid or absent. Unknown keys cannot authenticate a manifest. */
export function signatureStatus(manifest, keys) {
  if (typeof manifest !== 'object' || manifest === null || !Object.hasOwn(manifest, 'signature')) return { state: 'absent', fingerprint: null };
  const { signature, ...payload } = manifest, result = { state: 'invalid', fingerprint: typeof signature?.fingerprint === 'string' ? signature.fingerprint : null };
  if (!signature || signature.algorithm !== 'Ed25519' || typeof signature.value !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature.value)) return result;
  try {
    const key = keys.map(publicKey).find((entry) => fingerprint(entry) === signature.fingerprint);
    if (key && verify(null, Buffer.from(canonical(payload)), key, Buffer.from(signature.value, 'base64'))) result.state = 'valid';
  } catch { /* Malformed signature or public key is invalid evidence. */ }
  return result;
}

/** CLI output never contains the private key. */
export function keySummary(root) {
  const { publicKey, fingerprint } = machineKey(root);
  return { publicKey, fingerprint };
}
