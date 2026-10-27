// Authorizations of code-map run. The user makes an authorization before a run: the repository (as the SHA-256 digest of its
// real path), the exact command words, the maximum budgets, the creation time and the expiry time. A run without a matching
// authorization that has not expired is refused. The clock is a parameter, so that the tests can give any time.
import { installPolicy, storedInstallProblem } from './install.mjs';
import { trustPolicy } from '../trust.mjs';
import { commandProblem } from './command.mjs';
export { commandProblem } from './command.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { realPath } from '../inspect.mjs';
import { readPrivateFile, requirePrivateFolder, storeFolder, writePrivateFile } from '../store.mjs';
import { budgetFlags, budgetProblem, checkBudgets } from './budgets.mjs';

const authorizationIdPattern = /^AUTH-[0-9a-f]{16}$/;
/** An authorization expires after 7 days when the user gives no --expires-days, and after at most 90 days. */
export const expiryDays = { default: 7, maximum: 90 };
const recordType = 'code-map-run-authorization', fields = ['recordType', 'schemaVersion', 'id', 'repository', 'command', 'budgets', 'createdAt', 'expiresAt'];
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, sha256Pattern = /^[0-9a-f]{64}$/, day = 24 * 60 * 60 * 1000;
const maxRecordBytes = 1024 * 1024;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const quoted = (value) => JSON.stringify(String(value)).slice(0, 120);

/** The digest that names a repository: the SHA-256 of its real path. */
export const repositoryDigest = (repository) => createHash('sha256').update(realPath(repository)).digest('hex');

/** A new authorization record. `now` is the creation time, and the record expires `expiresDays` whole days later. */
export function newAuthorization({ repository, command, budgets, expiresDays = expiryDays.default, now = new Date(), trust, install, npmCache }) {
  const policy = installPolicy(install, npmCache, { repository });
  trustPolicy(trust);
  const words = commandProblem(command), limits = budgetProblem(budgets);
  if (words) throw new Error(words);
  if (!Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > expiryDays.maximum) throw new Error(`--expires-days must be a whole number from 1 to ${expiryDays.maximum}.`);
  if (limits) throw new Error(`An authorization needs valid budgets: ${limits}.`);
  return { recordType, schemaVersion: 1, id: `AUTH-${randomBytes(8).toString('hex')}`, repository: { digest: repositoryDigest(repository) }, command: [...command],
    ...(trust === undefined ? {} : { trust }), ...(policy ? { install: policy } : {}), budgets: Object.fromEntries(Object.keys(budgetFlags).filter((name) => budgets[name] !== undefined).map((name) => [name, budgets[name]])), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + expiresDays * day).toISOString() };
}

/** Why a stored record is not a valid authorization with this ID, or null. The store is input like any other file. */
function problemOf(record, id) {
  if (!isRecord(record)) return 'it is not an object';
  const extra = Object.keys(record).find((key) => !fields.includes(key) && key !== 'install' && key !== 'trust'), missing = fields.find((key) => !Object.hasOwn(record, key));
  if (extra || missing) return extra ? `"${extra}" is not a field of an authorization` : `the field "${missing}" is missing`;
  const installProblem = storedInstallProblem(record.install);
  if (installProblem) return installProblem;
  try { trustPolicy(record.trust); } catch (error) { return error.message; }
  if (record.recordType !== recordType || record.schemaVersion !== 1) return `it is not a ${recordType} with schema version 1`;
  if (record.id !== id) return `it holds the authorization ${quoted(record.id)}`;
  if (!isRecord(record.repository) || Object.keys(record.repository).join() !== 'digest' || !sha256Pattern.test(record.repository.digest)) return 'its repository is not a SHA-256 digest';
  const words = commandProblem(record.command), limits = budgetProblem(record.budgets);
  if (words || limits) return `its command or budgets are not valid: ${words ?? limits}`;
  if (![record.createdAt, record.expiresAt].every((time) => typeof time === 'string' && iso.test(time) && !Number.isNaN(Date.parse(time)))) return 'its times are not ISO 8601 UTC times';
  return Date.parse(record.expiresAt) > Date.parse(record.createdAt) ? null : 'it expires before it was created';
}

/** Saves the record in the authorizations folder of the store, private to the user. Returns the path of the file. */
export function saveAuthorization(root, record) {
  const problem = problemOf(record, record?.id);
  if (problem) throw new Error(`The store refuses the authorization ${quoted(record?.id)}: ${problem}.`);
  const path = join(storeFolder(root, 'authorizations'), `${record.id}.json`);
  writePrivateFile(path, `${JSON.stringify(record, null, 2)}\n`);
  return path;
}

/** The authorization with this ID. An unknown ID, a planted file or a damaged record is refused. */
export function loadAuthorization(root, id) {
  if (typeof id !== 'string' || !authorizationIdPattern.test(id)) throw new Error(`${quoted(id)} is not an authorization ID. An authorization ID looks like AUTH-0123456789abcdef.`);
  const folder = join(root, 'authorizations'), path = join(folder, `${id}.json`);
  const unreadable = (problem) => new Error(`The authorization ${id} in the store (${path}) is unreadable: ${problem}. Ask the user for a new one with code-map authorize.`);
  let bytes = null, record;
  try {
    if (existsSync(folder)) { requirePrivateFolder(folder, 'Remove it, or choose another store with --store <folder>.'); bytes = readPrivateFile(path, maxRecordBytes); }
  } catch (error) { throw unreadable(error instanceof Error ? error.message : String(error)); }
  if (bytes === null) throw new Error(`The authorization ${id} is not in the store (${folder}). Ask the user to authorize the command first: code-map authorize --command <words...>.`);
  try { record = JSON.parse(bytes.toString('utf8')); } catch { throw unreadable('it is not valid JSON'); }
  const problem = problemOf(record, id);
  if (problem) throw unreadable(problem);
  return record;
}

/**
 * Refuses a run that the authorization does not cover. That is a time before its creation or after its expiry, another
 * repository, or a budget above its maximum. Each command word must also be the same, in the same order.
 */
export function checkAuthorization(record, { repository, command, budgets, now, install, npmCache }) {
  const policy = installPolicy(install, npmCache, { repository });
  if (record.install?.mode !== policy?.mode || record.install?.npmCache !== policy?.npmCache) throw new Error('The authorization does not cover this install policy. Ask the user for a matching authorization.');
  const time = now.getTime();
  if (time < Date.parse(record.createdAt)) throw new Error(`The authorization ${record.id} was created after the current time (${record.createdAt}). Check the clock of this computer.`);
  if (time >= Date.parse(record.expiresAt)) throw new Error(`The authorization ${record.id} expired at ${record.expiresAt}. Ask the user for a new one with code-map authorize.`);
  if (record.repository.digest !== repositoryDigest(repository)) throw new Error(`The authorization ${record.id} is for another repository. An authorization is valid only in the repository where the user made it.`);
  if (record.command.length !== command.length || record.command.some((word, index) => word !== command[index])) {
    throw new Error(`The authorization ${record.id} is for other command words: ${JSON.stringify(record.command)}. Give exactly these words after "--", or ask the user for a new authorization.`);
  }
  checkBudgets(budgets, record.budgets);
}
