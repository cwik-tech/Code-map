# Run tests in the restricted worker

`code-map run` runs one command of your project, for example `node --test`, in the restricted worker. The worker is a process that a sandbox isolates from your computer. Code-map keeps a record of the run, its output and, on request, a test report with its run manifest. `code-map verify` can then use that report.

Code-map never runs project code unless you allow it. Each command needs an authorization that you make before the run. Code-map never runs a command without a sandbox. When it finds no sandbox, it refuses the run and says why.

## Terms

| Term | Meaning |
| --- | --- |
| Restricted worker | The isolated process that runs the command. In this page, "the run" is that process and every process that it starts |
| Backend | The program that makes the sandbox: `/usr/bin/sandbox-exec` with a Seatbelt profile on macOS, or bubblewrap (`bwrap`) on Linux |
| Workspace | A new private folder in the store for one run. It holds a copy of the snapshot, the home folder of the run and its temporary folder. Code-map removes it after the run |
| Snapshot | The files of the run: the files of a commit, or the files of the working tree |
| Protected folder | A folder that the run cannot read. Your home folder is a protected folder |
| Authorization | A record in the store that allows exact command words in one repository, with maximum budgets and an expiry time |
| Budget | A limit of one run: wall-clock time, memory, disk space, output, and the number of runs at one time |
| Run folder | The private folder `runs/<run ID>` in the store. It keeps the record, the output, the report and the manifest |
| Isolated report | A test report that `code-map run` kept. Code-map wrote its run manifest, so the manifest has the policy `isolated` |

## What the worker isolates

| Area | Policy |
| --- | --- |
| Network | No network. A TCP connection, also to `127.0.0.1`, fails. DNS fails. A Unix socket fails too: `node --test`, `npm test`, worker threads and the child processes of Node.js do not need one |
| Writes | Only inside the workspace. On macOS, the run can also write to `/dev/null`, `/dev/zero`, `/dev/stdout` and `/dev/stderr`. On Linux, `/tmp` is the temporary folder of the workspace. The run cannot change file flags or access control lists |
| Reads | No read of a protected folder. The exceptions are the workspace, the Node.js folder, the read-only link to `node_modules` and an explicitly authorized npm cache. The credential folders stay closed, also inside an exception: `~/.ssh`, `~/.aws`, `~/.azure`, `~/.config`, `~/.docker`, `~/.gnupg`, `~/.kube`, `~/.netrc`, `~/.npmrc`, `~/.pypirc`, `~/.git-credentials`, `~/.yarnrc`, `~/.yarnrc.yml` and `~/Library/Keychains` |
| Protected folders on macOS | `/Users`, `/Volumes`, `/private/var/folders`, `/private/tmp`, `/Library/Keychains`, your home folder, your temporary folder, the repository and the store. The run can read the system folders, for example `/usr`, `/System`, `/Library` and `/opt` |
| Protected folders on Linux | bubblewrap gives the run a new root. It has only `/usr`, `/bin`, `/sbin`, `/lib`, some files of `/etc`, the Node.js folder, the workspace and the read-only link. Nothing else of your computer is there |
| Environment | Only `PATH` (the folder of Node.js, then `/usr/bin`, `/bin`, `/usr/sbin` and `/sbin`), `HOME` and `TMPDIR` in the workspace, `CI=1`, and the locale (`LANG`, `LC_ALL` and `LC_CTYPE`, or `LANG=C`). No other variable of your environment, so no token, no key and no `NODE_OPTIONS` |
| Processes | The run can signal and inspect only its own processes. On macOS it can use no system service, and it can read only a list of kernel values. But it can read the command lines and the environments of your other processes. Refer to the next section. On Linux it has its own process IDs, and it cannot see your other processes |
| Repository | The run works on a copy. Code-map reads the repository with read-only Git commands. The run cannot read the repository, and it cannot change it |

The snapshot copy holds these files:

- For a commit (`--head <ref>`, the default is `HEAD`): the files of that commit as Git stores them. No Git filter, `export-ignore` or `export-subst` applies, and no program of the repository runs. A submodule is not copied.
- For the working tree (`--worktree`): the tracked files and the untracked files that Git does not ignore. A deleted file, a submodule and a nested repository are not copied. If the working tree changes during the copy, Code-map refuses the run.
- Without `--install offline`: `node_modules` of the working folder, also for a commit. On macOS with APFS, it is a copy-on-write clone (`cp -c`), so the run can change its copy. Otherwise it is a read-only link, and the record says `read-only-link`. A symlinked `node_modules` always uses its real directory through a read-only link. Code-map checks that directory against the credential policy. Cloned folders have mode 0700. Cloned files have mode 0600, or 0700 when executable. If the snapshot has its own `node_modules`, the record says `snapshot`.

