// Loaded with Node --import inside the sandbox. No project module executes on the host.
import Module, { createRequire, register } from 'node:module';
import { record, wrapApi } from './recorder.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
try {
  require.resolve('xstate');
  record({ type: 'status', state: 'UNKNOWN', reason: 'XState is installed but no supported actor observation exists.' });
} catch (error) {
  record({ type: 'status', state: 'UNKNOWN', reason: error.code === 'MODULE_NOT_FOUND' ? 'XState is not installed.' : 'XState cannot be resolved.' });
}
register('./loader.mjs', import.meta.url);
const original = Module._load;
Module._load = function(specifier, ...args) {
  const api = original.call(this, specifier, ...args);
  if (specifier !== 'xstate') return api;
  return wrapApi(api);
};
