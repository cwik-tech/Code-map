// ESM imports use a facade. The real package keeps its own relative imports and exports.
const wrappers = new Map();
/** Redirects only public XState imports, with the installed package resolver. */
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (specifier !== 'xstate') return result;
  const url = result.url + '#code-map-xstate';
  wrappers.set(url, result.url);
  return { url, shortCircuit: true };
}
/** Preserves package exports while replacing the two actor factories. */
export async function load(url, context, nextLoad) {
  if (!wrappers.has(url)) return nextLoad(url, context);
  const original = JSON.stringify(wrappers.get(url)), recorder = JSON.stringify(new URL('./recorder.mjs', import.meta.url).href);
  const loaded = await nextLoad(wrappers.get(url), context);
  // Preserve the default namespace that Node gives CommonJS imports.
  const compatibility = loaded.format === 'commonjs' ? 'const packageDefault = wrapApi(api.default); export { packageDefault as default };' : '';
  return { format: 'module', shortCircuit: true, source: `export * from ${original};
import * as api from ${original};
import { wrap, wrapApi } from ${recorder};
export const createActor = wrap(api.createActor, 5);
export const interpret = wrap(api.interpret, typeof api.createActor === 'function' ? 5 : 4);
${compatibility}
` };
}
