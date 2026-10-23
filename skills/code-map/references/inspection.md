# Command and extraction recipes

Use these when collecting a report or extracting evidence. Check `code-map --help` first: commands below describe the existing inspection interface, not the verification roadmap. Run from the assigned checkout. Substitute real mapped source paths and a task-specific temporary output path.

## Default: summary first

```sh
code-map inspect --summary --worktree --change uncommitted
code-map inspect --summary --ref HEAD --file src/example.ts
```

The summary prints the analysis ID (`A-…`), up to 20 findings and a `next` command for each one, for example `code-map inspect --analysis A-0123456789abcdef --finding CYCLE-VALUE-3f9a2c1b4e`. Run only the commands that the question needs. Long lists come in pages: `--file <path> --part tests.transitive` (or a finding's part) returns 20 items, the total and the command for the next page. The first summary of a snapshot analyzes the whole project; later summaries with the same inputs and all follow-ups reuse the stored analysis. If the sandbox cannot write to `~/.cache/code-map`, add `--store <writable folder>`; the printed commands then include it. For a review of a change, add `--base <ref>` (for example `--base main`): each finding then shows `baseline` (`NEW`, `EXISTING`, `RESOLVED` or `UNKNOWN`), and NEW findings come first. Refer to `docs/retrieval.md` in the Code-map checkout for all commands and fields.

## Classic report: selected files

```sh
code-map inspect --worktree --file src/example.ts --out /tmp/code-map-task.json
```

Repeat `--file` for multiple source files. For a committed snapshot, replace `--worktree` with `--ref HEAD` or the assigned ref. Do not rely on automatic branch selection: it can choose a different branch.

## When the task concerns a change set

```sh
code-map inspect --worktree --change uncommitted --out /tmp/code-map-task.json
```

Use `--ref HEAD --change latest` for the latest mapped source-changing commit. `--change branch` depends on an available branch base. Inspect `selection.missing` for deleted paths; they have no current declarations. A historical map does not supply current working-tree coverage.

## Extract an overview without printing the complete report

Node.js is already required by Code-map:

```sh
node --input-type=module - /tmp/code-map-task.json <<'JS'
import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
console.log(JSON.stringify({
  snapshot: report.snapshot,
  selectedFiles: report.selection?.files?.length,
  missing: report.selection?.missing,
  summary: report.summary,
  nextSteps: report.testSummary?.nextSteps,
  limits: report.limits
}, null, 2));
JS
```

Then extract only the file record or test cases needed for the investigation. Limit displayed path/evidence lists and state how many entries were omitted; do not silently treat a truncated list as complete. Current file filtering reduces output size after whole-project collection, so it does not guarantee a cheap analysis run.

## When a full report is justified

Omit `--file`/`--change` only for a genuinely whole-project question, a full archive or collector debugging. Keep the output on disk and extract bounded sections. Do not replace all test paths with counts: paths remain necessary for investigating and selecting tests.

For a stored analysis, `code-map inspect --analysis <id> --full --out /tmp/code-map-full.json` writes the full report without collecting again. If the installed CLI help does not list `--summary`, do not invent `--summary`, `--finding` or analysis IDs. Do not invent `verify`, `run` or verification results in any version: they are not implemented. Never mix findings from different analysis IDs without disclosing the difference.

For unusual fields or unresolved classifications, read `docs/inspection.md` in the Code-map checkout. Do not preload that full reference for routine impact questions.
