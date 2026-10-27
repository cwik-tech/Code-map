# Security policy

## Supported versions

code-map has no numbered releases yet. The maintainers fix security problems only on the `main` branch.

## Report a vulnerability

Warning: Do not report a security vulnerability in a public issue, a pull request, or a discussion. A public report gives attackers time before a fix is available.

1. Open the **Security** tab of this repository on GitHub.
2. Click **Report a vulnerability**. GitHub opens a private form that only the maintainers can read.
3. Describe the problem. Give the steps to reproduce it, the affected commit, and the effect that you saw.
4. Wait for a reply. The maintainers aim to acknowledge a report within 7 days.

The maintainers keep you informed while they fix the problem. When the fix is public, the security advisory gives credit to you, unless you ask to stay anonymous.

## Security model

code-map runs on your own computer. The list below tells you what code-map does with your code, so that you can decide what to report.

- **The generated page contains source code.** The HTML file includes the full source of each mapped file. When you share the page, you share that code.
- **The page is self-contained.** It loads nothing from the network. Its only request goes to the local chat server, and only when `code-map serve` delivered the page.
- **`code-map serve` is local.** The server listens on `127.0.0.1` only. It answers only requests addressed to `127.0.0.1` or `localhost` on its own port, which blocks DNS rebinding. Each chat request must carry a random token from the served page. The server makes a new token each time that it starts. The token stops other websites from using the chat. It does not stop other programs on your computer, because they can also open the served page.
- **The chat is read-only.** The server starts Claude Code with only the `Read`, `Grep`, and `Glob` tools. Claude Code loads only your own user settings. It ignores the Claude Code settings, hooks, and MCP servers of the mapped repository, and it starts no MCP servers. Your own user-level hooks still run.
- **The file tools are not locked to the repository.** `Read`, `Grep`, and `Glob` can open any file that your user account can open. The instructions tell Claude Code to stay in the repository. The chat has no tool that sends data to the network.
- **The chat sends code to Anthropic.** Your questions, the selected code, and the files that Claude Code reads go to Anthropic through your own Claude Code login.
- **Stored analyses go to a private folder outside the repository.** `code-map inspect --summary` saves each analysis in the analysis store: `--store <folder>`, `CODE_MAP_STORE`, `XDG_CACHE_HOME/code-map` or `~/.cache/code-map`. A stored analysis holds file paths, exported and imported names, import lines, test names and Git commit subjects. It holds no source text. code-map makes the store folders private to you (mode 0700) and the files readable only by you (mode 0600). It refuses a store inside the mapped repository, a store root that another user owns (a system folder with the sticky bit, such as `/tmp`, is allowed), a store root that other users can change without the sticky bit, and an analyses folder or a stored file that is a symlink, that another user owns, or that other users can change. It reads a stored file through one open file that does not follow a symlink, so the file cannot change between the check and the read. A report that `--out` writes from a stored analysis is private to you, and code-map writes it through a new temporary file and a rename, so it never writes through a symlink at the target. A stored analysis is input like any other file: code-map checks the values that it reads back before it gives them to Git or to the file system.
- **The file cache is a private folder in the store.** `inspect --summary` and `verify` store per-file facts under `files`, unless you add `--no-cache`. Entries include source comments above imports and declarations. New folders use mode 0700. New entries use mode 0600 and atomic writes. Code-map refuses symlinks, foreign owners and folders or files writable by other users. An unsafe cache folder disables reuse. A cache folder inside the repository or its Git folders causes an error. Entries use bounded reads, integrity hashes and shape checks. A changed payload becomes a miss. The hash does not authenticate data against a writer with access to the private store. Non-file entries cannot block the read. The cache keeps at most 200,000 entries and 200 MiB, removing old entries after writing new ones.
- **Verification runs go to private folders outside the repository.** `code-map verify` writes its run folders into the store or into `--out-dir`. It refuses a folder inside the repository or its Git folders, and a folder that another user owns or can change. It reads the request and the test reports as untrusted input, with size limits, and only report files inside the repository. It runs no project code. `code-map manifest` only records the command words that you give it. A stored run of `code-map run` is input too: `verify` checks its record, its repository and the digest of its artifact.
- **Model review runs your own program.** `code-map review --model-command` starts the program you select with your permissions and environment. This program runs outside the restricted worker. It can read secrets, use the network and change your files. Select only a trusted program. Code-map bounds combined output to 256 KiB and defaults to a 60-second time limit. Detached descendants can escape process-group termination. Review validates hypotheses before saving a separate artifact. It does not apply model claims to verification results. Read [model review](docs/model-review.md) for limits and output rules.
- **Project code runs only in the restricted worker, and only when you allow it.** `code-map run` is the only command that runs project code. It runs only the exact command words of an authorization that you made with `code-map authorize`, in the same repository, before the expiry time and within the maximum budgets. It never gives the words to a shell. It runs the command only through a sandbox: `/usr/bin/sandbox-exec` on macOS or bubblewrap on Linux, each at a fixed path, owned by root and not writable by others. Without a sandbox, or when the sandbox cannot start, it refuses the run. It never falls back to your normal environment.
- **The trust boundary of a run is the sandbox.** The run is untrusted. It works on a copy of the snapshot in a private workspace in the store. It has no network, no Unix socket and, on macOS, no system service. It can write only in its workspace. It cannot read the protected folders. On macOS, these are `/Users`, `/Volumes`, `/private/var/folders`, `/private/tmp`, `/Library/Keychains`, your home folder, your temporary folder, the repository and the store. The exceptions are the workspace, the Node.js folder, a read-only link to `node_modules` and an explicitly authorized read-only npm cache. Your credential folders stay closed, also inside such an exception. Linux refuses a bind source that contains a protected path. Its environment has only `PATH`, `HOME`, `TMPDIR`, `CI` and the locale. Code-map enforces the wall-clock, output, memory and concurrency budgets from outside the sandbox. The memory budget is a sampled limit. On macOS, Seatbelt does not stop a run from reading the command lines and the environments of your other processes. Thus, do not keep a secret in the environment of a process while a run runs. Refer to [run tests in the restricted worker](docs/run.md) for what the worker does not isolate, for example a kernel bug.
- **What a run leaves.** Code-map copies the artifact inside the sandbox through a bounded pipe. The host reads artifact contents only through the collector. The collector refuses symlinks, including folder symlinks and a symlink at the snapshot root. A surviving run process cannot use a path race to bypass the sandbox read policy. It removes the workspace after the run. Authorizations, run records, artifacts and manifests are private files (0600) in private folders (0700), and Code-map reads each one back through one open file that does not follow a symlink.
- **The triage file is untrusted input.** `code-map triage` writes only `.code-map-triage.json` at the repository root, through a new temporary file and a rename. `code-map inspect` reads that file with a size limit and validates each field. It refuses a file that is not valid or that is not a regular file, for example a symlink.
- **Git is read, not changed.** Git commands that compare with the working tree run on a private copy of the index, without hooks, so `.git/index` stays as it is. Two cases are outside code-map's control. In a partial clone, Git can fetch a missing object into `.git/objects` when code-map reads an old commit. A Git filter driver (for example Git LFS) runs its own program when Git checks a file that has one.
- **Snapshots go to a private folder.** For every commit-based map, including HEAD, code-map extracts that commit into the `code-map-chat` folder in your system temporary folder. The chat therefore reads the mapped commit despite uncommitted or later edits. With `--worktree`, it reads the live working tree. code-map makes the snapshot folder private to you (mode 0700). It refuses the folder if it is a symlink, if another user owns it, or if other users can open it. code-map never deletes a folder that other users could change. code-map does not change your repository.

