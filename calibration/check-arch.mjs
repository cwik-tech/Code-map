// Cases for structure.architecture-rules: a new forbidden import, a new import in the allowed direction, a pre-existing break
// and a change in a project without rules. The rule "core -> ui" forbids an import from src/core into src/ui (lib/rules.mjs).
import { gitignore } from './common.mjs';

const engine = "export function engine() { return 1; }\n";
const view = "export function view() { return 'v'; }\n";
const rules = '{"rules":["core -> ui"]}\n';

export const cases = [
  {
    id: 'arch-new-break',
    name: 'A new forbidden import fails the architecture-rule check and blocks',
    defect: true,
    base: { '.gitignore': gitignore, '.code-map.json': rules, 'src/core/engine.ts': engine, 'src/ui/view.ts': view },
    head: { 'src/core/engine.ts': "import { view } from '../ui/view';\nexport function engine() { return view().length; }\n" },
    request: { intent: 'Let the engine use the view.' },
    expected: { readiness: 'BLOCKED', checks: { 'structure.architecture-rules': 'FAIL' } },
  },
  {
    id: 'arch-clean',
    name: 'A new import in the allowed direction passes the architecture-rule check',
    defect: false,
    base: { '.gitignore': gitignore, '.code-map.json': rules, 'src/core/engine.ts': engine, 'src/ui/view.ts': view },
    head: { 'src/ui/view.ts': "import { engine } from '../core/engine';\nexport function view() { return String(engine()); }\n" },
    request: { intent: 'Let the view use the engine.' },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'structure.architecture-rules': 'PASS' } },
  },
  {
    id: 'arch-existing-break',
    name: 'A rule break that the base already has does not fail the check',
    defect: false,
    base: { '.gitignore': gitignore, '.code-map.json': rules, 'src/core/engine.ts': "import { view } from '../ui/view';\nexport function engine() { return view().length; }\n",
      'src/ui/view.ts': view },
    head: { 'src/ui/view.ts': "export function view() { return 'w'; }\n" },
    request: { intent: 'Change the view.' },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'structure.architecture-rules': 'PASS' } },
  },
  {
    id: 'arch-no-rules',
    name: 'A project without architecture rules gives NOT_APPLICABLE',
    defect: false,
    base: { '.gitignore': gitignore, 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 2;\n' },
    head: { 'src/a.ts': 'export const a = 2;\n' },
    request: { intent: 'Change a.' },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'structure.architecture-rules': 'NOT_APPLICABLE' } },
  },
];
