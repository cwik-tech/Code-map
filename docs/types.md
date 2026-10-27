# Compiler-backed facts

Use `code-map inspect --worktree --types` to collect compiler facts for the current files.
Use `--ref <commit> --types` to analyze committed files.
Add `"typeCheck": true` to `.code-map.json` to enable these facts for inspection and verification.
The default stays off.

`typeBudgetMs` sets the total worker budget in milliseconds.
The default is 60000 (60 seconds). The supported range is 1 through 120000. On a Next.js project with about 400 files and four configuration files, the typed facts took about 20 seconds.
A budget stop discards all compiler facts and returns `state: "UNKNOWN"` with `reason: "budget"`.
Stored analyses keep separate identities for typed and untyped collection.

## Programs and exports

Code-map reads each snapshot `tsconfig*.json` with its installed TypeScript compiler.
Local configuration inheritance, include lists, exclude lists, and imported snapshot files use compiler resolution.
The virtual compiler host reads snapshot texts and installed compiler library declarations.
It does not execute project code or read project dependencies from another revision.
A missing dependency can produce unknown types.
Invalid configurations and `noCheck` programs do not attest checked files.
Unchecked JavaScript and declarations excluded by `skipLibCheck` do not count as checked files.

The `typed.programs` list records each configuration, its state, and its checked repository files.
The `typed.exports` map records checker type text and bounded structural digests for module exports, including public entry points.
Known inferred and explicitly annotated exports compare by checker text and structural digest.
Equal text and structural digests resolve an inferred body change as unchanged.
Different text or structural shape reports `CHANGED` with reason `checker-type`.
Declared syntax changes remain visible even when checker shapes match.
Missing or ambiguous export shapes in complete programs give UNKNOWN with reason `checker-type-unknown`.
A stopped worker or missing typed snapshot gives UNKNOWN with reason `checker-unavailable` when syntax is unchanged.
Comparisons without typed collection on either side retain syntax-based leads.

## Renames and release policy

A unique removed and added export with the same normalized signature forms one `RENAMED` item.
The pair stays within one file, including a file that Git renamed.
The `pair` field contains `from` and `to` names.
Ambiguous and truncated signatures remain separate items.
When compiler facts exist, rename pairs also require matching known compiler signatures.

A public removal, rename, or signature change includes `releasePolicy`.
A stable package major increase permits a break.
For a zero-major package, a minor increase also permits a break.
Only plain three-part release versions establish an automatic permission.
Use `"api": { "breaking": "allowed" }` or `"api": { "breaking": "forbidden" }` to override this permission.
Permission describes release intent. It does not prove consumer compatibility.

## Calls and symbol impact

Checker calls contain `COMPATIBLE`, `INCOMPATIBLE`, or `UNKNOWN` argument compatibility.
Known argument types use checker assignability against the resolved head signature.
Spread calls, rest parameters, and unresolved argument types retain UNKNOWN where compatibility cannot be established.
Overload diagnostics identify incompatible calls.
Verification selects calls of changed public exports.
Static call pages also include checker compatibility when typed facts exist.

The symbol walk follows affected named imports, named re-exports, and local declaration references.
It stops after eight levels or 1000 results by default and reports `truncated`.
The language service finds named, default, and namespace import references of removed names.
Verification labels those references with `evidence: "language-service"`.
External consumers and dynamic property lookup remain unknown.
Text searches continue to supply leads for configuration, documentation, and generated consumers outside compiler programs.

## Bound file discovery

Run `tsc --listFilesOnly` and save its output inside the repository.
Bind it with `code-map manifest --kind tsc-files --artifact <report> --exit-status 0 -- tsc --listFilesOnly`.
Add the artifact and manifest paths to the verification request's `reportInputs`.
Code-map accepts only bound successful reports without discovery filters.
Each nonempty report line must name a source or declaration file.
Paths outside the repository do not count as checked project files.

Verification writes new observations in `types` in its JSON results and in the Markdown compiler information section.
`types.compilerCoverage` names changed code files absent from complete programs and bound file lists.
Its state and the informational `types.typeCheck.state` stay UNKNOWN when any changed code file is unchecked.
A clean diagnostics report does not remove this discovery gap.
Discovery does not establish that the compiler found no errors.

The accepted `static-baseline-v0` checks, ratings, and readiness stay unchanged.
These observations introduce no new `evidence-v1` check.
The legacy type obligation can therefore differ from the informational compiler discovery state.

## Documentation examples

Typed collection also checks fenced TypeScript documentation blocks.
Read [checked examples](contracts.md#checked-examples) for virtual modules, diagnostic fields, skips and comparison limits.
