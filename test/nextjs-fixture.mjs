// The Next.js fixture of the framework tests: a small App Router project with one case for each Next.js rule, in a new
// temporary Git repository. This file has no tests, and `npm test` does not run it.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, mapData } from '../lib/build.mjs';
import { deriveFindings } from '../lib/findings.mjs';
import { loadConfig } from '../lib/project.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));

/** Each file of the fixture. A comment names the rule case that the file holds. */
export const nextFiles = {
  'package.json': JSON.stringify({ name: 'shop', dependencies: { next: '15.1.0', react: '19.0.0' } }),
  'app/layout.tsx': 'export default function RootLayout({ children }: { children: unknown }) { return <html><body>{children}</body></html>; }\n',
  // A server page: an event handler on a DOM element (finding), and imports of a shared component and of server code.
  'app/page.tsx': "import { Counter } from '../components/counter';\nimport { Widget } from '../components/widget';\nimport { Leaky } from '../components/leaky';\n"
    + "import { query } from '../lib/db';\nimport { format } from '../lib/format';\nimport { load } from '../lib/loader';\n"
    + 'export default async function Page() {\n  const rows = await query(load);\n  return <main><Counter /><Widget /><Leaky />{format(rows)}<button onClick={() => rows}>Go</button></main>;\n}\n',
  // A shared component without 'use client' that the server page imports: useState here is a finding.
  'components/counter.tsx': "import { useState } from 'react';\nexport function Counter() {\n  const [count] = useState(0);\n  return <p>{count}</p>;\n}\n",
  // A client component with hooks, a handler and public variables: no finding.
  'components/widget.tsx': "'use client';\nimport { useEffect, useState } from 'react';\nimport { format } from '../lib/format';\nimport { tidy } from '../lib/tidy';\n"
    + 'export function Widget() {\n  const [on, setOn] = useState(false);\n  useEffect(() => {}, []);\n'
    + '  return <button onClick={() => setOn(!on)}>{format(process.env.NEXT_PUBLIC_API_URL)}{process.env.NODE_ENV}{tidy(on)}</button>;\n}\n',
  // A client component that reads a private variable, imports a Node.js built-in and imports server-only code.
  'components/leaky.tsx': "'use client';\nimport { readFileSync } from 'fs';\nimport type { NextRequest } from 'next/server';\nimport { secret } from '../lib/secret';\nimport { query } from '../lib/db';\n"
    + 'export function Leaky(request?: NextRequest) {\n  return <p>{process.env.DATABASE_URL}{secret}{String(readFileSync)}{String(query)}{String(request)}</p>;\n}\n',
  // Server code: the page imports it, and a client component imports it through the boundary.
  'lib/db.ts': "import 'server-only';\nexport async function query(load: unknown) { return [load]; }\n",
  // Only a client module imports this file, so it is client code that imports server-only.
  'lib/secret.ts': "import 'server-only';\nexport const secret = 'key';\n",
  // Both the server page and a client component import this file, so it counts as a server module: no finding.
  'lib/format.ts': 'export const format = (value: unknown) => String(value) + (process.env.DATABASE_URL ?? \'\');\n',
  'lib/tidy.ts': 'export const tidy = (value: unknown) => String(value).trim();\n',
  // A computed dynamic import: Code-map cannot classify its target.
  'lib/loader.ts': 'export const load = (name: string) => import(name);\n',
  'lib/unused.ts': 'export const unused = 1;\n',
  // A 'use server' file: one async function (no finding) and two other exports (findings).
  'app/actions.ts': "'use server';\nexport async function save(form: unknown) { return form; }\nexport const limit = 10;\nexport function check() { return true; }\nexport type Form = { id: string };\n",
  'app/(marketing)/about/page.tsx': 'export default function About() { return <p>About</p>; }\n',
  'app/blog/[slug]/page.tsx': 'export default function Post() { return <p>Post</p>; }\n',
  // Code-map ignores folders named docs, so this route is in the inventory, but Code-map does not read it.
  'app/docs/[[...slug]]/page.tsx': 'export default function Docs() { return <p>Docs</p>; }\n',
  'app/@modal/(.)photo/[id]/page.tsx': 'export default function Photo() { return <p>Photo</p>; }\n',
  'app/api/users/route.ts': 'export async function GET() { return Response.json([]); }\n',
  'app/_parts/page.tsx': 'export const notARoute = 1;\n',
  // The root is outside the source roots (app, components, lib, pages), so Code-map does not read the middleware.
  'middleware.ts': 'export function middleware() { return null; }\n',
  // The Pages Router has no client boundary: no finding for this hook.
  'pages/legacy.tsx': "import { useState } from 'react';\nexport default function Legacy() { const [x] = useState(1); return <p>{x}</p>; }\n",
  'pages/api/hello.ts': 'export default function handler() { return 1; }\n',
};

/** A committed project of these files in a new temporary repository, with a temporary store. */
export function repository(t, files = nextFiles) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-next-')), store = mkdtempSync(join(tmpdir(), 'code-map-next-store-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' }).trim();
  for (const [path, text] of Object.entries(files)) put(path, text);
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'fixture');
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
  return { root, store, put, git, run };
}

/** The analysis of the committed fixture and its findings, through the same collector as `inspect`. */
export function analyzed(root) {
  const config = loadConfig(root), data = mapData(root, config, collect(root, config, { ref: 'HEAD' }), 2, false);
  return { analysis: data.analysis, findings: deriveFindings(data.analysis) };
}
