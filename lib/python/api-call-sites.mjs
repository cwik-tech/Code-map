// Bind Python call facts to import targets and the shared API alias walk.
import { pythonCall } from './api.mjs';

export function pythonUses(path, python, targets) {
  const uses = new Map();
  for (const call of python.apiCalls ?? []) {
    for (const binding of python.publicApi?.bindings ?? []) {
      const specifier = '.'.repeat(binding.level) + binding.module;
      const target = Object.hasOwn(binding, 'target') ? binding.target : targets.get(specifier);
      const imported = binding.importedName ?? binding.name;
      if (!target || call.name !== binding.local && !call.name.startsWith(`${binding.local}.`)) continue;
      const suffix = call.name.slice(binding.local.length).replace(/^\./, '');
      const name = imported === '*' ? suffix || '*' : suffix ? `${imported}.${suffix}` : imported;
      const key = `${target}#${name}`;
      if (!uses.has(key)) uses.set(key, []);
      uses.get(key).push({ line: call.line, column: call.column, use: 'call', args: call.positional,
        positional: call.positional, keywords: call.keywords, reason: call.reason, python: true });
    }
  }
  return uses;
}
export const pythonCompatibility = (site, record) => pythonCall(site, record);
