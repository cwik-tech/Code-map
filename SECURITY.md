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
- **`code-map serve` is local.** The server listens on `127.0.0.1` only. Each chat request must carry a random token from the served page. The server makes a new token each time that it starts. The token stops other websites from using the chat. It does not stop other programs on your computer, because they can also open the served page.
- **The chat is read-only.** The server starts Claude Code with the `Read`, `Grep`, and `Glob` tools only. It blocks `Bash`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, and `WebSearch`.
- **The chat sends code to Anthropic.** Your questions, the selected code, and the files that Claude Code reads go to Anthropic through your own Claude Code login.
- **Snapshots go to a temporary folder.** When the map shows a commit that is not checked out, code-map extracts that commit into your system temporary folder. It does not change your repository.

## In scope

These problems are examples of vulnerabilities:

- A way for another website or another computer to use the chat server
- A way to bypass the chat token
- Script injection in the generated page from file names, file contents, commit messages, or descriptions in a mapped repository
- A way for the chat to write files, run commands, or access the network
- A way for code-map to write outside its output page, its descriptions file, its temporary folder, or the files that `code-map init` creates or changes

## Out of scope

These problems are not vulnerabilities in code-map:

- A problem in Claude Code itself. Report it to Anthropic.
- An attack that needs an attacker who already controls your user account
- Another program on the same computer that opens the served page and uses its token
- Source code that is visible in a generated page that you shared yourself
