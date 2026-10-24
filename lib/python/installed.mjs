// Read virtual-environment metadata only. Symlinks and environment programs are never followed.
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync } from 'node:fs';
import { join, posix } from 'node:path';
import { normalizeDistribution } from './declarations.mjs';

export const installedLimits = { files: 2048, bytes: 1024 * 1024, totalBytes: 8 * 1024 * 1024, folders: 4096 };
export function installedPythonDistributions(repository) {
  const distributions = [], unknown = [];
  let files = 0, bytes = 0, folders = 0;
  const safe = (path) => {
    try { return !path.split('/').some((_, i, parts) => lstatSync(join(repository, ...parts.slice(0, i + 1))).isSymbolicLink()); } catch { return false; }
  };
  const directory = (path) => { try { return safe(path) && lstatSync(join(repository, path)).isDirectory(); } catch { return false; } };
  const regular = (path) => { try { return safe(path) && lstatSync(join(repository, path)).isFile(); } catch { return false; } };
  const children = (path) => {
    if (++folders > installedLimits.folders) { unknown.push({ path, reason: 'environment-folder-limit' }); return []; }
    if (!safe(path)) return [];
    let directory;
    try {
      directory = opendirSync(join(repository, path));
      const entries = [];
      for (let entry; (entry = directory.readSync()) !== null;) {
        if (entries.length >= installedLimits.folders) { unknown.push({ path, reason: 'environment-directory-entry-limit' }); break; }
        entries.push(entry);
      }
      return entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    } catch { unknown.push({ path, reason: 'environment-directory-unreadable' }); return []; } finally { directory?.closeSync(); }
  };
  const text = (path) => {
    let fd;
    try {
      if (!safe(path) || !lstatSync(join(repository, path)).isFile()) return null;
      fd = openSync(join(repository, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      if (!stat.isFile()) return null;
      if (++files > installedLimits.files || stat.size > installedLimits.bytes || bytes + stat.size > installedLimits.totalBytes) {
        unknown.push({ path, reason: 'environment-metadata-limit' }); return null;
      }
      const buffer = Buffer.alloc(Math.min(installedLimits.bytes, installedLimits.totalBytes - bytes) + 1);
      let count = 0, read;
      while (count < buffer.length && (read = readSync(fd, buffer, count, buffer.length - count, null)) > 0) count += read;
      if (count >= buffer.length) { unknown.push({ path, reason: 'environment-metadata-limit' }); return null; }
      bytes += count;
      return buffer.subarray(0, count).toString('utf8');
    } catch { unknown.push({ path, reason: 'environment-metadata-unreadable' }); return null; }
    finally { if (fd !== undefined) closeSync(fd); }
  };
  const environments = children('.').filter((d) => d.isDirectory() && (['.venv', 'venv', 'env'].includes(d.name) || regular(posix.join(d.name, 'pyvenv.cfg')))).map((d) => d.name);
  for (const env of environments) {
    const sites = [posix.join(env, 'Lib/site-packages'), posix.join(env, 'lib/site-packages')];
    for (const lib of ['lib', 'lib64']) if (directory(posix.join(env, lib))) {
      for (const version of children(posix.join(env, lib))) if (version.isDirectory() && /^python\d+\.\d+$/.test(version.name)) sites.push(posix.join(env, lib, version.name, 'site-packages'));
    }
    for (const site of new Set(sites)) {
      if (!directory(site)) continue;
      for (const info of children(site)) {
        if (files >= installedLimits.files || bytes >= installedLimits.totalBytes) { unknown.push({ path: site, reason: 'environment-metadata-limit' }); return { distributions, unknown }; }
        if (!info.isDirectory() || !info.name.endsWith('.dist-info')) continue;
        const name = normalizeDistribution(info.name.replace(/\.dist-info$/, '').replace(/-[^-]+$/, ''));
        const folder = posix.join(site, info.name), top = text(posix.join(folder, 'top_level.txt'));
        let names = top?.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^[A-Za-z_]\w*(?:\.\w+)*$/.test(s)) ?? [];
        if (!names.length) {
          const record = text(posix.join(folder, 'RECORD'));
          names = record?.split(/\r?\n/).flatMap((line) => {
            const path = line.split(',')[0].replace(/^"|"$/g, '').replace(/\.(?:cpython-[\w-]+|abi3)(?=\.(?:so|pyd)$)/, '');
            if (!/^[A-Za-z_]\w*(?:\/[A-Za-z_]\w*)*\.(?:py|so|pyd)$/.test(path) && !/^[A-Za-z_]\w*\/.*\.py$/.test(path)) return [];
            if (path.includes('.dist-info/') || path.startsWith('../')) return [];
            const parts = path.replace(/\.(?:py|so|pyd)$/, '').split('/');
            if (parts.at(-1) === '__init__') parts.pop();
            return parts.length ? [parts.join('.')] : [];
          }) ?? [];
        }
        if (names.length) distributions.push({ name, imports: [...new Set(names)], path: folder });
        else unknown.push({ path: folder, reason: 'environment-import-names-unavailable' });
      }
    }
  }
  return { distributions, unknown };
}
