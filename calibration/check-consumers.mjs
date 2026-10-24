// Cases for completeness.consumers-updated: a moved file with a consumer left behind, and a move with every consumer updated.
import { gitignore } from './common.mjs';

const base = { '.gitignore': gitignore, 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': "import { a } from './a';\nexport const b = a;\n" };

export const cases = [
  {
    id: 'consumer-left-behind',
    name: 'A moved file with a consumer left behind fails the consumers-updated check',
    defect: true,
    base,
    head: { 'src/a.ts': null, 'src/a2.ts': 'export const a = 1;\n' },
    request: { intent: 'Move a.ts to a2.ts.' },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'completeness.consumers-updated': 'FAIL' } },
  },
  {
    id: 'consumer-updated',
    name: 'A move with every consumer updated passes the consumers-updated check',
    defect: false,
    base,
    head: { 'src/a.ts': null, 'src/a2.ts': 'export const a = 1;\n', 'src/b.ts': "import { a } from './a2';\nexport const b = a;\n" },
    request: { intent: 'Move a.ts to a2.ts and update b.' },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'completeness.consumers-updated': 'PASS' } },
  },
];
