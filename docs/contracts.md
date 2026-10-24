# Bounded contract evidence

Inspection adds information without new finding rules or rating checks.
Use `inspect --summary --base <ref>` to compare stored snapshots.
The summary gives commands for the complete paged lists.

| List | Contents |
| --- | --- |
| `protocols.documents` | GraphQL and Protocol Buffers definitions and UNKNOWN constructs |
| `protocols.changes` | Breaking, compatible and UNKNOWN changes with `--base-analysis` |
| `deployment.documents` | Names declared by deployment files, without values |
| `deployment.missingReads` | Code reads absent from known deployment declarations of that package |
| `deployment.missingTemplates` | Template names absent from known deployment declarations of that package |
| `deployment.unused` | Deployment names without a literal code read in that package |
| `examples.issues` | Syntax errors and missing named self-import exports |
| `examples.gaps` | Unread files, unclosed fences and unresolved public interfaces |

## Schema subset

Files ending in `.graphql` and `.gql` support types, fields, arguments, scalar defaults, enums, inputs and unions.
Removed types, fields or enum values, changed field types and new required arguments are breaking.
A new optional field or argument is compatible.
Directives, interfaces, extensions and unsupported defaults give UNKNOWN.

`.proto` files support messages, numbered fields, enums, reservations and unary service methods.
Removed unreserved fields, changed field numbers or types, removed methods and reused numbers are breaking.
New fields with new numbers are compatible. Number ranges and names can reserve removed fields.
Nested messages, oneof, maps, field options and streaming methods give UNKNOWN.
Comparisons match documents by path and definitions by name. File moves are not rename-paired.
Imports and cross-file type resolution are outside this subset.
Each schema file has a one MiB read limit. Symlinks, symlinked parent folders and nonregular files stay UNKNOWN.

## Deployment names

`Dockerfile` retains `ENV`, `ARG`, declaration lines and zero-based build stages, including continuation lines.
Only `ENV` declarations inherited by the last stage satisfy runtime reads.
Named parent stages retain inherited variables. Discarded stages and `ARG` declarations remain in `deployment.buildOnly`.
`deployment.ambiguousReads` lists ARG matches without runtime declarations. The execution phase of those reads is unknown.
Dynamic stage parents give UNKNOWN. External image variables are not inferred.
`vercel.json` supports the top-level `env` object.
`docker-compose.yml` and `docker-compose.yaml` support `environment` mappings with literal keys.
Compose lists, inline maps, interpolation and YAML merge keys are outside this subset.
Unsupported forms give UNKNOWN. Each deployment file has a 256 KiB limit.
Names are compared within the nearest package folder. Platform names are excluded from mismatch lists.
Values never enter the stored evidence. The tool reads no private `.env` files for these comparisons.
A mismatch is information. Templates can intentionally describe variables supplied outside the deployment file.

## Checked examples

The reader scans `README.md` and `docs/**/*.md`. Each file has a one MiB limit.
Backtick and tilde fences support `ts`, `tsx`, `js` and `jsx`.
The installed TypeScript parser reports syntax diagnostics with document lines.
Named and default imports from a package's own name are compared with its root entry-point exports.
Subpath-only exports cannot satisfy a root import.
An unresolved public interface gives a gap. Without typed facts, external package imports are not checked.
With `--types` or `typeCheck: true`, each `ts` and `tsx` block becomes an isolated virtual module.
The worker uses the nearest containing compiler configuration and its snapshot source files.
For configurations in one folder, `tsconfig.json` takes priority. Other names use lexical order.
Self-imports resolve to declared root source entry points. Other imports use compiler resolution within the snapshot.
`examples.issues` includes type diagnostics with `path`, `block`, `blockLine`, `line`, `column`, `code` and `message`.
`blockLine` identifies the opening fence. `line` identifies the diagnostic location in the document.
`checked` and `skipped` count checked blocks and explicit opt-outs.
A `no-check` fence option or a `// @ts-nocheck` line skips the block.
Missing programs and budget stops leave type evidence UNKNOWN.
The summary exposes `typeState`. Complete base and head evidence without document gaps labels diagnostics NEW or EXISTING.
Comparison matches document path, block ordinal, diagnostic kind, code and message. Document restructuring can change this identity.
Follow the summary command with `--base-analysis` to page through `examples.issues` in the comparison.
Verification includes the same labels in `contractInformation.examples`. No rating check reads them.
Compiler libraries come from installed TypeScript. External dependencies outside the snapshot remain unresolved.
Snippets do not execute. Semantic documentation compatibility remains a human judgment.

## Runtime contracts

The [route harness](harness.md#route-mode) sends bounded example requests inside the restricted worker.
It starts no server. It checks statuses and the supported JSON rules, without claiming full framework integration.
Verification stores the new static evidence under `contractInformation` with the policy `information-only`.
An empty evidence section is omitted to preserve existing output.
Bound route runs use the existing harness report interface. No new rule-set check is added.

## OpenAPI execution rules

Request examples are checked against their declared parameter and JSON body schemas before execution.
Invalid examples give UNKNOWN with the failing rule.
Responses support nested objects, array items, scalar types, enum, const, numeric bounds and length bounds.
Required fields and closed object rules are checked. Invalid JSON response text fails before schema checks.
Unsupported rules, including pattern, format, references and composition, retain UNKNOWN even on absent optional fields.
These checks run inside the authorized route harness. They do not start a server.
