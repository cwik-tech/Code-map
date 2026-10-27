# Model review of a finished run

`code-map review` sends a finished verification context to a user-selected program on standard input.
The program must write only a hypotheses JSON object on standard output.
The schema is in [the verification reference](verify.md#hypotheses-of-a-language-model).
The command uses the same context as `code-map verify --context`.

```sh
code-map review --run V-20261022T180000Z-1a2b3c4d --out-dir /tmp/verify --model-command node model.mjs
```

Replace the run ID and program with your own values.
Put all Code-map options before `--model-command`. Every later word belongs to the program.
Program flags pass through without shell expansion. Code-map does not start a shell.
A CLI that wraps its response must unwrap it before it writes the hypotheses object.
For example, a JSON transport envelope from a model CLI is not a hypotheses object.

## Trust and limits

The program runs as your own program, with your permissions, environment and current repository as its working folder.
It does not run as project code in the restricted worker. Select only a program that you trust.
The program can read files, access the network, spend provider credits and change files with your permissions.
Code-map supplies context on standard input. It does not interpret model output as commands.

The default time limit is 60 seconds. `--wall-clock-seconds <n>` accepts 1 to 600 seconds.
The combined standard output and standard error limit is 256 KiB.
Code-map stops an over-budget process group on POSIX. Windows stops the direct process only.
A program that starts a detached process can escape process-group termination.

## Saved output

Code-map validates JSON with `lib/hypotheses.mjs` before it saves `runs/<run ID>/review-hypotheses.json`.
The file contains the validated hypotheses schema. A successful later review atomically replaces this file.
Invalid JSON, an invalid schema, nonzero command exit, timeout or excess output leaves the previous file unchanged.
Command failure exits with 1. Successful review exits with 0.

The summary names the file and counts grounded and ungrounded hypotheses.
Grounding checks stored evidence IDs. Capped stored lists can omit valid path or case IDs.
Grounding does not establish that the evidence supports the claim.
Review does not edit verification results, ratings, readiness, the report or `latest.json`.
The saved file is a separate model artifact. Review never runs a new rule-set check.
The user-selected program itself has unrestricted file access.
To import hypotheses into another verification, copy the saved file into an ignored repository folder.
Name that file in the request.