Verification discloses shared dependencies or revision-specific offline preparation for each side. Network access remains denied.

## Prepare revision dependencies offline

The user can authorize `--install offline --npm-cache <folder>` before `--command`.
Give the same options to `run`, or to `verify` with enabled execution.
Without these options, the existing working-folder dependency policy applies.
An authorization with no install policy cannot authorize an install.
An offline authorization requires the same canonical cache path on every run.

The worker first runs this command in the revision workspace:

```sh
npm ci --offline --ignore-scripts --cache <folder> --no-audit --no-fund
```

It uses npm beside the running Node.js binary. It never links the working folder's `node_modules` for this policy.
Each revision needs an npm lockfile and every required package in the cache.
The recorded install lockfile follows npm precedence: `npm-shrinkwrap.json`, then `package-lock.json`.
Code-map reads that digest inside the sandbox before installation.
The lockfile must be a regular file of at most 50 MiB. Symlink lockfiles are refused.
Populate the cache separately. Code-map never downloads packages or changes that cache.
The install and authorized command share the run's time, output, memory, disk and concurrency limits.
A failed install prevents the command and artifact collection. The run keeps npm output and reports no prepared dependencies.

The named cache grants read-only access, also inside a protected folder.
Relative cache paths resolve from the repository. The cache must exist and cannot overlap the repository or store.
Credential folders stay closed. Do not name a cache folder that contains secrets.
Other protected folders remain closed. The same sandbox denies network access throughout both phases.

Lifecycle scripts never run because npm receives `--ignore-scripts`.
Packages that need generated files or native builds from install scripts can remain unusable.
This policy supports npm installations only. It does not reconstruct an old runtime or operating system.

## What the worker does not isolate

- A bug in the kernel or in the backend. The sandbox depends on them.
- On macOS, the command lines and the environments of your other processes. Seatbelt does not close the kernel interface that gives them (`kern.procargs2`). Thus a run can read a token that another process of your user has in its environment or in its command line. Do not keep a secret in the environment of a process while a run runs. On Linux, the run cannot see your other processes.
- The number of processes and disk usage between samples. A run can fill its workspace before a sampled budget stops it.
- Work inside the budgets. For example, the run can use all processor time until the wall-clock budget stops it.
- Reads outside the protected folders on macOS: the system folders stay readable. Put secrets in your home folder, not in `/opt` or `/Library`.
- Untracked files that Git does not ignore. A `--worktree` run copies them, for example an `.env` file that Git does not ignore.
- On macOS, a process that leaves the process group and its parent between two samples of the process table. It keeps the sandbox, so it has no network and no access to the protected folders. But it can live after the run. On Linux, bubblewrap stops all processes of the run.
- If Code-map itself gets SIGKILL, it cannot stop the run on macOS. A run that Code-map stops with SIGINT, SIGTERM or SIGHUP stops, and its record says `interrupted`.
- `sandbox-exec` is deprecated on macOS, but it still works. If a later macOS removes it, Code-map finds no backend and refuses each run.

These limits also apply:

- `os.userInfo()` of Node.js fails inside the worker, because the run can use no system service on macOS. `os.networkInterfaces()` fails too, because the run cannot read the network interfaces.
- A command that downloads packages fails, for example `npx` without a local package. The run has no network.
- Code-map accepts top-level Node.js JUnit cases directly under the root `<testsuites>`. These cases have no suite. Cases in `describe()` blocks retain their suite.

## Before you start

- On macOS, Code-map uses `/usr/bin/sandbox-exec`. It must be a file that root owns and that no other user can change.
- On Linux, install bubblewrap. Code-map uses `/usr/bin/bwrap` or `/bin/bwrap`, with the same conditions. Your system must allow user namespaces for normal users.
- On another system, Code-map has no backend, and it refuses each run.

Before each run, Code-map starts `true` in the sandbox with the same policy. If the backend cannot start it, Code-map refuses the run and gives the message of the backend.

