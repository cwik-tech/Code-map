# Summary-first inspection and stored analyses

`code-map inspect --summary` analyzes one snapshot, stores the analysis outside the repository, and prints a small overview. The overview lists findings, evidence gaps and an exact follow-up command for each finding. Follow-up commands read the stored analysis by its ID. They do not collect the code again, and they tell you when the code changed after the analysis.

The classic `code-map inspect` report does not change. It keeps schema version 1, and [the inspection reference](inspection.md) describes its fields. A full report is for an archive, for debugging or for an integration. It is not the normal input for an agent prompt.

Inspection reads models without executing them. Use the [harness command](harness.md) for authorized behavioral runs, executed Zod boundaries, and table oracle freshness.
Harness runs bind to verification requests as information. They do not change stored inspection findings.

## Start with the summary

Run the summary inside the repository, and select the snapshot explicitly:

```sh
code-map inspect --summary --worktree
code-map inspect --summary --ref HEAD --change latest
```

The first summary of a snapshot collects and analyzes the whole project. A file or change selection makes the overview smaller, but it does not make the first run cheaper. The next summary with the same inputs reuses the stored analysis and does not collect again. `analysis.reused` tells you which case applies. A new analysis reuses valid file facts from the [file cache](#the-file-cache).

A `--file` or `--change` selection limits the overview to findings that touch the selected files, and to test findings for cases that reach them. The stored analysis always covers the whole project. The printed commands keep the selection.

## Follow the printed commands

Each command reads one stored analysis. Copy the commands from the output. The analysis ID starts with `A-`, and a finding ID is its rule ID followed by ten hexadecimal characters.

| Command | Output (`reportType`) |
| --- | --- |
| `code-map inspect --analysis <id>` | The summary of the stored analysis (`code-map-summary`). To scope it, add `--summary` with `--file` or `--change`; without `--summary`, those options give the file report below |
| `code-map inspect --analysis <id> --finding <finding id>` | One finding and its evidence (`code-map-finding`) |
| `code-map inspect --analysis <id> --finding <finding id> --part <name>` | One complete evidence list of the finding, one page at a time (`code-map-evidence`) |
| `code-map inspect --analysis <id> --findings` | A page of findings (`code-map-findings`). Add `--rule <rule id>`, `--file` or `--change` to filter. Add `--include-hidden` to show the findings that the [triage file](#triage-findings) hides |
| `code-map inspect --analysis <id> --findings --rule <rule id> --unlabeled` | A sample page: the findings of one rule without a triage label, in fingerprint order. Refer to [measure precision](#measure-precision) |
| `code-map inspect --analysis <id> --base-analysis <base id> --complexity` | The complexity change of the functions in changed files, one page at a time (`code-map-complexity`). Add `--offset` and `--limit` to page |
| `code-map inspect --analysis <id> --base-analysis <base id> --api <status>` | A page of export changes against the base (`code-map-api-changes`). Refer to [compare the exported interface](#compare-the-exported-interface) |
| `code-map inspect --analysis <id> --dependencies` | The packages of the lockfile, one page at a time (`code-map-dependencies`). With `--base-analysis <base id>`: the dependency change. Refer to [dependencies and supply chain](#dependencies-and-supply-chain) |
| `code-map inspect --analysis <id> --schemas` | The Prisma, Drizzle and JSON Schema inventory, one page at a time (`code-map-schemas`). Refer to [schema compatibility](#schema-compatibility) |
| `code-map inspect --analysis <id> --base-analysis <base id> --schemas` | The schema changes from the base to the head, one page at a time (`code-map-schema-changes`) |
| `code-map inspect --analysis <id> --base-analysis <base id> --impact <list>` | A page of one list of the change impact (`code-map-impact`): `affected`, `tests`, `references`, `calls` or `docs`. Refer to [change impact](#change-impact) |
| `code-map inspect --analysis <id> --undocumented` | A page of the public exports without a JSDoc comment (`code-map-undocumented`). Refer to [documentation of the public API](#documentation-of-the-public-api) |
| `code-map inspect --analysis <id> --file <path>` | The schema version 1 report of the selected files, from the stored analysis |
| `code-map inspect --analysis <id> --file <path> --part <name>` | One complete list of one file, one page at a time (`code-map-evidence`) |
| `code-map inspect --analysis <id> --part nextjs.routes` | One complete list of the project, one page at a time (`code-map-evidence`). Refer to [Next.js and React checks](#nextjs-and-react-checks), [environment keys](#environment-keys), [API contracts](#api-contracts) and [the models block](#the-models-block) |
| `code-map inspect --analysis <id> --full --out <file>` | The whole-project schema version 1 report, from the stored analysis. The printed command suggests a file in the `exports` folder of the store, which only you can open. A file written inside the repository changes the working tree, and the analysis of a working tree then becomes stale |

A follow-up command works from any folder, because the stored analysis records its repository. It does not read the `.code-map.json` of the current folder. When `--store` or an environment variable chose the store, each printed command includes `--store <folder>`. The options of one command must select one view: for example, `--finding` with `--file`, `--rule` or `--baseline` fails. `--compact` writes JSON without indentation, for any `inspect` output.

The schema version 1 report from a stored analysis is the same report that `inspect` gives for that snapshot, plus an `analysis` object with the ID and the freshness. Its `snapshot.generatedAt` is the time of the stored analysis.

## Compare with a base commit

`--base <ref>` also analyzes a base commit, or reuses its stored analysis, and labels each finding against it:

```sh
code-map inspect --summary --worktree --base main
code-map inspect --summary --ref HEAD --base HEAD~1 --change latest
```

The base is always a commit. Each finding of the summary gets a `baseline` and a `matchedBy` value:

| `baseline` | `matchedBy` | Meaning |
| --- | --- | --- |
| `EXISTING` | `fingerprint` or `rename` | The base has the same finding, also after a Git rename of its file |
| `NEW` | null | The base has no matching finding |
| `RESOLVED` | `absent` or `path-removed` | A base finding has no match in the head. `path-removed`: its file is gone |
| `UNKNOWN` | `changed-in-move`, `ambiguous`, `not-measured`, `outside-window`, `rule-base-changed`, `renames-incomplete` or `not-comparable` | Code-map cannot decide. The file changed while it moved. Several base findings match one head finding. The rule needs coverage on both sides. A bug-fix commit is outside the window of the last 100 commits on one side. The common source folder that names the modules of the text rules in `rules` changed (a layer rule does not use that folder). Git skipped rename detection because of its rename limit, or unmatched deleted and untracked files leave possible moves. Or the analyses are not comparable |

Inside each severity, the summary and each findings page show NEW findings first, then UNKNOWN, then EXISTING.

Code-map reads the renames with `git diff -M`. In a comparison with the working tree, Git does not see a move that you did not stage, because the new file is untracked. Code-map then pairs a deleted file and an untracked file when their content is the same. It also pairs them when they are the only two files with the same file name. A same-name pair has an unknown similarity. Unmatched findings of those files get UNKNOWN. When deleted and untracked files remain unpaired, the rename list is incomplete. All unmatched findings then get UNKNOWN. The `comparison` object has the base analysis (`id`, `sha`, `ref`), the `state`, the `reasons`, the `counts` of each label, up to 10 resolved findings and a command for each label. When the base or the head has a CODEOWNERS file, it also has `owners`. Refer to [layers and owners](#layers-and-owners). A resolved finding comes from the base analysis, so its `next` command names the base analysis ID.

Code-map checks the working-tree head again after the base analysis, before it reads live renames.

The comparison is `NOT_COMPARABLE` when the two analyses come from different repositories, analyzer versions, configurations, environments or source roots, or when the working tree or the commit of a stored working-tree head changed after its analysis. The `reasons` list says which. A comparison that is not comparable gives no NEW, EXISTING or RESOLVED label. A label compares static findings. It is not a test result, and Code-map does not subtract or score.

A comparison also reports the complexity change of the functions in changed files. [The inspection reference](inspection.md#declaration-metrics) tells how Code-map counts the values. The `comparison.complexity` object has these fields:

- `counts`: the number of functions for each `change` in the table below (`grew`, `new`, `fell` and `unknown`).
- `grew` and `new`: at most five functions in total, with grew functions first.
  Each function has `path`, `name`, `base`, `head` and `delta`.
  The values are `cyclomatic`, `nesting` and `cognitive`. The `delta` gives the change from base to head.
  A new function has `base` and `delta` set to null.
- `next`: the command for the complete list.

The object is null when the comparison is not comparable. It covers all changed files, also when the summary has a `--file` or `--change` selection. A function with no change is not in the lists.

A function matches the base by its file (through Git renames) and by its name path, for example `Parser.parse` or `run/<anonymous 2>`. A slash separates a nested function from its parent. Some functions share one name path, for example a getter and a setter, or the anonymous functions of one parent. These functions match by position, and only when the base and the head have the same number of them.

Callback names follow their variable binding or their callee and call position. For example, a hook can contain `useChat/send`, `useChat/useEffect#1` and `useChat/items/map#1`. Refer to [callback naming](inspection.md#declaration-metrics) for the naming rules. An added call of another callee does not shift these names. An added call of the same callee can shift positions, so position names do not prove callback identity. Duplicate callback names keep the same count rule as other duplicate names.

| `change` | Meaning |
| --- | --- |
| `grew` | The cyclomatic complexity, nesting depth or cognitive complexity is larger in the head. The function with the largest sum of increases comes first |
| `new` | The base has no function with this name path, and the name path has no `<anonymous>` part |
| `unknown` | Code-map cannot match the function. The name path has an `<anonymous>` part, the number of functions with the name path changed, the parent function is unknown, or Git can have missed the rename of the file |
| `fell` | No value grew, and at least one value is smaller in the head. The function with the largest sum of decreases comes first |

The `--complexity` page has the same `counts` in its `complexity` object, or null when the comparison is not comparable. Its items come in the order grew, new, unknown and fell, and each item has a `change` field. Code-map applies no threshold to these values. They are measurements, not verdicts.

To page through one label, follow the printed command, for example `code-map inspect --analysis <head id> --base-analysis <base id> --findings --baseline new`.

### Cognitive totals for files and folders

`comparison.complexity.areas` lists changed `files` and their containing `folders`, including the repository root (`.`).
Each row has `path`, `base`, `head` and `delta`. Each value has cognitive `sum` and `max`.
Folder totals include unchanged source siblings and all descendant source files. Nested functions count once.
An absent side or an older function record without cognitive values gives null. An empty file gives zero.
The `--complexity` response includes the same `areas` object. These observations apply no threshold.

### Discovery completeness

The summary has one project-wide `completeness` table, also with a file selection.
Its stacks are TypeScript, JavaScript, JSX and TSX, JSON, CSS and other.
Each row counts `discovered`, `supported`, `parsed`, `skipped`, `malformed` and `dynamicallyUnresolved`.
Discovery excludes the existing ignored folders. It includes supported files outside the source roots that package checks parse.
`parsed` counts attempted parsing, including malformed files. `malformed` counts files, not diagnostics.
`skipped` counts discovered files without parser facts or a JSON parse attempt.
`dynamicallyUnresolved` counts unresolved expressions, including separate expressions on the same line.
CSS package scanning is not CSS parsing. CSS and other unsupported stacks have no parser coverage.
Each supported stack with skipped, malformed or dynamically unresolved counts adds an evidence gap. Stacks that Code-map does not analyze, such as CSS and other files, share one gap with their counts.
The gap names the stack and all six counts. Verification includes these gaps in its Markdown limits.
Older stored analyses have null completeness. Unknown runtime edges remain outside these counts.

## Compare the exported interface

With a base, the summary also has an `api` section. It compares the exports of the base with the exports of the head. An export is a name that a source file exports. The section always covers the whole project, also with a `--file` or `--change` selection.

### Signatures

When Code-map analyzes a snapshot, it records a signature for each export of each source file. A signature is the declaration without its body, its initializers and its comments. Code-map normalizes the white space outside string literals. Some details:

- A parameter with a default value gets `?`, because the parameter is optional for the caller.
- A class signature lists the members that are not private.
- A function or a method with overload signatures shows only the overload signatures, because callers cannot use the implementation signature.
- An enum keeps the values of its members.

By default, Code-map reads signatures from syntax. The optional `--types` mode adds bounded compiler facts. See [compiler facts](types.md). When a function has no return type, or a variable has no type, the type is inferred. Code-map then also records a digest of the declaration source. A stored signature text has at most 300 characters. The comparison uses a digest of the full text (16 hexadecimal characters).

### Statuses

Each export of the base or the head gets one status:

| `status` | `reasons` | Meaning |
| --- | --- | --- |
| `REMOVED` | `file-removed`, `entry-removed` or none | The base exports the name, and the head does not. `file-removed`: the file is gone. `entry-removed`: the file is no longer a package entry point |
| `CHANGED` | `kind`, `signature`, `overloads` or `reexport-target` | The declaration kind changed (for example, a function became a constant). Or the signature text changed, or the set of overload signatures changed. Or a re-export now names another file or name |
| `RENAMED` | Unique matching signature | A removed and added name form one `pair` in the same file or a renamed file |
| `UNKNOWN` | `inferred`, `not-declared` or `renames-incomplete` | Code-map cannot decide. The declared signature is the same, but the source of an inferred type changed. Or the file declares no such name. Or Git skipped rename detection, so a removed or added file can be a move |
| `ADDED` | `file-added`, `entry-added` or none | The head exports a name that the base does not export |

An export with the same kind and signature, and the same source for an inferred type, is unchanged. The section counts unchanged exports, but it does not list them. A file that Git reports as renamed keeps its exports under its new path. Its items then have `path` (in the head) and `basePath` (in the base).

The `kind` of a record is `function`, `class`, `interface`, `type`, `enum`, `namespace`, `const`, `let`, `var`, `alias` (`export import`), `value` (an expression after `export default` or in a CommonJS export), `reexport` or `unknown`. Merged declarations with the same name, such as a function and a namespace, have their kinds joined with `+`.

### Public API and module API

A package entry point is a source file that a `package.json` names in `exports`, `main`, `module`, `types`, `typings` or `bin`. Code-map reads each `package.json` of the snapshot, except the files in `node_modules`. A `*` pattern in `exports` matches source files by their path without extension. A field that names no source file is in `entryPoints.unresolved`. Its `reason` is `not-mapped` for a file outside the source files, for example build output in `dist/`. Its `reason` is `not-found` for a path that no file has. Code-map does not map build output to its source file.

The `public` group compares the exports of each entry point. Code-map follows re-exports (`export { a } from`, `export * from` and `export * as ns from`) to the file that declares the name. `declaredIn` names that file. The `module` group compares the own exports of each other file. There, a re-export is compared as a re-export: the same name from the same file (after renames) is unchanged. A file that is an entry point only in the base or only in the head is in both groups. Thus, a change of the entry points cannot hide a change of an export.

Public changes also include release-policy annotations. See [renames and release policy](types.md#renames-and-release-policy).

### Consumers

A consumer is a head file that imports the name from the file of the export. A file that imports the name through a re-export is a consumer too, for example through an `index.ts` file. Its `through` field names the file that it imports. Code-map lists the consumers of each removed, changed and unknown export. The list includes files that the change did not touch, so a narrow change cannot hide a break. Test files are consumers too. `via` tells how the consumer imports the name:

| `via` | Meaning |
| --- | --- |
| `name` | A named import, a type import or a re-export of the name |
| `namespace` | A namespace import (`import * as`), an `export * from`, a `require` or a dynamic import of the file. The consumer can use the name |
| `unresolved` | The file of the export is gone or moved, and the consumer keeps the import of the base. That import now reaches no file |

Code-map cannot see consumers outside the repository, for example another package that uses a public entry point.

### The api section

| Field | Contents |
| --- | --- |
| `state`, `reasons` | `COMPARABLE`, or `NOT_COMPARABLE` with the reasons of the finding comparison. A comparison that is not comparable gives no counts and no lists |
| `scope` | Always `project` |
| `renamesComplete` | False when Git skipped rename detection |
| `entryPoints` | The entry points of the head (at most 20, with their total), the number of entry points of the base, the entry points that the change added or removed, and up to 5 unresolved fields with their total |
| `public`, `module` | For each group: the `counts` of each status and of unchanged exports, and up to 3 `examples`. An example is a removed, changed or unknown export, in the order of the pages. An example shows up to 5 consumers |
| `next` | The command for each list: `all`, `removed`, `changed`, `unknown`, `added` and `renamed` |
| `text` | How to read the section |

Each item has `group`, `status`, `path`, `basePath` (after a rename), `name`, `reasons`, `base` and `head`, and `consumers`. `base` or `head` is null on the side that has no such export. `consumers` has `total` and `items`, and it is null for an added export. A consumer item has `path`, `line`, `via` and, for a consumer through a re-export, `through`. A `base` or `head` record has `kind`, `text`, `digest` and `inferred`. It can also have `truncated` (the text was cut), `overloads` (the number of overload signatures), `from` (the target of a re-export) and `declaredIn` (in the public group).

To page through the changes, follow a printed command, for example `code-map inspect --analysis <head id> --base-analysis <base id> --api removed`. Add `--api-group public` or `--api-group module` to list one group. A page (`code-map-api-changes`) lists the public group first. Inside a group, it lists REMOVED, CHANGED, UNKNOWN, ADDED and RENAMED exports in that order. Inside one status, the export with the most consumers comes first. A page item has the complete consumer list.

A status compares declared signatures. It is a lead, not a compatibility verdict:

- Code-map does not type-check a call site. A new optional parameter is a CHANGED signature, also when no caller breaks.
- A renamed parameter changes the signature text, so the export is CHANGED.
- Without `--types`, an inferred type can also change through a type in another file. When the declaration source is the same, the export is unchanged.
- A namespace declaration is compared by its source only.

## Dependencies and supply chain

A snapshot with a lockfile gets a `supply` part in its summary.
Code-map reads one root lockfile from the analyzed snapshot.
Precedence is npm shrinkwrap, npm package-lock, pnpm, Yarn, then Bun.
It supports npm versions 1–3, pnpm versions 6 and 9, Yarn classic version 1, and text Bun versions 0–1.
The pnpm reader accepts generated mapping YAML, inline resolution maps and inline scalar arrays.
It refuses aliases, tags, block scalars, sequence blocks, duplicate keys and unsupported indentation.
Binary Bun and nested lockfiles remain unreadable.
The summary of a project without a lockfile has no `supply` part.

Two terms apply to the packages:

- A *local package* is a workspace folder or a `file:` dependency. It is the project's own code. It counts only in `packages` and `local`. No rule checks it, and the comparison does not include it.
- A *downloaded package* is a package that is not local, not a Git package and not bundled inside another package. It comes from a URL, or from a source that the lockfile does not give as a URL. A downloaded package needs an integrity value.

| Field | Contents |
| --- | --- |
| `lockfile`, `lockfileVersion` | The lockfile that Code-map read and its version, or null when it read none |
| `lockfiles` | Each lockfile at the root, with its `manager` and its `state`: `read`, `ignored` (another root lockfile takes precedence), `invalid`, `too-large` or `unsupported-version`. The last three have an `error` |
| `nested` | The number of lockfiles in subfolders, and at most 10 of their paths. Code-map does not read them. Lockfiles inside `node_modules` are left out |
| `counts` | `packages` and `local`. Then, for the packages that are not local: `dev`, `optional`, `peer`, `installScripts`, `withoutIntegrity` (downloaded packages without an integrity value), `otherHosts` (packages from a host other than `registry.npmjs.org`) and `unknownHost` (downloaded packages without a resolved URL) |
| `licenses` | `total`, the number of different licenses, and at most 20 `items` with `license` and `count`, most frequent first. `license: null` counts the packages that have no license in the lockfile |
| `policy` | The `supplyChain` policy of `.code-map.json`, or null |
| `next` | The command for the complete package list |

The `supply` part always covers the whole lockfile. A `--file` or `--change` selection selects only source files, so it leaves out the `DEPENDENCY-*` findings, which belong to the lockfile.

Each package of the list has `path` (its key in the lockfile), `name`, `version`, `kind` (`remote`, `git`, `local`, `bundled` or `unknown`), `host`, `integrity`, `installScript`, `license`, `dev`, `optional`, `peer` and `line`. Each package also has decoded `hashes` and resolved `dependencies` paths. The kind `unknown` is a package without a resolved URL, or with a resolved value that is not an HTTP URL or a `file:` path. The host never has the user name or the password of the URL. A version that is a URL (a Git or tarball dependency in a version 1 lockfile) loses them too. An npm version 1 lockfile records no install scripts, no licenses and no peer flags, so these values are null. A lockfile is untrusted input. Code-map reads at most 64 MiB and 200,000 packages, and it cuts long npm values. Other readers refuse identities that exceed their limits. All package paths of a version 1 lockfile together have at most 64 Mi characters, because Code-map makes them from the nested names.

### The supply-chain policy

`.code-map.json` can have a `supplyChain` policy:

```json
{
  "supplyChain": {
    "deniedLicenses": ["GPL-3.0-only", "AGPL-3.0-only"],
    "allowedLicenses": ["MIT", "ISC", "Apache-2.0", "BSD-3-Clause"],
    "allowedHosts": ["registry.npmjs.org"]
  }
}
```

Each field is optional, and each one is a list of at most 1,000 strings. An empty `allowedLicenses` or `allowedHosts` list is an error, because it allows nothing. An invalid policy stops each command with a message, so Code-map never ignores a policy in silence. Licenses and hosts compare without letter case. A host without a port allows each port of that host.

A license is an SPDX expression. A package can use one choice of an OR, and it needs each part of an AND. Thus an OR is denied only when each choice is denied, and it is allowed when one choice is allowed. A license with an exception (`X WITH Y`) counts as the license X. Text that is not an expression, for example `SEE LICENSE IN LICENSE.md`, counts as one license.

The policy gives two finding rules, and one more rule needs no policy (capability C34):

- `DEPENDENCY-LICENSE`: a package has a license that `deniedLicenses` denies, or that `allowedLicenses` does not allow. `facts.verdict` is `denied` or `not-allowed`.
- `DEPENDENCY-HOST`: a package comes from a host that is not in `allowedHosts`.
- `DEPENDENCY-NO-INTEGRITY`: a downloaded package has no integrity value.

Without a policy, no finding is about licenses or hosts. A package without a license, or without a resolved URL, gives no finding. The gaps `licensesUnknown` and `hostsUnknown` count these packages when the policy has a rule for them. The ID of a finding comes from the lockfile and the package path. Thus an upgrade that keeps the problem keeps the ID, and the comparison labels the finding EXISTING.

The supply part adds these gaps: `lockfileUnreadable`, `lockfilesNotRead`, `lockfileVersion1`, `licensesUnknown`, `hostsUnknown` and `advisories`. Inspection uses no advisory database. [`code-map verify`](verify.md#frozen-osv-snapshots) matches frozen OSV snapshots and reads npm audit reports.

### The dependency change

With `--base` (or `--base-analysis`), `comparison.supply` shows the change from the base lockfile to the head lockfile. It has these fields:

- `state`: `compared`, or `unknown` when one side has a lockfile at the root that Code-map cannot read.
- `reasons`: why the state is `unknown`, and a note for a version 1 lockfile.
- `counts`: the number of changes of each kind in the table below.
- `examples`: at most five changes, in the order of the table.
- `next`: the command for the complete list.

`comparison.supply` is null when the analyses are not comparable, as `comparison.complexity` is. It is absent when neither analysis has a lockfile.

Packages match by name, so a move inside `node_modules` is no change. For one name, Code-map pairs the versions that only one side has, from low to high. Versions compare as semantic versions.

| `change` | Meaning |
| --- | --- |
| `installScript` | The package has an install script in the head, and no version of it had one in the base. A new package with an install script counts here too |
| `hostChanged` | The resolved hosts of the package changed |
| `licenseChanged` | The licenses of the package changed |
| `added` | The head has a version that the base does not have |
| `downgraded` | A lower version replaces a higher one |
| `changed` | A version replaces another one, and one of them is not a semantic version, for example a Git commit |
| `upgraded` | A higher version replaces a lower one |
| `removed` | The base has a version that the head does not have |

Each change has `change`, `name`, `from` and `to`. `from` is null for `added` and `installScript`, and `to` is null for `removed`. An npm version 1 lockfile records no install scripts and no licenses. For a package that both sides have, the comparison then reports no `installScript` and no `licenseChanged` change.

### The package list

```sh
code-map inspect --analysis <id> --dependencies
code-map inspect --analysis <head id> --base-analysis <base id> --dependencies
```

The output has `reportType: "code-map-dependencies"`, the `analysis` block, a `supply` block and one `page`. Without a base, the page lists the packages by name, version and path, and `supply` has `lockfile` and `counts`. With a base, the page lists the changes in the order of the table above, `supply` has `state`, `reasons` and `counts`, and a `comparison` block names the base analysis. `supply` is null when the analysis has no lockfile, or when the two analyses are not comparable.

A comparison also classifies the schema changes, and it reports a schema change without a new migration. Refer to [schema compatibility](#schema-compatibility).

## Schema compatibility

The summary reads the database and data schemas of the snapshot: Prisma schemas, Drizzle tables and JSON Schema files. With a base, it also classifies each schema change as breaking, compatible or unknown. A project without these files and without a migration folder gets no `schemas` field, so its summary stays the same.

### Where Code-map finds the schemas

| Kind | Files | Namespace |
| --- | --- | --- |
| `prisma` | The file or folder in the `prisma.schema` field of `package.json`. Else `prisma/schema.prisma`. Else each `.prisma` file in the folder `prisma/schema/` | The package |
| `drizzle` | Each code file that is not a test and that calls `pgTable`, `mysqlTable`, `sqliteTable` or `pgEnum` | The package of the file |
| `json-schema` | Each file named `*.schema.json`, except in a `test`, `tests`, `fixtures`, `__tests__`, `__mocks__` or `__fixtures__` folder | The file |

A package is the root folder or a folder with a `package.json`. A namespace is the set of definitions that a comparison matches by name. Code-map skips the folders that the map ignores, for example `node_modules`, `dist` and `docs`, and hidden folders. Code-map reports a `.prisma` file that no rule selects as `not-selected`.

The migration folders of a package are `prisma/migrations`, the `migrations` folder next to the schema file that `package.json` names, each `migrations` folder with migrations next to a selected `.prisma` file (for example `prisma/schema/migrations`), and the Drizzle output folder. The Drizzle output folder is the `out` field of `drizzle.config.ts` (or `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`) when it is a string literal. Else it is `drizzle`. A Prisma migration is a `migration.sql` file in a subfolder of a migration folder. A Drizzle migration is a `.sql` file in the output folder.

### What Code-map reads

- **Prisma:** each model and enum, with each field: the name, the type, `?`, `[]`, and the attributes `@id`, `@default`, `@unique`, `@relation` and `@map`. It also reads `@@map`. Other attributes keep their names, and their arguments become a digest. A line that the parser does not understand makes its model or enum UNKNOWN. Text outside a known block and a block without its closing brace are unread. Code-map does not compare `view` and `type` blocks.
- **Drizzle:** each table name, and for each column the builder (for example `text` or `serial`), the database name, the builder arguments and the chained modifiers (for example `.notNull()`, `.default(...)`, `.primaryKey()`, `.unique()` and `.references(...)`). A table whose columns are not an object literal of builder calls is UNKNOWN. A table without a literal name is unread, and so are the tables of a `pgSchema`.
- **JSON Schema:** for each object, also in nested objects and in array `items`: `type`, `enum`, `required` and `properties`. Code-map compares other keywords, such as `$ref` or `minLength`, only as a digest. It does not compare the annotations `title`, `description`, `$comment` and `examples`.

Schema files are untrusted input. Code-map does not parse a file that is larger than 1 MiB, and it reads at most 500 JSON Schema files, in path order. It reads a JSON Schema to a depth of 32 objects. It runs no code of the project.

### The inventory

The `schemas` field of the summary has these fields:

| Field | Contents |
| --- | --- |
| `kinds` | For each kind: the number of `files`, the number of `entities` of each type (`model`, `enum`, `view`, `type`, `table` or `schema`), the number of `unknown` entities and the number of `unread` files |
| `sources` | `total`, and at most 5 files, each with `kind`, `path`, `state` (`read`, `partial` or `unread`) and the number of `entities` |
| `unread` | What Code-map did not read (the support report of C40): `total`, and at most 5 items, each with `kind`, `path`, `line`, `entity`, `reason` and `text` |
| `migrations` | Each migration folder, with `kind`, `package`, `folder` and the number of migration `files` |
| `next` | The command for the complete inventory, one page at a time |

An entity is one model, enum, table or JSON Schema file. A `partial` file has an UNKNOWN entity, or text that Code-map cannot read. A run of lines outside a block gives one unread item. The page (`code-map-schemas`) lists the unread items first, then the UNKNOWN entities, then the read entities. Each item has `kind`, `type`, `name`, `path`, `line`, `state`, `reason`, `members` (the number of fields, columns, values or properties) and `text`.

### Schema changes

With `--base`, `comparison.schemas` has the schema changes from the base to the head:

- `counts`: the number of `breaking`, `compatible` and `unknown` changes.
- `items`: at most 5 changes. Breaking changes come first, then unknown, then compatible.
- `migrations`: the migration state of each Prisma or Drizzle package.
- `next`: the command for the complete list, one page at a time (`code-map-schema-changes`).

The object is null when the comparison is not comparable. It covers the whole project, also when the summary has a `--file` or `--change` selection.

Each change has `class`, `change`, `kind`, `type`, `entity`, `member`, `from`, `to`, `path`, `line`, `side`, `needsMigration` and `text`. `entity` is the name of the model, table or enum, or the path of the JSON Schema file. `member` is the field, the column, the enum value or the JSON Pointer of a property, or null for the entity itself. For a JSON Schema enum, `from` or `to` holds the value. `side` is `base` for a removed item, so `path` and `line` point into the base. `needsMigration` is false for a JSON Schema. A Prisma relation field has no database column, so it needs a migration only in two cases. Its `@relation` has `fields:` or `references:` (the foreign key), or it is a list of a many-to-many relation. A many-to-many relation is two lists of each other's model, and Prisma keeps a join table for it. Drizzle runs the `$` modifiers of a column, such as `$type` or `$defaultFn`, in the application. Thus a change of only these modifiers needs no migration.

| `change` | `class` | Meaning |
| --- | --- | --- |
| `entity-removed` | breaking | The head has no such model, table, enum or JSON Schema file |
| `field-removed` | breaking | The head has no such field, column or property |
| `value-removed` | breaking | The head has no such enum value |
| `type-changed` | breaking | Prisma: the type or `[]` changed. Drizzle: the builder, its arguments or `.array()` changed. JSON Schema: `type` changed |
| `field-required` | breaking | An optional field became required and has no default, or a JSON Schema property became required |
| `field-added-required` | breaking | A new field is required and has no default, or a new JSON Schema property is required |
| `name-changed` | breaking | The database name changed: `@map` or `@@map` in Prisma, or the first builder argument in Drizzle |
| `entity-added` | compatible | A new model, table, enum or JSON Schema file |
| `field-added` | compatible | A new field that is optional, is a list or has a default, or a new JSON Schema property that is not required |
| `value-added` | compatible | A new enum value |
| `field-optional` | compatible | A required field became optional, or the head removed a `required` entry of a JSON Schema |
| `field-required-default` | unknown | An optional field became required and has a default. Existing rows without a value can still stop the migration |
| `default-changed` | unknown | The head adds, removes or changes a default |
| `constraint-changed` | unknown | `@id`, `@unique`, `.primaryKey()` or `.unique()` changed, or the head adds or removes the `enum` of a JSON Schema property |
| `relation-changed` | unknown | `@relation` or `.references(...)` changed |
| `attributes-changed` | unknown | Another attribute or modifier changed, for example `@db.VarChar`, `@@index` or the third argument of a Drizzle table |
| `keywords-changed` | unknown | A JSON Schema keyword that Code-map compares only as a digest changed, or the head adds or removes `items` |
| `not-parsed` | unknown | The entity is UNKNOWN in the base or in the head, and its text changed |
| `not-compared` | unknown | Code-map did not read all of the schema on one side, so it cannot tell whether the head removes or adds the entity |

A Prisma or Drizzle entity matches the base by its kind, package, type and name. Thus a definition that moves to another file of its package does not change. A JSON Schema file matches through the Git renames, as a finding does. When Git skipped its rename detection, a removed or new JSON Schema file is `not-compared`. A renamed model, table, field or property shows as one removed and one new item.

### Migration states

| `state` | Meaning |
| --- | --- |
| `NO_SCHEMA_CHANGE` | No change of the package needs a migration |
| `MIGRATION_ADDED` | The schema changed, and the head has a new migration file in a migration folder of the package |
| `MIGRATION_MISSING` | The schema changed, and the head has no new migration file |
| `UNKNOWN` | Code-map did not read all of the schema on one side, so it cannot tell whether the schema changed |

Each entry also has `kind`, `package`, `folders`, `schemaChanged` (true, false or null), `added` and `addedTotal`. `added` lists the new migration files: at most 5 in the summary, and all of them on the page. A new migration file is a file that the base does not have, also after Git renames.

### Limits of the schema comparison

- A class is a static reading of the schema text. Code-map does not connect to a database, run a migration or read the data.
- Code-map does not read the SQL of a migration. Thus it does not check that a new migration matches the schema change.
- Code-map does not check that a default exists in the database. For example, Prisma sets `@default(cuid())` in the client.
- Code-map does not read general SQL dumps, Prisma `view` and `type` blocks, the tables of a Drizzle `pgSchema` or `prisma.config.ts`.
- Static inspection does not execute SQL. The restricted [migrate harness](harness.md#migrate-mode) tests SQLite transforms against supplied fixtures.

### Rollout information in verify

`verify` adds `schemaRollout` with `informationOnly: true` and a list of `leads`.
It compares removed models, tables, fields and columns, plus changed database names.
Each lead retains the schema `change`, `baseUses`, `headUses`, `kind` and `note`.
Uses identify the source path, line and syntax: `prisma`, `drizzle` or `sql`.

`contract-before-expand` means that head code still names the removed or renamed item.
`one-step-contract` means that base code names it and no supported head use remains.
The note warns that a deployment with old code running can fail.
UNKNOWN means that no supported consumer was observed or the comparison is incomplete.

The scanner reads canonical `prisma.<model>.<method>` calls with literal `select`, `where` and `data` objects.
It reads Drizzle `<tableVariable>.<column>` references and SQL string literals that name the table and field.
Database name changes use raw SQL witnesses. Unchanged ORM property names do not name the old database column.
Names alone are syntax leads. The scanner does not resolve client aliases or Drizzle import aliases.
Computed SQL and interpolated SQL text are outside this subset.
Skipped files prevent a one-step conclusion. External consumers and actual deployment order remain unknown.
These observations add no rating check and change no readiness rule.

## Change impact

With a base, the summary also has an `impact` section. It has four parts: the affected files, the stale references, the call sites of changed exports and the documentation leads. Each part is a lead, not a verdict. The section always covers the whole project, also with a `--file` or `--change` selection.

Code-map computes the parts when the comparison runs. It reads the changed files with `git diff -M` from the base to the head. For a working tree, it also includes untracked files that Git does not ignore. The stale references and the call sites also read the text of head files. Code-map reads a commit from Git and a working tree from disk. The stored analysis keeps no source text, so each follow-up command reads these files again. For a working tree, a Markdown, JSON or YAML file can change after the analysis without making the analysis stale. The search then reads the new text. The search reads each searched file of the head, so the summary takes more time on a large repository.

### Affected files

Code-map walks the import graph of the head in reverse: from each changed file to its importers, then to their importers. A changed file has depth 0, and a file that imports a changed file has depth 1. The graph includes source imports, test imports and imports between test files. For example, a test can import a helper.

The walk stops at depth 10 and at 2000 affected files. `truncated` then names the limit, for example `{ "limit": "depth", "value": 10 }` or `{ "limit": "files", "value": 2000 }`. It is null when no limit applied.

A dynamic import or a `require` with a computed target, such as `import(name)`, can load any file. Thus, the walk cannot see all importers. `dynamicImports` counts these imports (`sites`) and the files that hold them (`files`). `complete` is false when a limit applied or when such an import exists.

`candidates` lists conservative computed-loader leads separately from the definite affected files.
The summary gives `total` and up to five `items`. The affected-file page header gives the first 50 candidates and their number in `candidateTotal`.
A bounded relative template names matching files and their importers with reason `computed-loader-pattern`.
An unresolved target without a match names the loader file and its importers with reason `unresolved-computed-loader`.
Each row gives `path`, `depth`, `test`, `imports`, `loader`, `line`, `mode` and `compatibility: "UNKNOWN"`.
`candidateTruncation` lists candidate walks that reached a depth or file limit.
These candidates do not change definite affected files, selected tests or `complete`.

Each import edge has a kind:

| Kind | Meaning |
| --- | --- |
| `value` | A value import, a side-effect import (`import './x'`), a literal dynamic import or a `require` |
| `type` | A type-only import, for example `import type` or `import('./x').T` in a type |
| `unknown` | An edge without a classification |

`edges` counts the import edges that the walk followed, by kind. Several imports between two files count as one edge with the strongest kind: value, then unknown, then type. An affected file has `kind: "value"` when a value or unknown chain reaches a changed file within the depth limit. Otherwise it has `kind: "type"`, and only the type check sees the change. `kinds` counts the affected files by kind.

### Stale references

Code-map searches the head as text for these terms:

- The name of each export that the [export comparison](#statuses) reports as `REMOVED`. The exports of a removed file are removed too.
- The old path of each removed or renamed file.

The search reads code files, Markdown files (`.md`, `.mdx`, `.markdown`), JSON files (`.json`, `.jsonc`, `.json5`) and YAML files (`.yml`, `.yaml`). It includes generated code in build folders with `place: "generated"`. It skips dependency folders, lockfiles and symlinks. It also skips binary files and files larger than 1 MiB, and `skippedFiles` counts them.

A name matches as a whole word. Neither adjacent character can be a letter, a digit, `_`, `$` or `-`. The character before the name also cannot be `/`. Thus, `helper` does not match `helpers` or `old-helper`. A name shorter than 4 characters gives too many false hits, so the search skips it. The search also skips `default` and the names that are not identifiers. The page lists each skipped name with its `reason`: `short` or `not-a-name`.

The search excludes the export file and its consumers in the export comparison. It also excludes declarations, re-exports and importers of a live export with the same name. This avoids stale-name leads for moved exports. For an old path, the search excludes files with a static import of that path. The import graph already reports those imports.

| `match` | Meaning |
| --- | --- |
| `name` | The export name |
| `path` | The old path without its extension, for example `src/lib/old.ts` in a Markdown file. A `./` or `../` prefix can come before it |
| `specifier` | A quoted relative path that resolves to the old path from the folder of the file, for example `vi.mock('../src/old')` in a test or `import('./old')` |

| `place` | Files |
| --- | --- |
| `code` | Code files that are not tests |
| `test` | Test files |
| `generated` | Readable generated code in build folders |
| `config` | Code files with a configuration name, for example `vitest.config.ts` or `.eslintrc.cjs` |
| `markdown`, `json`, `yaml` | Markdown, JSON and YAML files |

Each hit has `path`, `line`, `column`, `place`, `term`, `match` and `text`. `text` is the line, cut to at most 200 characters around the hit. `term` is `{ "kind": "export", "name", "files" }` or `{ "kind": "path", "path", "to" }`. `files` lists the files that exported the name in the base. `to` is the new path of a renamed file, or null for a removed file. The search keeps at most 100 hits for each term. `truncated` then is `{ "limit": "hits-per-term", "value": 100, "terms": <number of terms> }`.

### Call sites

For each export that the export comparison reports as `CHANGED`, Code-map lists the places where the head consumers use the name. A consumer can import the name directly, through a namespace import (`ns.f(…)` or `ns['f'](…)`) or through a re-export under another name (`export { f as g }`). A changed declaring export owns duplicate public changes. A redirected public re-export still gets a separate consumer check, using its resolved head signature.

| `use` | Meaning |
| --- | --- |
| `call` | A call, for example `f(a, b)`. `args` is the number of arguments |
| `new` | A `new` expression. `args` is the number of arguments |
| `jsx` | A JSX element, for example `<Button />` |
| `type` | A type reference, including a namespace member such as `ns.Options` |
| `reference` | Any other use, for example `const g = f` |

When Code-map analyzes a snapshot, it records the argument range (`arity`) of each callable export. `min` is the number of required parameters. `max` is the number of all parameters, or null with a rest parameter. Some details:

- A `this` parameter does not count. Overloads give the widest range.
- A class gives the range of its constructor. A class that extends another class without its own constructor has no range.
- In a JavaScript file, each parameter is optional, so `min` is 0. A JavaScript function that reads `arguments` has no `max`.
- A variable with a declared type has a range only when the type is a written function type.

`likelyBreak` is true when a call or a `new` expression passes fewer arguments than `min` or more arguments than `max` of the head signature. It is false when the count is in the range. It is null for other uses, for a call with a spread argument (`spread: true`), for a call of a class and for an export without a range. A likely break is a static lead. The TypeScript compiler is the real check. The page lists the likely breaks first.

A computed namespace member, such as `api[name](value)`, has its own call-site row.
The row has `dynamic: true`, `compatibility: "UNKNOWN"`, `likelyBreak: null` and reason `computed-namespace-member`.
Each row names the changed export that the namespace can use. A shadowed local name does not count.

`unread` lists the consumers that Code-map did not read, for example a file larger than 1 MiB.

### Documentation leads

The `docs` part takes the exports of the public group that the change removed or changed. When no documentation file changed in the same change, each of these exports is a lead, because its documentation can describe the old interface. A documentation file is a Markdown file or any file in a `docs` folder. `docsChanged` lists the changed documentation files. When this list is not empty, the part gives no lead. Code-map does not read the text of the documents.

### The impact section

| Field | Contents |
| --- | --- |
| `state`, `reasons` | `COMPARABLE`, or `NOT_COMPARABLE` with the reasons of the finding comparison. `UNAVAILABLE` with the reason `git-unreadable` and an `error` text, when a Git command failed. Only a comparable section has parts |
| `scope` | Always `project` |
| `changed` | The number of changed `files`, of changed `sources` and `tests` in the import graph, of `other` changed files that the analysis does not map, and of `removed` files |
| `affected` | `limits`, `truncated`, `complete`, `total` (the files at depth 1 or more), `byDepth` (the files and the tests for each depth), `kinds`, `edges`, `dynamicImports`, `tests` (the changed and affected test files: the total and up to 5 items), up to 5 `examples`, and a `next` command for `affected` and for `tests` |
| `references` | `terms` (the number of export names, of paths and of skipped names), `total`, `places` (the hits for each place), `truncated`, `skippedFiles`, up to 5 `examples` and `next` |
| `calls` | `exports` (the number of changed exports), `total`, `likelyBreaks`, `unread` (a number), up to 5 `examples` and `next` |
| `docs` | `publicChanges`, `docsChanged` (the total and up to 5 files), `total` (the number of leads), up to 5 `examples` and `next` |
| `text` | How to read the section |

An affected item has `path`, `depth`, `kind`, `test` and `imports`: the file that it imports on a shortest chain to a changed file. A test item has the same fields. A changed test file has depth 0, `kind: "changed"` and `imports: null`. A call site has `export` (`path`, `name` and `kind`), `arity`, `path`, `line`, `column`, `use`, `args`, `spread` (only when true) and `likelyBreak`. A documentation lead has `path`, `name`, `status`, `reasons` and `declaredIn`.

To page through one list, follow a printed command, for example `code-map inspect --analysis <head id> --base-analysis <base id> --impact calls`. The lists are `affected`, `tests`, `references`, `calls` and `docs`. A page (`code-map-impact`) has `list`, the `comparison` (the base, `state` and `reasons`), the facts of its part and `page`:

| List | Facts |
| --- | --- |
| `affected`, `tests` | `affected`: the facts of the walk, without the lists |
| `references` | `references`: `terms` with `exports` (each `name` with its `files`), `paths` (each `path` with `to`) and `skipped`, then `truncated` and `skippedFiles` |
| `calls` | `calls`: `exports` (each changed export with `path`, `name`, `kind`, `arity`, `consumers`, `sites` and `likelyBreaks`) and the `unread` paths |
| `docs` | `docs`: `publicChanges` and the complete `docsChanged` list |

### Limits of the change impact

- The walk follows the import graph of the analysis. A file outside the source roots, a test script in another language and a consumer outside the repository are not in the graph.
- For a removed or moved file, the walk restores unresolved head edges from matching base imports. It follows the remaining head graph from these consumers. New unresolved specifiers without a matching base import are outside this fallback.
- The kind of an affected file compares the chains inside the depth limit only.
- The search finds an alias path, such as `@/lib/old`, only when it holds the full old path. It does not find a relative Markdown link that does not hold the full path.
- A hit is text, not a proven reference. A comment, another variable with the same name or a changelog entry also matches.
- The call sites come from the syntax of each consumer. Code-map does not follow a value that a consumer passes on, for example `const g = f; g(1)`. It also does not follow a `require`, a dynamic import or a destructured namespace.
- The rule set `static-baseline-v0` of `code-map verify` does not use this section.

## Documentation of the public API

Each summary has a `documentation` section. It counts the public exports: the exports of the package entry points, with re-exports followed to the declaring file. When Code-map analyzes a snapshot, it records for each declaration whether a JSDoc comment is above it. A JSDoc comment starts with `/**` and holds text: an empty comment does not count.

| Field | Contents |
| --- | --- |
| `entryPoints` | The number of package entry points |
| `exports` | The number of public exports |
| `documented`, `undocumented` | The number of public exports with and without a JSDoc comment |
| `unknown` | The number of public exports without a declaration that Code-map can read: a re-export from a package (`export * from 'pkg'`), a namespace re-export, or a name that the file does not declare |
| `examples` | Up to 5 undocumented exports. Each has `path` (the entry point), `name`, `kind`, `declaredIn` and `line` (in the declaring file) |
| `next` | The command for the complete list, `code-map inspect --analysis <id> --undocumented` |
| `text` | How to read the section |

The section is null for an analysis that an older Code-map stored without these facts. The `--undocumented` page (`code-map-undocumented`) has counts in `documentation` and undocumented exports in `page`. It sorts exports by entry point and name. Code-map does not judge the text of a comment. Only a comment above the declaration counts: a comment above an export statement, such as `/** … */ export { a }`, does not count.

## Pages

Each page has `total`, `offset`, `limit`, `items` and `next`. `next` is the exact command for the next page, or `null` on the last page. `--offset` accepts integers from 0 to 9007199254740991. The default page size is 20, and `--limit` accepts 1 to 500. `--offset` and `--limit` apply to `--part`, `--findings`, `--complexity`, `--api`, `--dependencies`, `--schemas`, `--impact` and `--undocumented`.

The stored analysis keeps every list complete. A count in the summary is a view of a list, not a replacement for it.

| Target | Parts |
| --- | --- |
| A file (`--file <path> --part`) | `imports`, `importers`, `exports`, `declarations`, `tests.direct`, `tests.transitive`, `coChanges` |
| A cycle finding | `files`, `edges` |
| A missing-import-name finding | `exports` (the names that the target file exports) |
| An export finding | `consumers`, `importers` |
| A shared-type finding | `consumers` |
| A function finding (`TEST-NO-FAILURE-ASSERTION`, `TEST-UNREACHED`, `TEST-EXIT-NOT-RUN`) | `exits`, `cases.direct`, `cases.via`, `tests.direct`, `tests.transitive` |
| A fix-commit finding | `sources` |
| The project (`--part` without `--file` and `--finding`) | `nextjs.routes`, `nextjs.modules`, `nextjs.unclassified`, `env.names`, `env.reads`, `env.templates`, `openapi.documents`, `openapi.operations`, `openapi.handlers`. Also `models.boundaries`, `models.states`, `models.decisions`, `models.cases` and `models.errors`. Without models, these lists are empty. Without Next.js, the `nextjs.` lists are empty. Without reads, templates or documents, the other lists are empty |

For a function, the analysis keeps the first five cases that reach it through callers, with their routes. `cases.viaTotal` gives the full count. The file-level test lists are complete.

## The summary

| Field | Contents |
| --- | --- |
| `analysis` | `id`, `createdAt`, `reused`, and `freshness` |
| `snapshot` | Project, mapped ref, commit SHA, `workingTree`, `worktreeDigest` and the `selector` that the summary used. `worktreeDigest` is the SHA-256 digest of every file that differs from the commit now (changed, deleted or untracked, and the target of a tracked symlink when the commit does not hold it). Files that Git ignores, secret env values, and template and contract symlink targets are left out. It is null for a commit or a clean working tree. A run manifest records the same value, so a test report binds to this code. It is not part of the analysis ID |
| `scope` | The selection, if there is one, with at most 20 files and 20 missing paths, their totals and the command for the complete file report; and the numbers of source files, test files and test cases |
| `verification` | `state: "NOT_RUN"`, with `readiness` and `ratings` set to null. A summary gives no rating and no readiness: [`code-map verify`](verify.md) gives them |
| `findings` | `total`, `bySeverity`, `byRule` (each with a `next` command), up to 20 `items` (at most 5 for each rule, highest severity first) and `next` when more findings exist. With a triage file, also `hidden`: the number of dismissed and suppressed findings that the lists leave out |
| `api` | Only with a base: the export changes. Refer to [the api section](#the-api-section) |
| `impact` | Only with a base: the affected files, the stale references, the call sites of changed exports and the documentation leads. Refer to [the impact section](#the-impact-section) |
| `gaps` | Evidence that the analysis cannot establish, each with `key`, `source`, `text` and an optional `count`. `syntaxErrors` counts the files in which the parser found a syntax error. Package gaps include `packagesNotInstalled`. Refer to [package checks](#package-checks) |
| `tests` | The test-quality statistics: `key`, `source`, `label`, `value` and `warn` |
| `architecture` | The layer model and the owners. Without CODEOWNERS, all source files count as unowned. It covers the whole project, also in a scoped summary. Refer to [layers and owners](#layers-and-owners) |
| `frameworks` | The framework support report. `nextjs.detected` tells whether a `package.json` lists `next`. With Next.js, it has the packages, the checked `surfaces`, the route counts, the numbers of client and server modules, the unclassified files by reason, the Next.js rules and a command for each list. `unreadablePackages` counts the `package.json` files that are not valid JSON, when there are any. `env` counts the template files, the environment reads and the names. `openapi` counts the OpenAPI documents, their operations and the route handler methods by state, and with a base it lists the removed operations. Each block has its rules and a command for each list. It covers the whole project, also in a scoped summary. Refer to [Next.js and React checks](#nextjs-and-react-checks), [environment keys](#environment-keys) and [API contracts](#api-contracts) |
| `models` | The model report: the counts of the boundary values, the state models, the decision tables and the refused model files, with a command for each list. It covers the whole project, also in a scoped summary. Refer to [the models block](#the-models-block) |
| `supply` | Only for a snapshot with a lockfile, at the root or in a subfolder: the package counts, the licenses, the lockfiles and the policy. Refer to [dependencies and supply chain](#dependencies-and-supply-chain) |
| `schemas` | The Prisma, Drizzle and JSON Schema inventory, and what Code-map did not read. Only when the snapshot has a schema file or a migration folder. Refer to [schema compatibility](#schema-compatibility) |
| `documentation` | The public exports with and without a JSDoc comment, up to 5 undocumented exports and the command for the complete list. Refer to [documentation of the public API](#documentation-of-the-public-api) |
| `commands` | Templates for the findings list, a file report and the full report |
| `limits` | The interpretation limits of the analysis. The last line gives the counts of the [file cache](#the-file-cache) in the run that made the analysis |
| `triage` | Only when the repository has a triage file: the file, its digest, the expired and unused entries and the precision of each labeled rule. Refer to [triage findings](#triage-findings) |

The summary shows at most 20 findings inline, so its size does not grow with the number of findings. Measurements on a large project are in [the record of this work](records/2026-10-22-summary-first-retrieval.md).

## Findings

A finding is one investigation lead. It is not a PASS or FAIL result, and it does not give a rating. Each finding has these fields:

| Field | Contents |
| --- | --- |
| `id` | The rule ID and the first ten hexadecimal characters of the fingerprint |
| `ruleId`, `title` | The rule, from the table below |
| `fingerprint` | Sixteen hexadecimal characters from the rule and the semantic location: paths, names and the cycle members. Line numbers are not part of it, so the ID survives line moves |
| `severity` | `high`, `medium` or `low`, from the rule |
| `source` | The kind of evidence. Refer to [evidence kinds](inspection.md#evidence-kinds) |
| `capability` | The capability number (C01 to C45) of the verification specification |
| `text`, `location`, `evidence` | What was found, where (`path`, `line`, `symbol`) and up to three evidence locations |
| `next` | The exact command that shows the finding with its evidence |
| `triage` | Only when an entry of the triage file applies: the state of the entry. Refer to [triage findings](#triage-findings) |

For `IMPORT-UNRESOLVED`, `location` also gives `column`, `endLine` and `endColumn` of the first specifier string.
Positions are one-based. The span includes the quotes and ends just after the closing quote.
Older analyses without span facts omit these fields. The fingerprint does not use positions.

If two different findings get the same ten-character ID, the second one gets the full fingerprint in its ID.

A test-case finding identifies its case by the test file, the suite, the name and the position among cases with the same name in that file. A new case with the same name above an existing one changes that position, so a comparison then shows one NEW and one RESOLVED finding for an unchanged case.

A pattern finding (refer to [operational patterns and syntax errors](#operational-patterns-and-syntax-errors)) identifies its place in the same way. Its key has the file, the name path of the enclosing declarations and the call. It also has the position among findings of the same rule with the same name path and call.

| Rule | Severity | Evidence | Capability | Meaning |
| --- | --- | --- | --- | --- |
| `MIGRATION-USE` | low | pattern | C25 | A configured migration still has an import or call use |
| `ARCH-RULE` | high | graph | C06 | An import breaks a rule in the `rules` of `.code-map.json`, or a [layer rule](#layers-and-owners) from its `layers` |
| `IMPORT-NAME-MISSING` | high | graph | C02 | A file imports a name that the imported file does not export, for example after a rename. Local cyclic `export *` barrels retain every reachable named export. Named imports from files with unknown exports (a re-export from a package, CommonJS, a destructured export, `export =`) are skipped and counted as a gap |
| `TEST-FOCUSED` | high | inventory | C10 | A test case is focused with `.only` |
| `TEST-EXIT-NOT-RUN` | high | measured | C12 | A measured failure exit never ran in the coverage run |
| `TEST-NO-FAILURE-ASSERTION` | high | inferred | C09 | Tests reach a function with failure exits, but no failure assertion is tied to it |
| `TEST-EXPORT-CANDIDATE` | low | inferred | C09 | An exported function has no static test relationship. Runtime hits are unknown |
| `TEST-UNREACHED` | high | inferred | C09 | No test reaches a function with failure exits |
| `NEXT-CLIENT-API-IN-SERVER` | high | graph | C26 | A server module calls a React client hook, such as `useState`, or sets an event handler, such as `onClick`, on a DOM element |
| `NEXT-SERVER-IMPORT-IN-CLIENT` | high | graph | C26 | A client module imports `server-only`, `next/headers`, `next/server`, a Node.js built-in module, or a module that imports `server-only` |
| `NEXT-USE-SERVER-EXPORT` | high | pattern | C26 | A file with the directive `'use server'` exports a value that is not an async function |
| `DEPENDENCY-LICENSE` | high | inventory | C34 | A package in the lockfile has a license that the `supplyChain` policy denies or does not allow |
| `DEPENDENCY-HOST` | high | inventory | C34 | A package in the lockfile comes from a host that is not in `allowedHosts` of the `supplyChain` policy |
| `IMPORT-UNRESOLVED` | medium | graph | C01 | A relative import matches no file in the snapshot. Specifiers with `?` or `!` are not checked |
| `OWNER-CROSS-IMPORT` | medium | graph | C31 | With `"ownership": { "forbidCrossOwnerImports": true }`, a file imports a file and the two files have no common owner in CODEOWNERS. Refer to [layers and owners](#layers-and-owners) |
| `PACKAGE-UNDECLARED` | medium | graph | C01 | A file imports a package that its `package.json` does not declare. Refer to [package checks](#package-checks) |
| `PACKAGE-UNRESOLVED` | medium | graph | C01 | A declared package that a file imports has no folder in `node_modules` |
| `PACKAGE-SUBPATH-NOT-EXPORTED` | medium | graph | C01 | A file imports a subpath that the `exports` field of the installed package does not export |
| `CYCLE-VALUE` | medium | graph | C05 | Files import each other through value or side-effect imports |
| `FIX-WITHOUT-TEST` | medium | git | C27 | A commit that looks like a bug fix changed no test file |
| `TEST-NO-ASSERTIONS` | medium | pattern | C27 | A running test case has no assertion that the scan can find |
| `TEST-UNRECOGNIZED-FILE` | medium | inventory | C40 | A file named as a test has no recognized test case |
| `NEXT-CLIENT-PRIVATE-ENV` | medium | graph | C26 | A client module reads `process.env.NAME`, and `NAME` is not `NODE_ENV` and does not start with `NEXT_PUBLIC_` |
| `DEPENDENCY-NO-INTEGRITY` | medium | inventory | C34 | A downloaded package has no integrity value in the lockfile. It needs no policy |
| `SYNTAX-ERROR` | medium | inventory | C40 | The parser reports a syntax error in a source file or a test file, so the facts of that file can be incomplete |
| `EFFECT-NO-CLEANUP` | medium | pattern | C35 | A React `useEffect` or `useLayoutEffect` callback subscribes, but returns no cleanup function |
| `RETRY-POLICY` | medium | pattern | C35 | A declared retry call has no valid bounded attempt limit |
| `LOGGING-POLICY` | medium | pattern | C35 | A catch block has no call to its declared logger |
| `INTERVAL-NOT-CLEARED` | medium | pattern | C35 | A `setInterval` in a function or a class field keeps no handle, or the file never calls `clearInterval` |
| `ENV-UNDECLARED` | medium | contract | C26 | A code file reads an environment variable that no template file of its package declares. The rule applies only to a package with a template file |
| `OPENAPI-NO-HANDLER` | medium | contract | C20 | An OpenAPI document describes an operation, and no route handler matches its path, or the matching route file does not export its method |
| `CYCLE-ALL` | low | graph | C05 | Files import each other only when type-only imports count |
| `SHARED-TYPE` | low | graph | C30 | Consumers import a type from a parent that imports them |
| `EXPORT-UNREFERENCED` | low | graph | C32 | No importer uses an exported name |
| `EXPORT-TEST-ONLY` | low | graph | C32 | Only tests import an exported name |
| `FILE-ORPHANED` | low | graph | C32 | No file imports a source file, and the file is not an entry point |
| `PACKAGE-UNUSED` | low | graph | C32 | No code file, style file, script or config file uses a package in `dependencies` |
| `PACKAGE-DEV-ONLY` | low | graph | C01 | A production file imports a package that only `devDependencies` declares |
| `TEST-SWALLOWED-ERROR` | low | pattern | C27 | A test case catches an error around an assertion and ignores it |
| `TEST-FIXED-WAIT` | low | pattern | C27 | A test case waits for a fixed time |
| `TEST-PARKED` | low | inventory | C10 | A test case is skipped, todo or conditional |
| `TEST-LAYER-MISMATCH` | low | pattern | C10 | A test in a unit-test folder uses a process, the network, a database or a browser |
| `TEST-UNREADABLE-FILE` | low | inventory | C40 | A test script in another language that the scan cannot read |
| `FETCH-NO-SIGNAL` | low | pattern | C35 | A `fetch` call passes no `signal`, so the request has no timeout and no cancellation |
| `CATCH-EMPTY` | low | pattern | C35 | A `catch` block has no statement and no comment |
| `ENV-UNUSED` | low | contract | C26 | A template file declares an environment variable that no mapped source or test file reads by its name |
| `OPENAPI-PARAM-NAME` | low | contract | C20 | A documented path parameter, such as `{userId}`, has another name in the dynamic segment of the route, such as `[id]` |
| `OPENAPI-UNDOCUMENTED-METHOD` | low | contract | C20 | An App Router route file exports a method that no OpenAPI document of its Next.js root describes for that route |

The import checks cover mapped source files, scanned JavaScript and TypeScript test files, and package-root configuration files.
Configuration names match `*.config.{js,mjs,cjs,ts,mts,cts}` beside a `package.json` outside ignored folders.
These files use the source resolver for relative paths and aliases.
`IMPORT-UNRESOLVED` and `IMPORT-NAME-MISSING` cover test and configuration files too.
The stored `analysis.importFiles` list keeps their paths, import edges and exported names.
Source file reports and source metrics retain their existing scope.
Import finding details include test and configuration lines without links to source-only file reports.
Declaration files, other languages and code outside this scan remain outside these import checks.
The file cache keeps the new facts and checks their import targets before reuse.

## Operational patterns and syntax errors

The rules of capability C35 find operational risks that a code change often brings. They read source files only. Test files and test helpers get no pattern finding. Each rule matches syntax inside one file. A finding is a lead that is usually right, but it is not proof: confirm it in the code. Each source file has `patterns` for built-in matches and `syntax` for parse results. Declared retry and logging observations use `safeguards.items`. [The inspection reference](inspection.md#operational-patterns-and-syntax-errors) describes the fields.

A global call is a call of a name that the file does not declare or import, for example `fetch(url)`. A call on `window`, `globalThis`, `self` or `global` is also a global call. A parameter, a variable or an import with the same name is not the global, so `import fetch from 'node-fetch'` gives no finding.

### `FETCH-NO-SIGNAL` (low)

Detects a global `fetch` call that passes no `signal`. Code-map reports the call in two cases. In the first case, its options are an object literal with no `signal` property, no spread and no computed key. In the second case, the call has only one argument. When the options are a variable, a call or another expression, Code-map cannot see them, and it reports nothing. A `new Request(…)` as the only argument also gives no finding.

Severity: low. A request with no signal has no timeout, and nothing can cancel it when the user leaves or the caller gives up. The effect depends on where the call runs.

Known false positives:

- A wrapper function, a fetch agent or the platform sets a timeout, for example the request timeout of a serverless platform.
- Server code in a framework such as Next.js, where nobody cancels a request.
- A short call where cancellation does not matter, for example a click handler that sends one request.
- A `Request` object in a variable that already has a signal, for example `fetch(request)`.

### `INTERVAL-NOT-CLEARED` (medium)

Detects a global `setInterval` call inside a function or a class field in two cases. `facts.reason` tells which case applies:

- `not-stored`: the code discards the handle, for example `setInterval(tick, 1000)` or `setInterval(tick, 1000).unref()`. Nothing can clear this interval.
- `never-cleared`: the code keeps the handle in a variable, a property or a class field, but the file never names `clearInterval`.

A handle that the function returns or passes to a call gives no finding. A `setInterval` at the top level of a module also gives no finding, because it runs one time for each load of the module. The same applies to the initializer of a static class field. The initializer of a class field that is not static runs for each new instance, so it counts as a function.

Severity: medium. An interval that nothing clears runs until the process or the page ends. Each call of the function starts one more interval, and an open interval keeps a Node.js process alive.

Known false positives:

- A function that runs one time only, for example a server start function, on purpose starts an interval for the life of the process.
- Another file clears the handle, for example after the function stores it in a variable and returns that variable.
- `clearTimeout` clears the interval. Code-map looks only for `clearInterval`.

### `CATCH-EMPTY` (low)

Detects a `catch` block with no statement and no comment, for example `catch {}` or `catch (error) { }`. A comment in the block gives no finding, for example `catch { /* the file can be gone */ }`. The comment tells the reader that the author ignores the error on purpose. This is the same test as the `no-empty` rule of ESLint. A `.catch(() => {})` handler of a promise is not part of this rule.

Severity: low. An empty catch block hides every error of its `try` block, also errors that the author did not expect. Many empty catch blocks are on purpose, and only a comment shows this.

Known false positives:

- A deliberate fallback with no comment, for example an optional `require` or a `JSON.parse` that returns a default value.
- Code that a build tool wrote, because the build removes the comments. Code-map ignores `dist`, `build` and the other output folders. The 9 bundled JavaScript files of the TypeScript 6.0.3 package gave 13 findings, and all 13 were deliberate.

### `EFFECT-NO-CLEANUP` (medium)

Detects a React `useEffect` or `useLayoutEffect` call whose inline callback subscribes and returns no cleanup function. The hook must come from an import of `react`. It can be a named import, an alias, or a member of the default or namespace import, for example `React.useEffect`. These calls subscribe:

- `addEventListener` with a listener, unless its options are an object literal with `once: true`
- a global `setInterval` whose handle the callback discards or keeps in a variable
- a global `setTimeout` whose handle the callback keeps in a variable
- `.subscribe(…)` on an object
- `.on(event, listener)` on an object

A handle stored in a ref member, such as `timersRef.current.set(id, timer)`, gives no lead for that subscription.
The ref owner manages cleanup. Assignments and collection methods `set`, `add`, `push` and `unshift` count.
Other subscriptions in the effect still count. Reassigned local bindings remain leads.

Any `return` with a value (not `undefined`, `null` or `void`) counts as a cleanup function, also inside an `if`. A call inside a nested function, for example an event handler that the callback declares, does not count. A callback that is only one expression returns that value, so `useEffect(() => store.subscribe(listener))` gives no finding. A callback that is `async` returns a promise, and React does not run a promise as a cleanup. The finding names the hook in `facts.hook` and lists up to three subscribing calls as evidence. A `setInterval` in an effect can also give an `INTERVAL-NOT-CLEARED` finding.

Severity: medium. After the component unmounts, the listener or the timer still runs, and it can update the state of a component that is gone. Each new run of the effect adds one more subscription.

Known false positives:

- The listener belongs to an object that the callback creates itself, for example `new Image()`, and the object goes away with the component.
- A separate effect or a handler removes the subscription.
- The component never unmounts, for example the root component of an application.

### `SYNTAX-ERROR` (medium, capability C40)

Detects a source file or a test file in which the TypeScript parser reports at least one syntax error. The parser continues after an error, so the analysis still has facts for the file. The finding gives the number of errors and the line and message of the first one. The identity key is the path alone, so a file has one finding at most. The summary counts these files in the gap `syntaxErrors`.

Severity: medium. The imports, exports, declarations and test cases of the file can be incomplete or wrong. Thus other findings and gaps of the file are less reliable. A syntax error also often stops a build.

Known false positives:

- Syntax that TypeScript 6.0.3 does not read, for example a Babel-only proposal such as the pipeline operator `|>`.
- An old JavaScript octal literal such as `010`, which sloppy-mode JavaScript allows.
- A fixture file that contains wrong syntax on purpose.

## Layers and owners

A layer is a named group of source files. Declare layers in `.code-map.json` from the top layer to the bottom layer. A lower layer must not import a higher layer:

```json
{
  "layers": [
    { "name": "ui", "paths": ["src/ui/**", "src/pages/**"] },
    { "name": "domain", "paths": ["src/domain/**"] },
    { "name": "data", "paths": ["src/data/**"] }
  ],
  "allowed": [{ "from": "data", "to": "domain" }]
}
```

- Declare at most 50 layers. Each forbidden pair generates a rule, so this limit bounds the rule count.
- Each glob matches the whole repository-relative path. `**` as a whole segment matches zero or more folders. `*` matches characters inside one segment. `?` matches one character. Verification requests use the same glob syntax.
- Each forbidden pair has a rule named `layer:<lower> -> <higher>`, for example `layer:data -> ui`. The names follow the text rules in `rules.declared`. Thus `code-map verify` counts them as declared rules.
- A layer violation is an `ARCH-RULE` finding. Its `facts.layers` names the two layers. Imports within one layer or into lower layers are allowed.
- Top-level `allowed` permits imports from the lower layer `from` into the higher layer `to`. That pair generates no rule. `layerExceptions` also accepts these pairs. Both lists apply when both are present.
- A source file in no layer is outside the model. Layer rules check no imports into or out of that file.
- A source file in two layers stops the analysis. Code-map refuses identical globs across layers when it reads `.code-map.json`.

Code-map reads CODEOWNERS from the snapshot. It searches `.github/`, the root folder and `docs/`, in that order. It uses the first file that it finds.

- The last matching pattern gives a path its owners. A pattern without owners clears ownership.
- A pattern with `/` at the start or in the middle starts at the root folder. Other patterns match at any depth. A pattern ending with `/` matches files inside a folder. Matching directories also include their descendants, including for `docs/*`.
- Paths are case-sensitive. Code-map stores owners in lowercase and compares them without regard to case. An owner is a user (`@name`), a team (`@org/name`) or an email address.
- GitHub does not support negations (`!`) or character ranges (`[ ]`). Code-map ignores these lines and lines with invalid owners or incomplete escapes. Each ignored entry gives the line number and reason. Its text has at most 200 characters, plus a truncation marker.
- Code-map does not follow CODEOWNERS symlinks, including parent folders. It records unreadable paths as ignored entries.

Ownership is information unless `.code-map.json` declares a policy:

```json
{ "ownership": { "forbidCrossOwnerImports": true, "allowed": [{ "from": "@org/web", "to": "@org/platform" }] } }
```

With `forbidCrossOwnerImports`, an import between owned source files without a common owner gives an `OWNER-CROSS-IMPORT` finding. `ownership.allowed` permits imports between each declared owner pair. For files with several owners, one allowed pair is sufficient. A file without an owner is outside this rule.

The summary always has an `architecture` block for the whole project. Each displayed list has at most 20 entries. The stored layer model keeps at most 50 outside paths and counts all outside files.

| Field | Contents |
| --- | --- |
| `layers` | Null without layers. Otherwise: each layer's `name` and `files` count, `exceptions`, `rules`, `violations`, and `outside` with `count` and `paths` |
| `ownership` | CODEOWNERS `file` (null when absent), counts of `rules`, `owners`, `unowned` files and `violations`, `ignored` entries, and `policy` |
| `ownership.ignored` | Total `count` and displayed `items`, each with `line`, `text` and `reason` |
| `ownership.policy` | Null without a policy. Otherwise: `forbidCrossOwnerImports` and the count of `exceptions` |

Without CODEOWNERS, all source files count as unowned. The gaps `outsideLayers`, `unownedFiles`, `codeownersIgnored` and `codeownersMissing` identify evidence limits.

When either snapshot has CODEOWNERS, `comparison.owners` lists owners of changed files. Git supplies all changed files, including non-source files. Each file gets owners from both snapshots. A renamed file also gets the base owners of its old path. This includes ownership edits in the change. GitHub itself requests reviews from the base branch's CODEOWNERS.

The object gives the changed `files` count, sorted `owners`, `touched` owner count, and `unowned` file count. It shows at most 20 `items`, with `path`, `status`, `owners`, and `from` for renames. It is null when the comparison is not comparable or Git cannot supply the change.

File reports expose `owners.file` and `owners.files`. Each file gives its `path`, `owners`, and matching CODEOWNERS `line`. Classic and stored file reports use the same fields.

`code-map inspect --analysis <id> --finding <id>` shows each architecture or ownership violation. It includes import lines and a file command for each side.

## Next.js and React checks

The Next.js checks apply only when a `package.json` in the snapshot lists `next` in `dependencies` or `devDependencies`. The folder of that `package.json` is a Next.js root, so a Next.js app in a subfolder of a monorepo also counts. When a `package.json` lists `next`, each folder with a `next.config` file is also a Next.js root. Thus a monorepo that lists `next` only in its top `package.json` also gets the routes of its apps. Without Next.js, no Next.js rule applies, and `frameworks.nextjs.detected` is `false`.

**Routes.** The route inventory (`nextjs.routes`) lists three kinds of files below each Next.js root:

- The App Router files in `app/` or `src/app/`: `page`, `layout`, `template`, `loading`, `error`, `global-error`, `not-found`, `default` and `route`.
- The Pages Router files in `pages/` or `src/pages/`, with the API routes in `pages/api/`.
- The `middleware` file in the root or in `src/`.

Each entry has `path`, `root`, `router` (`app`, `pages` or `middleware`), `kind`, `url`, `groups`, `slots`, `params`, `intercepts` and `analyzed`. A route handler also has `methods` and `methodState`. An App Router `route` file exports one function for each HTTP method (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`), and `methods` lists them with `methodState: "KNOWN"`. The state is `UNKNOWN` when Code-map did not read the file, or when the file has an `export *` or a destructured export such as `export const { GET, POST } = handlers`. A Pages Router API route handles every method, so its `methods` is null and its state is `UNKNOWN`. The URL pattern has no route groups `(name)` and no slots `@name`. It keeps dynamic segments `[id]`, catch-all segments `[...slug]` and optional catch-all segments `[[...slug]]`. An intercepting segment `(.)x`, `(..)x` or `(...)x` gives the URL that the route intercepts, and `intercepts` gives the marker and the URL where the segment is. A private folder `_name` holds no routes. `analyzed` is `false` when Code-map did not read the file.

**Client and server modules.** `nextjs.modules` gives each classified source file with its `side`, its `reason`, the importer that reached it first (`via`) and the `entry` that the chain starts from:

| `reason` | `side` | Meaning |
| --- | --- | --- |
| `use-client` | client | The file has the directive `'use client'` |
| `use-server` | server | The file has the directive `'use server'` |
| `route` | server | An App Router file or the middleware, without `'use client'` |
| `imported` | client or server | A server entry reaches the file through imports without a `'use client'` boundary (server), or only client modules reach it (client). A file that both kinds reach is a server module |

Code-map follows the import graph of the analysis. Type-only imports do not count. `nextjs.unclassified` lists what Code-map cannot classify:

| `reason` | Meaning |
| --- | --- |
| `not-reached` | No route, no middleware and no client module reaches the file |
| `pages-router` | A Pages Router file, or a file that only Pages Router files reach. The Pages Router has no client boundary |
| `outside-roots` | A route file, or a code file that a classified module imports, outside the source roots. Code-map did not read its imports |
| `not-read` | A route file, or a code file that a classified module imports, under the source roots that Code-map did not read. An example is a file in a folder that Code-map ignores, such as `docs` or `generated` |
| `dynamic-import` | A classified module imports a computed target. `line` gives the import |

**Rules.** The four `NEXT-` rules in the table above use these classes. A finding of `NEXT-SERVER-IMPORT-IN-CLIENT` for a module that imports `server-only` is on the client module that imports it. When that module is itself client code, the finding is on that module. A bare name such as `events` counts as a Node.js built-in only when no Next.js `package.json` lists a package with that name. `code-map inspect --analysis <id> --finding <id>` shows the lead, the class of the module and the import chain from its entry.

**Limits.**

- The checks are static leads. Code-map runs no Next.js build, and it does not read `next.config`: custom page extensions, `env` values, rewrites and redirects are not checked.
- Code-map does not classify the modules of the Pages Router. It lists their routes only.
- A `'use server'` export that comes from a call or a re-export is not checked. Inline `'use server'` functions are not checked.
- `NEXT-CLIENT-PRIVATE-ENV` does not check destructured and computed `process.env` reads. The [environment report](#environment-keys) records them.
- An event handler on a component, such as `<Button onClick>`, does not count. Only handlers on DOM elements, such as `<button onClick>`, count.
- The HTML page does not show the Next.js report.

## The models block

The `models` block of the summary reports the models of expected behavior: boundary values from Zod schemas (C22), state models (C23) and decision tables (C24). [Models of expected behavior](models.md) describes the model files, the checks and the limits. Code-map runs no case. A case is "named in a test" when a test file that imports its file contains the value or sends the event. This is a weak static signal, not a test result.

| Field | Contents |
| --- | --- |
| `available` | False for an analysis that an older Code-map stored. The block then has only `text` |
| `boundaries` | `schemas`, `fields` (the constrained fields), `values` (the boundary values), `named` (the values named in a test), `unknownFields` (the fields without a value, because a limit is not a literal) and `next` |
| `states` | `models`, `declared` (model files), `xstate` (machines in source files), `transitions`, `named`, `unreachable` (states), `deadEnds` (states without a way out that are not final), `unhandled` (pairs of a state and an event that it does not handle), `unknownEvents` (events that a test sends and no transition handles) and `next` |
| `decisions` | `tables`, `rules`, `overlaps`, `conflicts` (overlaps with different outcomes), `cases`, `gaps`, `pairwise` (tables with pairwise cases), `next` for the tables and `nextCases` for the cases |
| `errors` | `total` (the refused model files) and `next` |
| `text` | How to read the block |

The block covers the whole project, also with a `--file` or `--change` selection. It adds no finding, and it does not change the `gaps` of the summary. `code-map verify` does not read it. A model file is part of the code, not a setting. Thus, it changes the analysis ID, but not the settings digest.
## Environment keys

The environment report (`frameworks.env`) compares the environment variables that the code reads with the names that the template files declare. It applies to every project, with or without Next.js.

**Reads.** Code-map records each read in the mapped source and test files. `env.reads` lists each read with `path`, `name`, `via`, `form`, `line` and `test`:

| `form` | Example | `name` |
| --- | --- | --- |
| `property` | `process.env.API_URL`, `import.meta.env.VITE_KEY` | The property name |
| `element` | `process.env['API_URL']` | The string |
| `destructuring` | `const { API_URL, PORT: port } = process.env` | The property name |
| `computed` | `process.env[name]` | null. This is a dynamic read, which Code-map counts but cannot name |
| `rest` | `const { ...rest } = process.env` | null. This is also a dynamic read |

`via` is `process.env` or `import.meta.env`. An assignment (`process.env.X = 'y'`) and a `delete` are writes, not reads.

**Template files.** A template file is `.env.example`, `.env.sample`, `.env.template` or `.env.defaults` in the folder of a `package.json`. `env.templates` lists each one with its `package` (the folder), its `state` and its `names`. Code-map keeps only the text before `=` on each line, with its line number. It never keeps a value.

Code-map never reads `.env`, `.env.local`, `.env.production` or another file that can hold secret values. Working-tree hashes also exclude these values and template and contract symlink targets. It also does not follow a template file that is a symlink, in a commit or in the working tree. It checks the type and the size of each template file before it reads the file.

| `state` | Meaning |
| --- | --- |
| `read` | Code-map read the names |
| `too-large` | The file is larger than 256 KiB. Code-map did not read it |
| `symlink` | The file is a symlink. Code-map did not follow it |
| `missing` | Git lists the file, but it is not a regular file, or Code-map cannot read it |

**Names.** `env.names` is the inventory: one entry for each name, with `platform`, the number of `reads`, the `files` that read it and the `templates` that declare it. A platform name is a name that a platform or a tool sets, such as `NODE_ENV`, `CI`, `NEXT_RUNTIME`, `PORT` or a name that starts with `VERCEL_`. A platform name is never a lead. The list is `isPlatformName` in `lib/frameworks/env.mjs`.

**Rules.** The package of a file is the deepest folder with a `package.json` that holds it.

- `ENV-UNDECLARED`: a code file reads a name, and no template file of its package declares it. The rule applies only when the package has a template file, and only when Code-map read all templates of the package. The rule includes test files.
- `ENV-UNUSED`: a template file declares a name, and no mapped source or test file reads it by this name. The finding says how many dynamic reads the package has, because one of them can read the name.

**Limits.**

- Code-map reads only the mapped source and test files. A read in a file outside the source roots, such as `next.config.js` or a script, does not count.
- A read through another variable, such as `const env = process.env` and then `env.API_URL`, is not recorded. A nested destructuring, such as `const { env: { API_URL } } = process`, is not recorded either.
- A template of a parent package does not count for a nested package.
- The findings are static leads. Code-map does not know the variables of a deployment.
- The HTML page does not show the environment report.

## API contracts

The contract report (`frameworks.openapi`) compares the operations of the OpenAPI documents with the Next.js route handlers. An operation is one method and one path, such as `GET /users/{id}`.

**Documents.** A document is a file named `openapi.json`, `swagger.json` or `*.openapi.json`, outside `node_modules`, with a string field `openapi` or `swagger`. `openapi.documents` lists each file with its `state` and `reason`:

| `state` | `reason` | Meaning |
| --- | --- | --- |
| `compared` | null | Code-map compared the operations with the route handlers |
| `not-compared` | `no-nextjs` | No `package.json` lists `next` |
| `not-compared` | `outside-next-roots` | No Next.js root holds the document |
| `not-compared` | `base-unresolved` | The server URL is a relative URL without a leading slash, or it has a variable without a default |
| `not-read` | `yaml` | A YAML document (`openapi.yaml`, `swagger.yml`, `*.openapi.yaml`). Code-map has no YAML parser |
| `not-read` | `too-large` | The file is larger than 5 MiB. Code-map checks its size before reading it |
| `not-read` | `symlink` or `missing` | The file is a symlink, is not a regular file, or cannot be read |
| `invalid` | `invalid-json` or `not-openapi` | The file is not valid JSON, or it has no `openapi` or `swagger` field |

A document inside a Next.js root is compared even when no route matches. This includes empty documents.

**Paths.** Code-map puts the base path in front of each documented path. The base path is the Swagger 2 `basePath`, or the path of the first OpenAPI 3 `servers` entry when its URL is a relative path such as `/api`. Server variables take their default values. An absolute server URL gives no base path. A documented parameter `{id}` matches one route segment `[id]`, and a catch-all segment `[...slug]` or `[[...slug]]` matches the remaining segments. When several routes match, Code-map takes the route that Next.js takes: a static segment wins over a dynamic segment, and a dynamic segment wins over a catch-all segment.

**Operations.** `openapi.operations` lists each documented operation with `document`, `method`, `path`, `url` (with the base path), `line`, `route` and `state`:

| `state` | Meaning |
| --- | --- |
| `handled` | The route exports the method. Next.js answers `HEAD` from `GET`, and it answers `OPTIONS` for each route handler |
| `no-method` | A route matches the path, but it does not export the method |
| `no-route` | No route handler of the Next.js root matches the path |
| `unknown` | The route has UNKNOWN methods, for example a Pages Router API route |
| `not-compared` | Code-map did not compare the document |

**Handlers.** `openapi.handlers` lists each method of each route handler, with `path`, `url`, `root`, `method`, `state` and `line`. The state is `documented`, `undocumented`, `unknown` (a route with UNKNOWN methods, with `method` null) or `not-compared` (no compared document covers the route). A document with a base path covers only the routes below that path.

**Rules.**

- `OPENAPI-NO-HANDLER`: a documented operation has the state `no-route` or `no-method`.
- `OPENAPI-UNDOCUMENTED-METHOD`: a route file exports a method, and no compared document of its Next.js root describes that method for the route.
- `OPENAPI-PARAM-NAME`: a documented path parameter has another name in the route, for example `{userId}` in the document and `[id]` in the route.

**Compare with a base.** With `--base`, `openapi.removed` lists the operations that the change removed. `documented` holds the operations that a base document has and no head document has. `handlers` holds the methods that a base route exports and no head route with the same URL pattern exports. A head route with UNKNOWN methods covers each method of its URL. The summary shows at most 20 items of each list, with the `total`. When the analyses are not comparable, the lists are null, and `state` and `reasons` give the cause.

**Limits.**

- Code-map compares methods and paths only. It does not compare request bodies, responses, query parameters or security schemes.
- Code-map does not read `next.config`: a `basePath`, rewrites and redirects are not applied. The middleware is not applied either.
- A YAML document is listed as not read. Convert it to JSON to compare it.
- A path item with a `$ref`, and the `servers` of a path or of an operation, are not read.
- The findings are static leads. Code-map sends no request to a server.
- The HTML page does not show the contract report.

## Template import patterns

A relative template import with interpolations and fixed prefix and suffix expands against snapshot paths.
For example, ``import(`./locales/${lang}.json`)`` reaches matching files directly inside `locales`.
The graph records each match with `kind: "dynamic-pattern"` and `mode: "dynamic"`.
These edges carry possible value dependencies. They do not prove which target executes.
An unmatched pattern stays unresolved. Fully computed targets and loader conventions stay unresolved.
Matching never leaves the snapshot or searches nested folders. Pattern expansion runs after cache lookup.
Configuration files that name a dependency as a plugin count as package use, including existing ESLint and Babel short names.

## Package checks

The package checks read each `package.json` of the snapshot, except the files in `node_modules` and in the folders that Code-map ignores, such as `docs` and `dist`. Each folder with a `package.json` is a package, so the checks also apply to a monorepo with npm workspaces.

The *owner* of a file is the nearest `package.json` above it, including a manifest with only a `type` field. An unreadable manifest blocks declaration and orphan checks for its files. The gap `packageManifestsUnreadable` names these manifests.

**Package imports (C01).** A package import is a bare specifier, such as `react` or `@scope/pkg/sub`, with no repository target. Its package name is `@scope/name` or the first path segment. Node.js built-ins, with or without `node:`, are exempt even when a manifest declares the name. Code-map checks source files, test files, declarations, and code outside the configured source roots.

| Rule | When Code-map reports it |
| --- | --- |
| `PACKAGE-UNDECLARED` | The owner does not declare the package in any dependency field. Packages selected by repository workspace patterns and self-references are exempt. Ancestor declarations do not count, including for private packages and tests. `declaredBy` names an ancestor declaration for context |
| `PACKAGE-DEV-ONLY` | A production file imports a package declared only in `devDependencies`, excluding type-only imports, `electron` and its subpaths. Tests, config files, stories, and files in `scripts` are development files |
| `PACKAGE-UNRESOLVED` | A declared package has no folder in `node_modules` from the file folder to the repository root. All four dependency fields count, including peers and optional dependencies |
| `PACKAGE-SUBPATH-NOT-EXPORTED` | The installed manifest has an `exports` field that does not export the imported subpath. Type-only imports also count |

The install checks (`PACKAGE-UNRESOLVED` and `PACKAGE-SUBPATH-NOT-EXPORTED`) need a `node_modules` folder on the path from the file to the repository root. Without one, these checks do not run, and the gap `packagesNotInstalled` names the `package.json` files. In `node_modules`, Code-map reads only whether the folder of a package exists and the `exports` field of its `package.json`. It reads the `node_modules` folders of the working folder, also for the analysis of a commit, because Git does not hold them.

The exports check supports these forms of the `exports` field: a string, an array of fallbacks, an object of subpaths (`"./sub"`), an object of conditions (`"import"`, `"require"`, `"default"` and others, also nested), and patterns with one `*` (`"./features/*.js"`). The pattern with the longest part before the `*` applies, as in Node.js. A target of `null` exports nothing. A subpath is exported when one condition of its target has a value, whatever the conditions of the import. Code-map lists the forms that it cannot evaluate in `packages.unknown.exports`, with no finding, and counts them in the gap `packageExportsUnknown`:

| `reason` | Meaning |
| --- | --- |
| `mixed-keys` | The object mixes subpath keys and condition keys |
| `folder-mapping` | A key ends with `/` (an old folder mapping) or has two `*` |
| `folder-subpath` | The imported subpath ends with `/` |
| `invalid-target` | A target is not a string, an array, an object of conditions or `null` |
| `too-deep` | The field nests more than 16 levels |
| `unreadable-manifest` | The `package.json` of the installed package is not valid JSON, or it is larger than 1 MB |

Code-map does not check these specifiers against a `package.json`. The gap `packageImportsUnchecked` counts them by reason:

| Reason | Meaning |
| --- | --- |
| `absolute` | The specifier starts with `/` |
| `loader` | The specifier has loader syntax (`?` or `!`) |
| `subpath-import` | The specifier starts with `#`: a subpath import of the `imports` field |
| `scheme` | The specifier has a scheme, such as `virtual:` or `bun:` |
| `invalid-name` | The specifier is not an npm package name, for example `@/x` or `~/x` |
| `alias` | A `paths` pattern or `baseUrl` folder in the importing file's TypeScript project matches the specifier |
| `no-package` | No `package.json` is above the file |

**Unused dependencies (C32).** `PACKAGE-UNUSED` is a package in `dependencies` that no code or style file below the package folder uses. Code-map looks for the package in these places:

- The imports of each code file below the folder: source files, test files, code files outside the source roots, config files and declaration files (also `/// <reference types>`). Calls of `require.resolve` and `import.meta.resolve` also count.
- Literal `@import`, `@use`, `@forward`, `@plugin` and `@config` directives in `.css`, `.scss`, `.sass`, `.less` and `.pcss` files.
  `url()` and the webpack `~` prefix count. Code-map skips generated folders and symlinks.
  Each style file has a 1 MiB limit. The snapshot has a 16 MiB total style limit.
- The scripts of the `package.json`. A command name also counts: the name after the scope of a scoped package, and a few known names, such as `tsc` for `typescript`.
- The other fields of the `package.json`, such as `prettier` or `eslintConfig`, and the config files at the package root: `*.config.*`, `.*rc` files, JSON, TOML and YAML files, and `index.html`. An ESLint or Babel plugin, config or preset also counts by its short name, such as `react` for `eslint-plugin-react`.
- A JSX file counts as a use of `react`. A declared `next` counts as a use of `react`, `react-dom` and `sharp`, and a declared `react-dom` counts as a use of `react`.

Code-map skips the `@types` packages, and it does not check `devDependencies`. A `package.json` with no code or style file below it is not checked, and the gap `dependenciesUnchecked` names it. Code-map does not read the rc files of package managers, because they can hold credentials. It does not read the lockfiles either, because a lockfile names every package.

**Orphaned files (C32).** `FILE-ORPHANED` is a source file that no other file imports and that is not an entry point. The importers are the source files, the test files and the code files outside the source roots. A `new URL('./x', import.meta.url)` reference also counts as an import. These files are entry points:

- The files that the fields `main`, `module`, `exports`, `types`, `typings` and `bin` name. A target in build output, such as `dist/index.js`, maps to its source file. The `outDir` and `rootDir` of a TypeScript project map it first. Then `src` replaces the build folder (`dist`, `lib`, `build`, `out`, `esm`, `cjs` and others), or the build folder is left out.
- The `index` file of a package without `main` and `exports`.
- The files that a script names, also through build output and globs.
- The files that the `package.json` or a config file at the package root names, for example `src/main.tsx` in `index.html`.
- Config files (`*.config.*` and `.*rc.*`), Storybook stories, the `setupTests` and `setupProxy` files of Create React App, and the files in a `scripts` or `bin` folder.
- The Next.js route files (`frameworks.nextjs.routes`), and the Next.js metadata and instrumentation files, such as `app/opengraph-image.tsx`.

Test files and declaration files are never orphaned files, because they are not source files. Code-map lists these files in `packages.unknown.orphans`, with no finding, and counts them in the gap `orphansUnknown`:

| `reason` | Meaning |
| --- | --- |
| `dynamic-import` | An `import()` or a `require()` with a computed target can reach the file. A target with a static start, such as `` `./plugins/${name}` ``, reaches the files below that start. A target without a static start, or with a bare start, makes every candidate in its package UNKNOWN. `via` names the file with the import |
| `glob-import` | A Vite `import.meta.glob` pattern or a webpack `require.context` folder names the file |
| `entry-not-mapped` | An entry point of the package names a code file in build output that Code-map cannot map to a source file |
| `file-routing` | The package declares a framework that loads the files of its `routes`, `pages` or `app` folder by their names, for example Remix, Expo Router, Gatsby or SvelteKit |

A source file with no `package.json` above it is not checked, and the gap `orphansUnchecked` counts it. In a comparison with a base, a file that had an importer in the base and has none in the head is NEW. Inside each severity, the summary shows NEW findings first.

**Evidence.** `code-map inspect --analysis <id> --finding <id>` shows the lead with its lines, the owner `package.json` (`path`, `name`, `private`, `owner` and `installed`) and a note about what the rule reads. The analysis keeps the complete report in `packages`: `manifests`, `unreadable`, `leads`, `unknown`, `skipped`, `unchecked` and `entryFiles`, the number of source files without an importer that are entry points.

**Limits.**

- The checks are static leads. Code-map runs no package manager, no bundler and no compiler.
- Code-map does not read the `imports` field, `typesVersions`, Yarn Plug'n'Play or the folder layout of other package managers. Without a `node_modules` folder, the install checks do not run.
- Code-map does not compare the conditions of a target with the kind of import (`import`, `require` or `browser`).
- `FILE-ORPHANED` looks for importers, not for a path from an entry point. A file that only an orphaned file imports is not a finding.
- A package that a framework, a plugin, a computed style directive or a command with another name uses can still be a `PACKAGE-UNUSED` lead.
- The rule set `static-baseline-v0` does not read the package rules. Refer to [verify a change](verify.md#limits).
- The HTML page does not show the package report.

## Triage findings

A team can record a decision about a finding in the triage file, `.code-map-triage.json`, at the root of the repository. You can commit the file. Code-map applies it when it reads a stored analysis: in the summary, in a findings page and in a finding report. A triage entry is the decision of a person. It is not a check result, and `code-map verify` does not read it.

| State | Meaning | Effect in the reports |
| --- | --- | --- |
| `confirmed` | A person decided that the finding is a real problem | The finding stays in the lists, with its entry |
| `dismissed` | A person decided that the finding is a false lead | The finding leaves the lists |
| `suppressed` | A person decided to hide the finding until a date | The finding leaves the lists through its `expires` date. After that date, the suppression is expired: the finding comes back, and the summary lists the entry as expired |

### Write an entry

Run the command inside the repository:

```sh
code-map triage --finding EXPORT-UNREFERENCED-3f9a2c1b4e --state dismissed --reason "A plugin loads it by name." --owner ana
code-map triage --analysis <id> --finding <finding id> --state suppressed --reason "Goes in the next release." --owner ana --expires 2026-12-31
```

The command finds the fingerprint of the finding in a stored analysis. With `--analysis <id>`, it uses that analysis, which must be of this repository. Without `--analysis`, it uses the stored analysis of the current code. It selects the code as `inspect --summary` does: `--worktree`, `--ref <ref>` or the default branch. The command writes the file through a temporary file and a rename. It replaces an entry with the same fingerprint, and it sorts the entries by fingerprint. It prints the entry and the new digest of the file. When the file changed after the command read it, the command writes nothing and fails.

You can also edit the file by hand:

```json
{
  "triageVersion": 1,
  "entries": [
    { "fingerprint": "0123456789abcdef", "ruleId": "EXPORT-UNREFERENCED", "state": "suppressed",
      "reason": "Goes in the next release.", "owner": "ana", "date": "2026-10-22", "expires": "2026-12-31" }
  ]
}
```

| Field | Rule |
| --- | --- |
| `fingerprint` | The 16 hexadecimal characters of the `fingerprint` of the finding. Each fingerprint can have one entry |
| `ruleId` | The rule of the finding. An entry applies only when its rule and its fingerprint agree with the finding |
| `state` | `confirmed`, `dismissed` or `suppressed` |
| `reason` | Why the person decided: 1 to 1000 characters |
| `owner` | Who decided: 1 to 100 characters on one line |
| `date` | The date of the decision, in the form `YYYY-MM-DD`. It must not be later than one day after the current date |
| `expires` | Necessary for `suppressed`, and refused for the other states. The last day of the suppression: not before `date`, and at most 365 days after it |

Dates are calendar dates in UTC. Code-map refuses a file with an unknown field, a missing or empty value, an unknown state or rule, a date that is not valid, an expiry past the limit or a duplicate fingerprint. The error names each problem with its path, for example `entries[2].expires`. The summary, the findings pages, the finding reports and the command fail until you correct the file.

### What the reports show

- A summary or a findings page leaves dismissed findings and active suppressions out of its lists and its counts. `findings.hidden` in the summary and `triage.hidden` in a findings page give the number of hidden findings in the scope, for each state.
- `--include-hidden` shows the hidden findings again, and the counts include them. `findings.hidden` still counts them. The printed commands keep the option.
- Each item with an entry has a `triage` object: `state`, `owner`, `date`, `expires` for a suppression, and `expired: true` for an expired suppression.
- A finding report (`--finding <id>`) has a `triage` object with the file `path`, its `digest`, the `date` of the expiry checks, the complete `entry` (or null), `matchedBy`, `hidden` and `expired`.
- A findings page has a `triage` object with `path`, `digest`, `date` and `hidden`.
- Without a triage file, every report is the same as before.

| Field of `triage` in the summary | Contents |
| --- | --- |
| `path`, `digest` | The triage file and the SHA-256 digest of the content that Code-map applied |
| `date` | The current date that Code-map used for the expiry checks |
| `includeHidden` | True when `--include-hidden` shows the hidden findings |
| `entries` | The number of entries, in total and for each state |
| `expired` | The expired suppressions (`total` and up to 20 `items`), each with the ID of its finding, or null |
| `unused` | The entries that match no finding of the analysis (`total` and up to 20 `items`). `cause` is `no-finding`, or `rule-differs` when a finding has the fingerprint but another rule |
| `precision` | One row for each rule with at least one label. Refer to [measure precision](#measure-precision) |
| `commands` | Templates for the triage command and for a sample page |

`expired`, `unused` and `precision` describe the whole analysis, not the selection of the summary.

### Renames

The fingerprint comes from the paths of a finding, so a rename gives the finding a new fingerprint. In a comparison with a base (`--base <ref>` or `--base-analysis <id>`), an entry also applies to the head finding that matches its base finding through a rename. The `triage` object of the item then has `matchedBy: "rename"` and the `fingerprint` of the entry. Without a comparison, the summary lists the entry as unused. To move the entry to the new fingerprint, run `code-map triage` for the new finding, and remove the old entry from the file.

### Measure precision

A label is the state `confirmed` or `dismissed`. A suppression is not a label. For each rule with at least one label, `triage.precision` gives these values:

- `confirmed` and `dismissed`: the numbers of labeled findings of the rule
- `share`: the number of confirmed findings divided by the number of labeled findings, with three decimals
- `unlabeled`: the number of findings of the rule without a label
- `sample`: the command for the first sample page of the rule

To label a sample, do these steps:

1. Run the `sample` command of the rule, or `code-map inspect --analysis <id> --findings --rule <rule id> --unlabeled`.
2. Examine each finding of the page in the code.
3. Record `confirmed` or `dismissed` for each finding with `code-map triage`.
4. Run the summary again, and read `triage.precision`.

The sample page lists the findings of the rule without a label, in the order of their fingerprints. Suppressed findings are part of it. A fingerprint is a hash, so this order does not follow paths or severity. Thus, the first page is a fair sample. A labeled finding leaves the list. Thus, after you label a page, run the `sample` command again without `--offset`. A `next` command that you got before you labeled the page skips findings. `--unlabeled` needs `--rule`, and it cannot go with `--include-hidden` or `--base-analysis`.

### Limits of triage

- `code-map verify` and the rule set `static-baseline-v0` do not read the triage file. A dismissed or suppressed finding still counts there.
- Code-map reads the triage file in the working folder now, also for an analysis of an older commit.
- The triage file is not an input of the analysis. It does not change the analysis ID, the freshness or the settings digest. It changes `snapshot.worktreeDigest` of a working tree, because that digest includes changed triage files. A commit of the file is a new commit. Thus, the analysis of the old commit is stale, and the summary of the new commit is a new analysis with a full collection.
- An entry follows a rename only in a comparison with a base.
- The command cannot remove an entry. To remove one, edit the file.

## Analysis ID and freshness

The analysis ID is a hash of the inputs that decide the analysis:

- The repository folder and the snapshot selector
- The commit SHA that the selector resolves to, and the mapped ref
- For a working tree: a content hash of each code, declaration, JSON, Prisma, regular env template, CODEOWNERS or package config file that differs from the commit, because the collector reads these files. The model files in `.code-map/models` and `.code-map/decisions` are JSON files, so a model edit changes the ID. The [triage file](#triage-findings) is not an input. For any other file, only whether it is there, because an import can resolve to it. Checked README and docs Markdown files, schema contracts and deployment declarations also count by content. An edit of a generated page does not change the ID. Staging a change with `git add` does not change the ID either, because the index does not count. A file marked assume-unchanged or skip-worktree counts with its content. A tracked symlink counts with the content of its target when the commit does not hold the target. Env templates and contracts never count target content
- The first existing branch of `main`, `master`, `origin/main` and `origin/master`, which `--change branch` uses
- The form of the history: whether the clone is shallow, and digests of the shallow boundary, the grafts file and the replace refs
- The loaded `.code-map.json`, the test-labels file, and the coverage file with its modification time
- The analyzer: the code-map version, a hash of its source files, and the TypeScript and Node versions
- The root lockfile of the project
- The installed state for the selected snapshot: module-folder existence, resolved package locations, and their `exports` fields. Nested installations also count. A relevant install or exports change gives a new analysis ID

The same inputs give the same ID. View options (`--file`, `--change`, `--summary`, `--part` and paging) do not change the ID. Code-map hashes files itself, and it runs Git without optional locks and with a private copy of the index, so it does not change the repository. Refer to the limits below for two cases inside Git. The stored analysis keeps no history strip, so `--history` does not apply.

Each follow-up command computes the inputs again and compares them with the stored inputs:

| `freshness.state` | Meaning |
| --- | --- |
| `current` | The inputs are unchanged |
| `stale` | At least one input changed. `changed` lists the kinds (`commit`, `worktree`, `history`, `base-branch`, `config`, `labels`, `coverage`, `lockfile`, `installed`, `analyzer`, `environment`), and `refresh` is the command for a new summary. The report still shows the stored snapshot, not the current code |
| `unknown` | Code-map did not read the repository. `text` gives the reason |

Run the `refresh` command inside the repository.

## The store

The store is the first of these folders: `--store <folder>`, `CODE_MAP_STORE`, `XDG_CACHE_HOME/code-map`, `~/.cache/code-map`. A relative `XDG_CACHE_HOME` is ignored, as the XDG specification requires. A store inside the repository is refused, because it would change the working tree that it describes. The check compares whole folder names, and on macOS and Windows it ignores letter case and the Unicode form of a name.

Code-map refuses a store folder that other users can change. The root folder can be shared only with the sticky bit, as `/tmp` is. The `analyses` and `exports` folders and each stored file must belong to you, must not be symlinks, and must not be writable by other users. Code-map checks `exports` against the repository and its Git folders before analysis. A private report write rejects a symlink or unsafe output folder. When Code-map reads a stored analysis, it checks each value that goes to Git or to the file system: the repository path, the ref, and the labels and coverage paths. A `--summary` with a labels file or a coverage file outside the repository fails before it collects. Each analysis is one gzip-compressed JSON file, `analyses/<id>.json.gz`, with permissions for the user only. Code-map writes a temporary file and renames it, so a reader never sees half a file. The store keeps the 20 analyses used most recently and deletes the older ones when it saves a new one. Several processes can share one store. A store that you can only read still serves its analyses.

A stored analysis holds paths, names, import facts, test facts and the declared signature of each export, with at most 300 characters for each signature. It also holds the model report: the boundary values, the state and event names, and the values and outcomes of the decision tables. It also holds schema facts and the arguments of Drizzle column builders, such as `{ length: 256 }`, and the values of JSON Schema `enum` lists. Schema defaults and other attribute arguments are digests. For each export, it also holds whether a JSDoc comment documents it and the range of argument counts that a call can pass. It holds no other source text. From env templates, it holds only names, never values. You can delete the store at any time. The next summary of unchanged code gets the same ID again.

### The file cache

The file cache keeps the facts of each analyzed file. These facts include declarations, imports, exports, metrics, complexity, export signatures, React directives, environment reads and test cases. `inspect --summary`, `inspect --summary --base <ref>` and `verify` use the cache. Files with matching inputs and import targets need no new parse. The classic `inspect` report and the page do not use the cache.

The cache is the folder `files` in the store. Each entry is one gzip-compressed JSON file, `files/<key>.json.gz`. The key is a SHA-256 of these inputs:

- The content of the file and its path
- The analyzer: the code-map version, a hash of its source files, and the TypeScript and Node versions. Thus each change to Code-map makes the old entries unused
- The settings of the per-file work: whether the file is a test file
- The configuration hash and the dependency-lock hash of the analyzed snapshot

Code-map resolves each recorded import again in each new analysis. An entry is valid only when the resolver gives the same answers. A changed import target invalidates the importing file. This includes target changes from added files, removed files and changed `tsconfig.json` settings. Cross-file steps run again in each new analysis. These steps include import cycles, test links, findings and the Next.js report.

The cache preserves analysis facts. Timestamps and cache counts differ between runs. The stored `cache` field records `state`, `hits`, `misses`, `written` and `removed`. States are `on`, `off` and `unavailable`. An unavailable cache also records a `reason`. The summary shows counts in the last line of `limits`.

`--no-cache` bypasses stored analyses and per-file entries. It parses every file again and replaces the stored analysis with the fresh result. Follow-up commands still read the stored result.

The cache has the same folder protection as the `analyses` folder. The `files` folder and each entry must belong to you. They must not be symlinks or writable by other users. Code-map writes entries atomically through private temporary files. Entries carry an integrity hash over their facts and resolver answers. A changed payload fails this check and becomes a miss. This hash detects changed data. It does not authenticate an entry against a writer with access to the private store.

Damaged or unreadable entries are misses. Code-map parses the source again and writes a replacement entry. Non-file entries cannot block a read. An unsafe cache folder turns off per-file reuse. A cache folder inside the repository or its Git folders causes an error, including through a symlink.

The cache keeps at most 200,000 entries and 200 MiB. After writing entries, Code-map removes old entries until both limits hold. It removes its temporary files after one day. Each entry also holds source comments above imports and declarations. You can delete `files` at any time.

## Errors

When a command fails, it prints a message to standard error, prints nothing to standard output and exits with a nonzero status. Examples:

- The analysis ID is not in the store, or it is not in the form `A-` and sixteen hexadecimal characters.
- The stored file is unreadable or damaged.
- A retrieval option (`--finding`, `--findings`, `--rule`, `--part`, `--offset`, `--limit`, `--full`, `--api`, `--api-group`, `--dependencies`, `--schemas`, `--impact`, `--undocumented`) has no `--analysis`.
- `--analysis` comes with `--worktree` or `--ref`. The analysis already identifies its snapshot.
- The finding ID, the rule ID or the part name is unknown. `--part` with more than one `--file` fails. A project part of a stored analysis that an older Code-map made fails, because that analysis has no framework report or no model report. For a rule or a part, the message lists the valid names. For a finding, it gives the command that lists the findings.
- `--limit` is not a whole number from 1 to 500, or `--offset` is outside the safe integer range from 0 to 9007199254740991.
- `--api` has no `--base-analysis`, or its status is not one of `all`, `removed`, `changed`, `unknown`, `added` and `renamed`. `--api-group` has no `--api`, or it is not `public` or `module`.
- `--schemas` comes with `--finding`, `--findings`, `--part`, `--full`, `--summary`, `--complexity`, `--file` or `--change`.
- `--impact` has no `--base-analysis`, or its list is not one of `affected`, `tests`, `references`, `calls` and `docs`. `--undocumented` comes with `--base-analysis`, or the stored analysis has no documentation facts because an older Code-map stored it.
- `--base` has no `--summary`, comes with `--analysis`, or does not name a commit. `--base-analysis` or `--baseline` has no `--analysis`, or `--baseline` is not one of `new`, `existing`, `resolved` and `unknown`.
- The triage file is not valid. The message names each problem with its path, for example `entries[2].expires`.
- A `layers`, `allowed`, `layerExceptions` or `ownership` setting in `.code-map.json` is not valid. The message names each problem with its path, for example `layers[1].paths[0]`. A source file matches the paths of two layers. The message names the file and the two layers.
- `--include-hidden` has no `--summary` or `--analysis`, or it comes with `--finding`, `--full`, `--part` or a file report. `--unlabeled` has no `--findings` or no `--rule`, or it comes with `--include-hidden` or `--base-analysis`.
- `--state`, `--reason`, `--owner` or `--expires` comes with `inspect`. These options work only with `code-map triage`.
- `--no-cache` comes with `inspect` but without `--summary`. Only a new analysis reads the file cache.

## Limits

- `code-map inspect` does not write to the repository or to its `.git` folder. Only `code-map triage` writes to the repository, and only the triage file. Git commands that compare with the working tree use a private copy of the index. Two cases are outside Code-map's control: in a partial clone, Git can fetch a missing object into `.git/objects` when Code-map reads an old commit, and a Git filter driver (for example Git LFS) runs its own program when Git checks a file that has one.
- A file whose name has a line break is left out of the map, because Git's blob reader reads one name for each line.
- The first summary of a snapshot costs a full collection. The file cache saves only the parse of unchanged files. Code-map still reads every file from Git, resolves every import and runs every step that reads more than one file.
- An entry of the file cache holds the resolver answers of one snapshot. When the base and the head of a comparison resolve an import of an unchanged file to different files, each analysis parses that file again and replaces the entry of the other one.
- Findings are static leads. Inspection runs no project test or command. Confirm each finding in the code before you act on it.
- The supply part reads one supported lockfile at the root. It runs no package manager, reads no file in `node_modules` and uses no network. A license in the lockfile is the license that the package declares.
- No verification ran. The summary has no rating, no readiness and no PASS or FAIL result.
- A layer or owner finding is a lead about an import, not a proof of a call. A CODEOWNERS file tells who reviews a file. It does not prove a boundary in the code. Code-map does not ask GitHub whether an owner exists.
- No check of `code-map verify` reads `OWNER-CROSS-IMPORT`. The architecture-rule check reads the `ARCH-RULE` findings, and thus the layer rules.
- A triage entry hides a finding only in the reports of `inspect`. `code-map verify` does not read the triage file, so a dismissed or suppressed finding still counts there. Refer to [limits of triage](#limits-of-triage).

## Bound Next.js build sizes

Run the project's build yourself, then run `code-map sizes --dir .next --out reports/sizes.json`.
Write its run manifest with `code-map manifest --kind sizes`, then add the report pair to the verification request.
Ignore build output and reports in Git before the build. Write each manifest immediately after its successful build.
A bound report on each side gives route growth, new routes, removed routes and static totals in `verify`.
One side gives values without changes. These observations do not affect readiness or ratings.
Refer to [bound size reports](verify.md#bound-size-reports).

## Mutation testing

Inspection finds candidate tests. It does not run mutants.
Use `code-map mutate` for authorized isolated execution, or import a `stryker-json` report in `verify`.
Refer to [mutation testing](mutation.md) for the commands and evidence limits.

The supply policy also accepts boolean `forbidInstallScripts`. Only the [evidence-v1](verify-evidence-v1.md) check uses this flag.

## Contract and example information

Inspection reads GraphQL SDL, Protocol Buffers, deployment variable names and fenced JavaScript or TypeScript examples.
With `--types` or `typeCheck: true`, TypeScript examples receive compiler diagnostics and explicit skip counts.
Comparable typed revisions label new example errors NEW. These observations remain information only.
With `--base`, `frameworks.protocols.changes` classifies supported schema changes. Unsupported constructs give UNKNOWN.
Use `--part protocols.documents`, `protocols.changes`, `deployment.documents`, `examples.issues` or `examples.gaps` with the stored analysis.
The summary provides the complete commands. Checked Markdown edits invalidate working-tree analyses.
Route harness runs require an existing authorization and a working sandbox backend.
Refer to [contract evidence](contracts.md) for formats and limits.

## SBOM export

Use `code-map sbom --worktree --out bom.json` to export CycloneDX 1.5 JSON.
Use `--ref HEAD` to select committed lockfile bytes.
The command runs no project code and uses no network.
Each component has its package identity, purl, recorded license and supported integrity hashes.
Dependency entries reference resolved package paths. Unresolved selectors have no invented edge.
Missing lockfile fields remain absent. Invalid integrity digests have no exported hash.

## Bound coverage information

Working-folder coverage in `inspect` stays unbound. It does not prove execution for a revision.
`verify` imports bound reports and writes `coverageEvidence` with project totals, source map joins and adjusted base comparisons.
Refer to [measured coverage information](coverage.md) for fields and limits.

## Run authentication information

Verification reports show manifest signature states, signer fingerprints and base/head environment differences.
An invalid signature or unknown signer excludes the report. Unsigned reports retain compatibility.
No new rule-set check reads the signature or environment information.
Read [run authentication](run.md#manifest-signatures-and-environment) for `trustedRunKeys` and the optional disk budget.

## Migration patterns

Set `migrations` in `.code-map.json` to a list of patterns:

```json
{"migrations": [{"from": "legacy", "to": "modern", "note": "Use the new API."}]}
```

Each pattern has three nonempty text fields. `from` matches an exact import path, imported name or call name.
Named import aliases match the imported name. Default, namespace and import-equals bindings match their local name.
Calls match identifier names or the final name of a member expression.
Re-exports, import types, and literal `import()` and `require()` paths also match. Comments and unrelated strings do not match.
The scan covers mapped sources, scanned tests and package-root configuration files.
Each use produces a `MIGRATION-USE` finding with the replacement and note.
Comparisons label uses NEW, EXISTING, RESOLVED or UNKNOWN through the normal finding comparator.
Identical uses have occurrence ordinals. Inserting an identical use can shift these identities.
This syntax scan does not resolve call aliases or prove semantic compatibility.
These findings add no verification check and change no rating.

## Revision policy information

`inspect --summary --base <ref>` includes `comparison.policy`.
Code-map reads each revision's `.code-map.json` with the read-only Git reader.
A working-tree head uses its current settings file. A missing settings file means an empty architecture policy.
The policy contains `rules`, ordered `layers` and the combined `allowed` and `layerExceptions` lists.
`evaluations.basePolicy` evaluates the base policy on both snapshots.
`evaluations.headPolicy` evaluates the head policy on both snapshots.
Each evaluation keeps declared rules, invalid rule texts and forbidden import witnesses.
The report lists added and removed rules, added and removed layers, and layers with changed path lists.
`layers.reordered` names layers whose positions changed. `layers.relaxed` lists removed forbidden layer pairs, including pairs without import witnesses.
`relaxed` lists previously forbidden import edges that the head policy permits on the same snapshot.
An equivalent rule or another restriction on the same edge prevents a false relaxation.
A stale or unknown working-tree snapshot gives UNKNOWN policy information.
These witnesses describe scanned edges. They do not prove a general relationship between arbitrary path patterns.
Invalid policy input gives UNKNOWN with a reason.
The existing analysis inputs, configuration hash and ID algorithm stay unchanged.
The existing analyses still use working-folder settings. This separate information adds no profile check.

## Controlled command timings

Use `code-map bench --authorization <id> --runs 5 --warmup 1 --worktree -- <command...>` with an existing exact-command authorization.
Bench repeats the command sequentially in one restricted workspace and keeps an isolated `bench` report.
Add base and head run IDs to verification `reportInputs`.
Verification compares median times against noise and configured thresholds. Load drift or incompatible runs give UNKNOWN.
Timing observations do not affect ratings or readiness.
Refer to [controlled timings](run.md#controlled-timings).

## Bound compiler diagnostic lifecycle

Add `--compiler-report reports/head.txt` to `inspect --summary --base <ref>`.
Add `--base-compiler-report reports/base.txt` for a base report.
Each report needs a sidecar named `<report>.manifest.json` with artifact kind `tsc`.
Create each manifest immediately after its compiler run with `code-map manifest`.
Use `--out reports/head.txt.manifest.json` for the head example.
Both artifact paths must be repository-relative. Reports stay separate from cached structural analyses.

The `compiler` block gives full lifecycle counts, up to 20 `entries`, and up to 20 `newDiagnostics`.
`truncated` identifies shortened lists. Diagnostic previews cap messages at 160 characters and file paths at 200 characters.
Use verification JSON for complete diagnostic text.
This block covers the compiler reports, independent of `--file` and `--change` selections.
Each entry has a diagnostic, a fingerprint, a baseline label, a side, an artifact and a matching reason.
The fingerprint has 16 hexadecimal characters. It excludes line and column coordinates.
File identity follows Git renames. Messages normalize embedded coordinates and quoted type names.
Unresolved symbol names and other numeric values remain significant.
Matched entries retain the base fingerprint as `previousFingerprint`.

One bound, unfiltered report per side and comparable run settings establish NEW, EXISTING or RESOLVED.
Missing, filtered, interrupted, multiple or incompatible reports give UNKNOWN.
Repeated normalized identities are ambiguous. Incomplete rename evidence gives UNKNOWN.
An unmatched diagnostic in an edited move also gives UNKNOWN.
The execution records explain refused manifests, stale reports and wrong-side reports.
Manifests attest scope but do not prove compiler file discovery or an honest run.
Lifecycle labels are information. They change no finding rule, check, rating or readiness result.

## Observed state information

`inspect --summary --worktree --run <run ID>` adds a bound trace comparison under `xstateTrace`.
Use the store that holds the trace run. A stored analysis also accepts `--summary --run <run ID>`.
Binding uses that analysis snapshot. Stale trace information is null.
Read [observed transitions](models.md#observed-xstate-transitions) for fields and limits.

## Human weakening reviews

The `evidence-v1` profile requires current human reviews for assertion and runner weakening.
The `static-baseline-v0` results stay unchanged.
A model must not write a review record.
A person uses `code-map review-weakening --entry <weakening ID> --reason <text> --reviewed-by <name>`.
Add `--base <ref>` to match a verification base other than HEAD.
Refer to [weakening reviews](weakening-reviews.md) for record fields and limits.

## Trust configuration validation

Inspection validates optional `.code-map.json` `trust` minimums but does not execute tools or apply evidence minimums.
Invalid tool names or unknown tiers stop configuration loading.
Refer to [tool trust minimums](verify.md#tool-trust-minimums) for verification policy and tier definitions.


## Compiler-aware relative imports

Relative imports use the owning snapshot project settings and package module format.
NodeNext ESM imports require explicit extensions. CommonJS references retain compiler extension lookup.
Import-equals declarations retain their line, target, and value or type dependency kind.
Unresolved relative targets produce `IMPORT-UNRESOLVED` evidence.
Without an owning project, relative imports use extension and index lookup.
Computed targets and unsupported loaders remain unknown.

With `--types`, API comparison also checks explicit named parameter and return shapes.
Read [compiler facts](types.md) for UNKNOWN states and consumer compatibility limits.

## Export candidates and pending discovery

`inspect` reports `tests.exportedFunctions`, including pure functions and local export aliases.
Each entry lists public names, direct case IDs and transitive case routes.
`relationship` is `direct`, `transitive` or `candidate`. These states describe static references only.
`runtime` stays UNKNOWN because static references do not establish instrumented hits.
Bound function counters remain separate measured evidence. Missing counters never mean zero hits.
`TEST-EXPORT-CANDIDATE` identifies functions without a static test relationship.
Files that Code-map marks as vendor candidates (`components/ui/` and `components/ai-elements/`) give no such finding. They are copied library code. `tests.exportedFunctions` still lists them.
The existing failure-exit findings keep their separate meaning.

Mocha discovery includes `pending` cases with `status: "skipped"`, including files that contain only pending cases.
Overlapping test and pending entries count once per occurrence. Pending-only duplicate names retain their multiplicity.
Pending entries count toward the discovered denominator. Discovery alone gives no execution credit.

## Explicit SQL snapshots

Schema discovery reads `schema.sql` and `*.schema.sql` outside test and fixture folders.
Each file must contain the line `-- dialect: sqlite`.
The compatibility mode is `conservative-structural`. The package is the nearest package folder.
Supported CREATE TABLE statements contain literal unquoted table and column names.
Column types are INTEGER, INT, TEXT, REAL, BLOB and NUMERIC.
Supported column constraints are NOT NULL, PRIMARY KEY, UNIQUE and literal DEFAULT values.
Removed columns, changed types and new required columns without defaults are breaking.
Unsupported dialects, statements and constraints retain UNKNOWN evidence. This parser executes no SQL.
Migration scope is the adjacent `migrations` folder, with direct `.sql` files in path order.
Read [fixture migrations](schema-migrations.md) for execution and transformed-data assertions.

JSON Schema and JSDoc integer ranges also appear in `models.boundaries`.
Read [integer range boundaries](models.md#integer-range-boundaries) for constraints and execution links.

## Stored verification band comparison

Verification results include a schema-bound rubric and obligation scope.
Use `baselineReport` in a verification request to compare with an earlier run in the same output store.
Read compatibility reasons before using a band direction. Missing compatibility evidence and Unassessed bands stay UNKNOWN.
The baseline changes no rating or readiness result.
Refer to [the stored verification contract](verification-contract.md).

## Audited quality evidence

Refer to [quality evidence](quality-evidence.md) for generated consumers, size deltas, ownership revisions, dynamic dependencies and declared safeguards.
