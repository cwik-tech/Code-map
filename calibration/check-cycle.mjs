// Cases for structure.no-new-cycle: a new import that makes a value-import cycle, and a new import that makes no cycle.
import { bImportsA, gitignore, srcA } from './common.mjs';

export const cases = [
  {
    id: 'cycle-new',
    name: 'A new value-import cycle fails the no-new-cycle check',
    defect: true,
    base: { '.gitignore': gitignore, 'src/a.ts': srcA, 'src/b.ts': bImportsA },
    head: { 'src/a.ts': "import { b } from './b';\nexport const a = b;\n" },
    request: { intent: 'Let a use b.' },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'structure.no-new-cycle': 'FAIL' } },
  },
  {
    id: 'cycle-clean',
    name: 'A new import that makes no cycle passes the no-new-cycle check',
    defect: false,
    base: { '.gitignore': gitignore, 'src/a.ts': srcA, 'src/b.ts': bImportsA },
    head: { 'src/c.ts': 'export const c = 3;\n', 'src/a.ts': "import { c } from './c';\nexport const a = c;\n" },
    request: { intent: 'Let a use the new file c.' },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'structure.no-new-cycle': 'PASS' } },
  },
];
