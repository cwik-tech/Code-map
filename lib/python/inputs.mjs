// Bounded packaging and command configuration texts from the same Git snapshot as the sources.
import { ignored } from '../project.mjs';
import { posix } from 'node:path';
import { declarationPath, configPath } from './declarations.mjs';

export function readPythonInputs(paths, reader) {
  const known = new Set(paths), texts = new Map(), unknown = [], queue = paths.filter((p) => declarationPath(p) || configPath(p));
  const seen = new Set(), requirements = new Set(queue.filter((p) => p.endsWith('.txt')));
  let bytes = 0, files = 0;
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i];
    if (seen.has(path)) continue;
    seen.add(path);
    const workflow = /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path);
    if (path.split('/').some((part) => part.startsWith('.')) && !workflow) continue;
    if (ignored(path) && !workflow && !declarationPath(path) && !requirements.has(path)) continue;
    if (/(?:^|\/)(?:\.env[^/]*|node_modules|\.venv|venv|env)(?:\/|$)/.test(path)) continue;
    if (++files > 512) { unknown.push({ path, reason: 'packaging-input-file-limit' }); break; }
    const stat = reader.stat([path]).get(path);
    if (!stat || stat.link || !stat.file || stat.size > 1024 * 1024 || bytes + stat.size > 8 * 1024 * 1024) { unknown.push({ path, reason: 'packaging-input-unavailable-or-limit' }); continue; }
    let text;
    try { text = reader.read([path]).get(path); } catch { text = undefined; }
    if (text === undefined) { unknown.push({ path, reason: 'packaging-input-unavailable' }); continue; }
    bytes += Buffer.byteLength(text);
    texts.set(path, text);
    if (requirements.has(path)) for (const match of text.matchAll(/^\s*(?:-[rc]\s*|--(?:requirement|constraint)(?:\s+|=))([^\r\n#]+)/gm)) {
      const target = posix.normalize(posix.join(posix.dirname(path), match[1].trim().replace(/^['"]|['"]$/g, '')));
      if (known.has(target) && !posix.isAbsolute(target) && !target.startsWith('../')) { requirements.add(target); queue.push(target); }
    }
  }
  return { texts, unknown };
}