## In scope

These problems are examples of vulnerabilities:

- A way for another website or another computer to use the chat server
- A way to bypass the chat token
- Script injection in the generated page from file names, file contents, commit messages, or descriptions in a mapped repository
- A way for the chat to write files, run commands, or access the network
- A way for code-map to write outside its output page, its descriptions file, its triage file, its temporary folder, its analysis store, or the files that `code-map init` creates or changes
- A way for a planted or damaged file in the analysis store to make code-map run a Git command or open a path that the user did not ask for
- A way for a command in `code-map run` to reach the network, read a protected folder or a credential, write outside its workspace, see a variable of your environment, or outlive its budgets on Linux
- A way to make `code-map run` run a command without a matching authorization, or without a sandbox
- A way for a run to change the repository, or to make Code-map copy a file from outside the workspace as its artifact
- A way for another user to read, plant or change an entry of the file cache, or for a damaged entry to change an analysis

## Out of scope

These problems are not vulnerabilities in code-map:

- A problem in Claude Code itself. Report it to Anthropic.
- An attack that needs an attacker who already controls your user account
- A command in `code-map run` that uses its whole budget, for example all processor time until the wall-clock budget ends
- A bug in the kernel, in Seatbelt or in bubblewrap. Report it to the vendor
- On macOS, a process of a run that leaves its process group between two samples and lives after the run. It keeps the sandbox
- Another program on the same computer that opens the served page and uses its token
- Source code that is visible in a generated page that you shared yourself

