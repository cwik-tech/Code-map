// Safe bounded readers for schema text, deployment declarations and Markdown examples.
import { parseGraphql } from './graphql.mjs';
import { parseProto } from './proto.mjs';
/** Paths whose contents affect the new informational evidence. */
export const protocolPath = (path) => /\.(?:graphql|gql|proto)$/.test(path) && !path.split('/').includes('node_modules');
export const deploymentPath = (path) => /(?:^|\/)(?:Dockerfile|vercel\.json|docker-compose\.ya?ml)$/.test(path) && !path.split('/').includes('node_modules');
export const examplePath = (path) => path === 'README.md' || /^docs\/.+\.md$/.test(path);
/** Read regular files only. Never follow symlinks. Return reasons without retaining raw values. */
export function boundedInputs(paths, reader, select, parse, max = 1024 * 1024) {
  const wanted = paths.filter(select).sort();
  const parents = (path) => path.split('/').slice(0, -1).map((_, index) => path.split('/').slice(0, index + 1).join('/'));
  const info = reader.stat([...new Set([...wanted, ...wanted.flatMap(parents)])]);
  return wanted.map((path) => {
    const item = info.get(path), reason = !item ? 'missing' : item.link || parents(path).some((parent) => info.get(parent)?.link) ? 'symlink' : !item.file ? 'not-regular' : item.size > max ? 'too-large' : null;
    if (reason) return { path, state: 'UNKNOWN', reason };
    let text;
    try { text = reader.read([path]).get(path); } catch { return { path, state: 'UNKNOWN', reason: 'unreadable' }; }
    if (text === undefined || Buffer.byteLength(text) > max) return { path, state: 'UNKNOWN', reason: text === undefined ? 'missing' : 'too-large' };
    return { path, ...parse(path, text) };
  });
}
/** Schema documents retain only the supported declarations and explicit gaps. */
export function protocolInputs(paths, reader) {
  return boundedInputs(paths, reader, protocolPath, (path, text) => path.endsWith('.proto') ? parseProto(text) : parseGraphql(text))
    .map((x) => ({ format: x.path.endsWith('.proto') ? 'proto' : 'graphql', types: [], gaps: [], ...x }));
}
