// Command-line help for every integrated command and option.
import { defaults } from './project.mjs';

export const help = `code-map: a zoomable map of a codebase

Usage (inside a Git repository; with npm: npm run map, npm run map serve, …):
  code-map                 build the map page (see "out" below)
  code-map serve           build it and open it with a chat about the code at http://127.0.0.1:4477
  code-map inspect         emit structural analysis as JSON (no HTML or model calls)
  code-map inspect --summary   analyze once, store the analysis, print a small overview with follow-up commands
  code-map verify --request <file.json>   check one change from a base commit to a head under a rule set: four ratings and a readiness state
  code-map review --run <run ID> --model-command <words...>
                           send context to your program and save validated hypotheses (60 seconds, 256 KiB)
  code-map verify --context <run ID>      print the compact context of a finished run for a language model (reads only)
  code-map manifest --artifact <report> --kind <kind> --exit-status <n> -- <command>
                           write the run manifest of a test, compiler, coverage, mutation, size, timing or discovery report that your own run wrote (runs nothing)
  code-map sbom [--worktree|--ref <ref>] --out <file>   export CycloneDX 1.5 JSON from the selected lockfile
  code-map sizes [--dir <folder>] --out <file>   read Next.js build sizes (runs nothing)
  code-map triage --finding <id> --state <state> --reason <text> --owner <name> [--expires <YYYY-MM-DD>]
                           record a person's decision about a finding in .code-map-triage.json (confirmed, dismissed or suppressed)
  code-map oracle --case <case ID> --criterion <id> --method <text> --confirmed-by <name>
                           record a human oracle in .code-map/oracles.json after inspect --summary --worktree
  code-map review-weakening --entry <weakening ID> --reason <text> --reviewed-by <name> [--base <ref>]
                           record a person's acceptance in .code-map/reviews.json (base defaults to HEAD)
  code-map key [--store <folder>]   print the machine public key and its SHA-256 fingerprint
  code-map authorize [options] --command <words...>
                           allow code-map run to run these exact command words in this repository (you, not an agent)
  code-map run --authorization <id> [--head <ref>|--worktree] [--kind <kind> --artifact <path>] -- <command...>
                           run the authorized command in the isolated worker: no network, closed credential folders, budgets
  code-map bench --authorization <id> --runs <n> --warmup <n> [--head <ref>|--worktree] -- <command...>
                           measure controlled command timings in one restricted workspace
  code-map mutate --authorization <id> --base <ref> [--head <ref>|--worktree] --max <n> [--seed <n>] -- <command...>
                           test changed-line mutants in fresh isolated workers
  code-map mutate --base <ref> --print-selection -- <command with {testFiles}>
                           print selected tests and expanded words without authorization or execution
  code-map harness --authorization <id> --spec <file>   run a bounded harness in the isolated worker
  code-map init            add "npm run map" and a .code-map.json to this project
  code-map todo            list files whose description is missing or stale
  code-map stamp           record the current exports of newly described files (stamp-all: all of them)
  code-map labels          list test cases whose intent labels are missing or stale (optional model pass)
  code-map labels stamp    record the test version that new labels describe (--file <test>: refresh that file; stamp-all: all)

Options:
  --runs <n>, --warmup <n>  with bench: 1 to 100 measured runs and 0 to 100 excluded warmups (both required)

  --trace-xstate          with authorize or run: include the XState Node preload and keep its trace artifact
  --spec <file>            with harness: the JSON spec inside the repository
  --dir <folder>           with sizes: build folder (default: .next)
  --ref <branch>           map this branch or commit (default: the branch whose source changed most recently)
  --types                  with inspect: bounded compiler types, checked files, calls and references
  --worktree               map the working tree, including uncommitted changes
  --out <file>             where to write the page (default: ${defaults.out})
  --descriptions <file>    descriptions file (default: ${defaults.descriptions})
  --labels <file>          test intent labels file (default: ${defaults.testLabels})
  --json                   emit JSON instead of HTML (also the default for inspect)
  --file <path>            inspect a mapped source file; repeat to select several (labels: a test file)
  --change <selection>     inspect latest, branch, or uncommitted changes
  --exclude-vendors        omit primitive/vendor paths from report file details
  --summary                with inspect: print the overview of the stored analysis (created or reused)
  --analysis <id>          with inspect: read this stored analysis instead of the code (no new collection)
  --finding <id>           with --analysis: one finding and its evidence
  --findings               with --analysis: a page of findings (--rule <rule id> to filter)
  --part <name>            with --finding or one --file: one complete evidence list, a page at a time
                           (alone: a project list: nextjs.routes, nextjs.modules, nextjs.unclassified,
                           models.boundaries, models.states, models.decisions, models.cases or models.errors)
  --offset <n>, --limit <n>  page position and size for --part, --findings, --complexity, --api, --dependencies, --schemas, --impact and --undocumented (default 0 and 20, at most 500)
  --full                   with --analysis: the whole-project report (large; write it with --out)
  --compiler-report <file> with inspect --summary --base: head tsc report, with <file>.manifest.json
  --base-compiler-report <file> optional base tsc report, with <file>.manifest.json

  --base <ref>             with review-weakening: comparison base (default HEAD). With --summary: also analyze this base commit and label findings new, existing or resolved
  --base-analysis <id>     with --analysis and --findings, --summary, --complexity, --api, --dependencies, --schemas or --impact: compare with this stored base analysis
  --baseline <label>       with --base-analysis --findings: only new, existing, resolved or unknown findings
  --complexity             with --analysis and --base-analysis: the complexity change of the functions in changed files
  --api <status>           with --analysis and --base-analysis: a page of export changes (all, removed, changed, unknown, added or renamed)
  --api-group <group>      with --api: only the public group (package entry points) or only the module group
  --impact <list>          with --analysis and --base-analysis: a page of one change-impact list (affected, tests, references, calls or docs)
  --undocumented           with --analysis: a page of the public exports (package entry points) without a JSDoc comment
  --include-hidden         with --summary or --findings: also show the findings that the triage file dismisses or suppresses
  --unlabeled              with --findings --rule <rule id>: the findings without a confirmed or dismissed label, in fingerprint order (a sample)
  --entry, --reviewed-by   with review-weakening: the weakening ID and the human reviewer
  --reason <text>         with triage or review-weakening: why the person accepts the decision
  --state, --reason, --owner, --expires   with triage: the state, why, who decided, and the end of a suppression (at most 365 days)
  --dependencies           with --analysis: the packages of the lockfile, a page at a time (with --base-analysis: the dependency change)
  --schemas                with --analysis: the Prisma, Drizzle and JSON Schema inventory, a page at a time (with --base-analysis: the schema changes)
  --store <folder>         analysis store (default: CODE_MAP_STORE, XDG_CACHE_HOME/code-map or ~/.cache/code-map)
  --no-cache               with inspect --summary or verify: parse every file again, without the file cache of the store
  --request <file>         with verify: the verification request (JSON)
  --out-dir <folder>       with verify: where the run folders and latest.json go, outside the repository (default: a folder for this repository in the store's verifications folder)
  --run <run ID>           with review: the finished run to review. With inspect --summary: a stored XState trace run
  --model-command <words...> with review: user program and arguments, last on the command line
  --context <run ID>       with verify: the run whose context to print (at most 256 KiB of JSON), from the same --out-dir or --store
  --authorization <id>     with run, mutate or harness: the ID that code-map authorize printed
  --head <ref>             with run, mutate or harness: the commit to run (default: HEAD). --worktree runs the working tree
  --install offline --npm-cache <folder>  authorize, run or enabled verify: prepare revision dependencies without scripts or network

  --trust <JSON>           with authorize: per-tool evidence minimums, for example {"npm":"isolated"}
  --expires-days <n>       with authorize: the authorization expires after n days (default: 7, at most 90)
  --disk-megabytes <n>      optional sampled workspace disk limit in MiB, with authorize or run
  --wall-clock-seconds, --memory-megabytes, --output-megabytes, --concurrency <n>
                           with authorize: the maximum budgets (default: 600, 2048, 64, 1). With run or mutate: smaller budgets. Review: time default 60, maximum 600 seconds
  --max <n>, --seed <n>    with mutate: sample limit (default 20, at most 1000) and integer seed (default 0)
  --compact                write JSON without indentation
  --port <number>          port for serve (default: 4477)
`;