## Manifest authentication

Code-map signs isolated artifact manifests with an Ed25519 key in the store's `keys/run-ed25519.pem` file.
The key has mode 0600. Code-map refuses unsafe permissions, another owner, symlinks and non-file entries.
Only the host signs manifests. The worker cannot read the key or write its signed manifest.
A signature proves that this machine's Code-map wrote the manifest, provided the key stayed secure.
It does not prove that the machine was uncompromised. Another process under your account can steal the key.
A signature does not validate test expectations or grant sandbox provenance to an imported report pair.

`code-map key` prints the public key and fingerprint. Never publish the private key.
Configure trusted CI public keys through `trustedRunKeys` in `.code-map.json`.
Verification excludes reports with invalid signatures or unknown signers. Unsigned reports show `absent` and retain compatibility.
Unsigned compatibility cannot detect a stripped signature. Review signature states before relying on machine authentication.
Read [manifest signatures](docs/run.md#manifest-signatures-and-environment) for formats, rotation and environment records.

The optional disk budget samples allocated workspace size through host filesystem metadata. It cannot prevent disk exhaustion between samples.
Process records include observed descendants and survivors after cleanup. Unsampled macOS escapes remain a platform limit.

Offline revision installs run inside the same sandbox and share its budgets. Network access stays denied.
The cache cannot overlap the repository or store. Credential folders stay closed, also when explicitly named.
Lifecycle scripts never run. Packages that need install scripts can remain unusable.


## Evidence trust tiers

[Tool trust minimums](docs/verify.md#tool-trust-minimums) defines the five ordered tiers and configuration format.
The order is `static`, `self-attested`, `isolated`, `isolated-signed`, then `trusted-signed`.
Code-map derives tiers from the report source and verified signatures. It never trusts a manifest's isolation claim.
Only a private stored worker run establishes local isolation. Imported local signatures alone remain self-attested.
A key in `trustedRunKeys` can authenticate imported evidence as trusted-signed.
That tier delegates signer trust. It does not prove sandbox execution or correct expectations.
Unknown or invalid signatures remain ineligible. A higher tier cannot repair stale or malformed evidence.

Repository `trust` and authorization `--trust` set per-tool evidence minimums. The stricter minimum wins.
Every adapter receives the same eligibility decision before it reads report contents.
A tool key matches the exact first command word, including an absolute path when present.
Policies do not inspect scripts, shell wrappers, child commands or command aliases.
Only a person creates an authorization. Every worker command still requires isolation, regardless of its evidence minimum.

Authorization policies live in private authorization files and private run records. These records share the store's existing trust boundary.
A process with control of the user account can alter unsigned records or remove policies and signatures.
An unsigned imported manifest cannot meet a configured signed minimum.
Keep repository policies and trusted public keys under independent review.
