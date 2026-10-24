# Contributing to code-map

Thank you for your interest in code-map. This guide tells you how to report a problem, suggest a change, and send a pull request.

All contributors must follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

You can help in these ways:

- Report a bug
- Suggest a feature or an improvement
- Improve the documentation
- Fix a bug or add a feature in the code

## Report a bug or suggest a feature

1. Search the existing issues first. Somebody can have reported the same problem.
2. Open a new issue and select the bug report or the feature request template.
3. For a bug, give the code-map version (the commit), your Node.js version, your operating system, and the steps that show the problem.

Warning: Do not report a security vulnerability in a public issue. Follow the instructions in [SECURITY.md](SECURITY.md).

## Set up your development copy

You need these tools:

| Tool | Why |
| --- | --- |
| Node.js 20 or newer | code-map is a Node.js program. |
| Git | code-map reads Git history, and the tests use Git. |
| Google Chrome (optional) | The viewer tests open the generated page in headless Chrome. Without Chrome, these tests are skipped. |
| Claude Code (optional) | Only `code-map serve` and its chat use Claude Code. |

Do these steps:

1. Fork the repository on GitHub and clone your fork.
2. Go into the folder: `cd code-map`.
3. Install the one dependency: `npm install`.
4. Run the tests: `npm test`. All tests must pass or show as skipped.
5. If Chrome is not in the default macOS location, set `CODE_MAP_CHROME` to the Chrome executable before you run the tests.
6. Try your copy on a project. Go into any Git repository and run `node path/to/code-map/bin/code-map.mjs`.

The README section "What's inside this folder" explains what each file in `bin/` and `lib/` does.

## Make a change

1. Create a branch from `main` for your change.
2. Keep each pull request to one topic. Small pull requests get a faster review.
3. For a bug fix, add a test in `test/` that fails without your fix.
4. Run `npm test` before you push.
5. If your change affects users, update `README.md` and add a line under `Unreleased` in `CHANGELOG.md`.

### Project rules

The project has these rules:

- The code uses plain JavaScript ES modules (`.mjs`). There is no build step.
- Node.js built-in modules use the `node:` prefix, for example `node:fs`.
- `typescript` is the only runtime dependency. Open an issue before you add a dependency.
- The generated page (`lib/viewer.html`) is one self-contained file. It must work offline and must not load scripts, styles, or fonts from the network.
- Git access is read-only. code-map must not write to the repository that it maps, except the output page, the descriptions file, the triage file that `code-map triage` writes, and the files that `code-map init` creates or changes.
- The chat server listens on `127.0.0.1` only and checks the `Host` and `Origin` headers. It starts Claude Code with read-only tools, without MCP servers, and without the mapped repository's settings. Do not weaken these limits. Refer to [SECURITY.md](SECURITY.md).

Match the style of the code near your change: two-space indentation, single quotes, and semicolons. Write a comment when it explains why the code does something.

## Send a pull request

1. Push your branch to your fork.
2. Open a pull request against `main`.
3. Fill in the pull request template. Say what the change does and why.
4. Link the issue that the pull request fixes, if there is one.
5. Reply to the review comments. A maintainer merges the pull request after approval.

## License of contributions

code-map is licensed under the [Apache License, Version 2.0](LICENSE). Under section 5 of that license, you submit your contribution under the same license, unless you state otherwise in writing. You keep the copyright on your contribution.
