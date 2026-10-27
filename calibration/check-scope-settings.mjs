// Cases for the scope check (scope.allowed-paths) and the settings check (completeness.settings-unchanged).
import { gitignore, srcA } from './common.mjs';

const settingsBase = { '.gitignore': gitignore, '.code-map.json': '{"history":400}\n', 'src/a.ts': srcA };

export const cases = [
  {
    id: 'scope-outside',
    name: 'A changed path outside the allowed paths fails the scope check',
    defect: true,
    base: { '.gitignore': gitignore, 'src/a.ts': srcA, 'scripts/run.js': 'export const run = 1;\n' },
    head: { 'scripts/run.js': 'export const run = 2;\n' },
    request: { intent: 'Change a script.', allowedPaths: ['src/**'] },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'scope.allowed-paths': 'FAIL' } },
  },
  {
    id: 'scope-clean',
    name: 'A change inside the allowed paths passes the scope check',
    defect: false,
    base: { '.gitignore': gitignore, 'src/a.ts': srcA, 'scripts/run.js': 'export const run = 1;\n' },
    head: { 'src/a.ts': 'export const a = 2;\n' },
    request: { intent: 'Change a.', allowedPaths: ['src/**'] },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'scope.allowed-paths': 'PASS' } },
  },
  {
    id: 'settings-edited',
    name: 'A change of the Code-map settings fails the settings-unchanged check',
    defect: true,
    base: settingsBase,
    head: { '.code-map.json': '{"history":100}\n' },
    request: { intent: 'Change the settings.', allowedPaths: ['**'] },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'completeness.settings-unchanged': 'FAIL' } },
  },
  {
    id: 'settings-clean',
    name: 'A change that leaves the settings alone passes the settings-unchanged check',
    defect: false,
    base: settingsBase,
    head: { 'src/a.ts': 'export const a = 2;\n' },
    request: { intent: 'Change a.', allowedPaths: ['src/**'] },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'completeness.settings-unchanged': 'PASS' } },
  },
];
