// Resolve cached literal paths against the current snapshot.
import { scriptFiles } from './packages/reach.mjs';
import { readManifests } from './packages/manifests.mjs';
import { scanPathCandidates } from './path-candidates.mjs';

export function pathEntries(texts, sources, resolve, aliases, fileFacts = null) {
  const known = new Set(sources), entries = [], unknown = [];
  const add = (path, via, reason) => { if (known.has(path) && !entries.some((item) => item.path === path && item.via === via && item.reason === reason)) entries.push({ path, via, reason }); };
  for (const manifest of readManifests(texts).manifests) for (const script of manifest.scripts) {
    for (const path of scriptFiles(script, manifest, resolve, sources, aliases)) add(path, manifest.path, 'package-script');
  }
  for (const [from, text] of texts) {
    if (!/\.[cm]?[jt]sx?$/.test(from)) continue;
    for (const candidate of fileFacts?.get(from)?.pathCandidates ?? scanPathCandidates(from, text)) {
      let found = false;
      for (const literal of candidate.literals) {
        const target = resolve(from, literal.startsWith('.') ? literal : `./${literal}`);
        if (target) { add(target, from, `path-start:${candidate.name}`); found = true; }
      }
      if (!found && candidate.name !== 'import') unknown.push({ via: from, reason: 'unresolved-path-start', line: candidate.line });
    }
  }
  return { entries: entries.sort((a, b) => a.path.localeCompare(b.path) || a.via.localeCompare(b.via)), unknown };
}