## Authorize a command

Only you make an authorization. An AI agent must not make one for itself.

1. Go to the repository.
2. Run `code-map authorize`. Give the exact command words after `--command`. `--command` must be the last option:

   ```sh
   code-map authorize --expires-days 3 --wall-clock-seconds 300 --command node --test --test-reporter=junit --test-reporter-destination=junit.xml
   ```

3. Keep the `authorizationId` from the JSON summary, for example `AUTH-0123456789abcdef`.

| Option | What it does |
| --- | --- |
| `--command <words...>` | The exact command words. Each word after `--command` is one command word, also a word that starts with `-`. A first `--` after `--command` is dropped. The first word must name a program |
| `--trust <JSON>` | Optional per-tool evidence minimums, for example `'{"npm":"isolated","tsc":"self-attested"}'`. See [tool trust minimums](verify.md#tool-trust-minimums) |
| `--expires-days <n>` | The authorization expires after `n` days. The default is 7, and the maximum is 90 |
| `--wall-clock-seconds <n>` | The maximum wall-clock time of a run. The default is 600 |
| `--memory-megabytes <n>` | The maximum memory of a run. The default is 2048 |
| `--disk-megabytes <n>` | An optional sampled workspace disk limit in MiB. No disk limit applies by default. The maximum is 1,048,576 |
| `--output-megabytes <n>` | The maximum output of a run, standard output and standard error together. The default is 64 |
| `--concurrency <n>` | The maximum number of runs at one time. The default is 1 |
| `--store <folder>` | The store. The default is the same as for `code-map inspect --summary` |

The budgets are whole numbers from 1 up to 86,400 seconds, 65,536 MB of memory, 1,024 MB of output and 64 runs.

The authorization is the file `authorizations/<ID>.json` in the store. It holds the SHA-256 digest of the real path of the repository, the command words, the maximum budgets, the creation time and the expiry time. To withdraw an authorization, delete its file.

## Run the command

```sh
code-map run --authorization AUTH-0123456789abcdef --head HEAD --kind junit --artifact junit.xml -- node --test --test-reporter=junit --test-reporter-destination=junit.xml
```

The words after `--` must be the same words, in the same order, as in the authorization. Code-map refuses the run in these cases:

- The authorization ID is unknown.
- The authorization expired.
- The authorization is for another repository or for other command words.
- A budget is above its maximum.

| Option | What it does |
| --- | --- |
| `--authorization <id>` | The authorization ID. It is necessary |
| `--head <ref>` | Run the files of this commit, branch or tag. The default is `HEAD` |
| `--worktree` | Run the files of the working tree. Use either `--head` or `--worktree` |
| `--kind <kind>`, `--artifact <path>` | Keep a report kind that `code-map manifest` supports, including `playwright-list` and `mocha-list` discovery reports. The artifact path is relative to the snapshot. Give both options or neither |
| `--discovery <text>`, `--filter <text>` | Which tests the command selected, for the run manifest, as with `code-map manifest` |
| `--wall-clock-seconds`, `--memory-megabytes`, `--output-megabytes`, `--concurrency`, `--disk-megabytes` | Smaller budgets for this run. The default is the maximum of the authorization |
| `--store <folder>` | The store of the authorization |
| `--compact` | Write the summary without indentation |

The summary on standard output has `reportType: "code-map-run-summary"` and the run ID. It also gives the policy `isolated`, the backend, and the exit status and the signal of the command. Then it gives the budget that stopped the run (`stoppedBy`), the problems, and the paths of the files in the run folder.

| Exit code | Meaning |
| --- | --- |
| 0 | The command ended by itself, and Code-map kept each requested file. The exit status of the command is in the summary: a failed test does not change the exit code of `code-map run` |
| 1 | Code-map refused the run, a budget stopped it, Code-map was interrupted, or the artifact was not kept. A refused run prints nothing on standard output and leaves no run folder |

## The budgets

| Budget | How Code-map enforces it |
| --- | --- |
| `wallClockSeconds` | At the end of the time, Code-map sends SIGTERM to the process group and to each process of the run. After 2 seconds, it sends SIGKILL |
| `outputMegabytes` | Code-map keeps at most this much of standard output and standard error together. Then it stops the run |
| `memoryMegabytes` | Code-map reads the resident memory of each process of the run with `ps` every 250 milliseconds. When the sum is over the budget, it stops the run. This is a sampled limit: a short peak between two samples is not seen |
| `diskMegabytes` | Code-map samples allocated workspace size with `du -sk` every 250 milliseconds. It stops the run above the budget. Read-only dependency links are excluded. Sampling errors fail the run |
| `concurrency` | Each active run has a slot file in `slots/` of the store. When other runs hold the budget of slots, Code-map refuses the run |

When the command ends, Code-map kills its process group and the descendants that it observed. It checks for survivors before collection. A failed process check or a known survivor refuses collection. The run record lists observed process IDs and survivors after cleanup. A known survivor fails the record. The unsampled macOS escape limit still applies. A run that a budget stopped keeps no artifact and no manifest.

## Artifact collection

Code-map starts a fixed Node.js collector inside the same sandbox policy.
The collector sends the artifact through a pipe with a byte limit and a 30-second timeout.
The host reads artifact contents only through this collector.
The optional disk sampler reads filesystem metadata through `du` on the host.
The collector refuses symlinks at the snapshot root and in each artifact path component.
It opens the final file with `O_NOFOLLOW` and refuses non-regular files.
A path race cannot give the collector more access than the sandbox permits.

On Linux, Code-map refuses a bind source that contains a protected path.
This check includes system folders, the Node.js folder and dependency link sources.
Choose a narrower dependency or Node.js folder when this refusal occurs.

## Use the run in verify

Add the run ID to `reportInputs` of the request:

```json
"reportInputs": [{ "run": "R-20261022T101010Z-0123abcd" }]
```

Run `code-map verify` with the same store (`--store`). The result of the report shows `"attestation": "isolated"`. In the rule set `static-baseline-v0`, an isolated report counts the same as a self-attested report. A run of another repository does not count. A run whose artifact no longer has the digest in its record does not count. Refer to [verify a change](verify.md).

## What the run folder holds

| File | Content |
| --- | --- |
| `run.json` | The run record. Refer to the table below |
| `stdout.log`, `stderr.log` | The output that the output budget kept |
| `report.xml`, `report.json`, `coverage.lcov` or `coverage.json` | The artifact, when you gave `--kind` and `--artifact` and the run ended by itself |
| `manifest.json` | The run manifest of the artifact. It has the fields of `code-map manifest`, with `environment.policy: "isolated"` and `environment.backend` |

| Field of `run.json` | Meaning |
| --- | --- |
| `runId`, `authorizationId` | The run and the authorization that allowed it |
| `repository.digest` | The SHA-256 digest of the real path of the repository |
| `source` | The selector (`worktree` and `ref`), the commit, and the digest of the working tree or `null` |
| `command` | The command words |
| `policy`, `network` | `isolated` and `denied` |
| `backend` | The name (`seatbelt` or `bwrap`) and the program of the backend |
| `workspace` | The path of the snapshot copy, how the run got `node_modules`, and whether Code-map removed the workspace |
| `dependencies` | Revision SHA, actual install lockfile digest, module mode, preparation flag and install result. Default runs do not establish revision preparation |
| `budgets` | The budgets of the run |
| `startedAt`, `finishedAt`, `durationMs` | The times of the run |
| `exitStatus`, `signal` | The final phase exit status or signal. A failed install supplies this status when the command never starts |
| `stoppedBy` | `wallClockSeconds`, `outputMegabytes`, `memoryMegabytes`, `diskMegabytes`, `interrupted`, or `null` |
| `output` | The bytes of standard output and standard error, the bytes that Code-map kept, and whether it cut the output |
| `memory` | The highest sampled memory in MB (rounded up), the number of samples, `limit: "sampled"` and the sample interval |
| `disk` | Peak allocated workspace MiB, sample count, sample interval and `limit: "sampled"` |
| `processes` | `started`: root and observed descendant host process IDs. `remaining`: live host process IDs after cleanup |
| `artifact` | The path, the kind, the SHA-256 digest and the file of the artifact, or `null` |
| `problems` | Why the run did not keep a file, or which budget stopped it |

All folders of the store are private to you (mode 0700), and all files are readable only by you (mode 0600).

`verify` can start these worker runs directly with an existing authorization. Refer to [authorized execution](verify.md#authorized-execution).

The [evidence-v1 rule set](verify-evidence-v1.md) requires isolated test reports before it gives READY.

## Manifest signatures and environment

`run`, `harness` and `mutate` sign each artifact manifest with Ed25519 through Node.js crypto.
Code-map creates one key per machine store on first use.
The private key is `keys/run-ed25519.pem` in that store, with mode 0600.
Code-map refuses a key with another owner, unsafe permissions or a symlink.
Concurrent first uses select one key without replacing it.

Run `code-map key --store <folder>` to print the public PEM key and its SHA-256 fingerprint.
This command also works outside a Git repository. Never share the private key.
The fingerprint hashes the public key in DER SPKI format.
Signatures cover canonical JSON values, including artifact digests. Object key order and indentation do not affect signatures.
A signature proves that this machine's Code-map wrote the manifest, provided its private key stayed secure.
It does not prove that the machine was uncompromised or that test expectations were correct.

To trust another machine, put its public PEM key in the `trustedRunKeys` list in `.code-map.json`.
The list accepts at most 64 Ed25519 public PEM keys.
For example, copy the `publicKey` value printed by your CI runner's `code-map key` command.
Trust configuration changes the configuration digest. Generate new manifests after changing that configuration.
Retain an old public key in this list before replacing its private key to keep old signatures verifiable.
Mutation cache reuse checks the local store key and refuses a damaged or unknown signature.

Each verification execution has `signature.state`: `valid`, `invalid` or `absent`, and `signature.fingerprint`.
Unknown signers and altered signatures are invalid. Their reports do not count.
Unsigned reports remain compatible and show `absent`. Removing a signature removes authentication, without proving tampering.
Imported signed report pairs remain self-attested. A signature alone does not grant isolated status.
No new rule-set check uses these fields.

Each new isolated or self-attested manifest records `os`, `osVersion`, `architecture`, `node` and `typescript` under `environment`.
The OS version is the kernel release. Node.js and TypeScript versions describe the Code-map host.
Verification executions include these fields and compare same-kind base and head environments in `environmentComparisons`.
Comparisons report missing fields as `UNKNOWN` and list differences only for fields that both runs recorded.
Environment comparisons use `exact-environment-v1`. Missing required fields give UNKNOWN.
Different recorded values give INCOMPARABLE. Each pair exposes `eligible` separately from report eligibility.
Test timing and repeatability comparisons exclude incompatible pairs.
The comparison lists differing fields as information. It does not reconstruct an old operating system or dependency installation.

## Controlled timings

`code-map bench --authorization <id> --runs <n> --warmup <n> [--head <ref>|--worktree] -- <command...>` measures an authorized command.
Use the same authorization process as `run`. Both repeat options are required.
`--runs` accepts 1 to 100 measurements. `--warmup` accepts 0 to 100 excluded warmups.
The default snapshot is HEAD. `--store` and the worker budget options also apply.

Bench uses one workspace and one concurrency slot for all commands.
Commands run sequentially. Files from earlier commands remain available to later commands.
Each command must exit with zero. A failure or budget stop produces no timing artifact.
The time and output budgets cover all warmups, measurements and supervisor cleanup.
The memory and disk limits apply throughout the benchmark.

Each sample measures wall-clock milliseconds from sandbox process creation to command exit.
Samples include sandbox startup and command startup. They exclude supervisor cleanup and snapshot copying.
The report records warmup samples separately. Only measured samples contribute to the median, median absolute deviation and minimum.
The report also records CPU model, CPU count, machine identity and load averages before and after execution.
The machine identity hashes the host name. It is a comparison guard, not hardware attestation.
Bench keeps `bench.json` and a signed isolated manifest in the run folder.
Add `{ "run": "<run ID>", "side": "base" }` and the corresponding head run to verification `reportInputs`.

Refer to [timing comparisons](verify.md#controlled-timing-reports) for thresholds and comparison limits.

## Trace XState during tests

Authorize and run the same Node command with `--trace-xstate` on both commands.
The authorization includes the added `--import ./.code-map-xstate/preload.mjs` words.
A plain authorization does not cover tracing. Tracing owns the artifact slot, so omit `--kind` and `--artifact`.
The worker keeps an `xstate-trace` artifact, also when XState is absent. Absence gives UNKNOWN with a reason.
Read [observed transitions](models.md#observed-xstate-transitions) for inspection, verification and instrumentation limits.
