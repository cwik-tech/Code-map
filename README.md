# code-map

**code-map turns a codebase into a picture you can zoom into, and lets you ask questions about it.**

![The code-map page for the code-map repository itself. Left: the project as boxes inside boxes, sized by lines of code, with coloured borders for coupling roles. Right: the Details panel with the project summary and the Backbone graph.](docs/images/overview.png)

*The map of code-map's own code. The screenshots in this README all come from this repository.*

It reads a project's code and builds one web page that works offline. You don't need to understand the code to use it. That's the point: it's built for learning a codebase.

## What it helps you do

### See the whole codebase at once

- **Zoom from the project down to one function.** Modules, folders, files and functions are boxes inside boxes. The area of each box is its number of lines, so you see at a glance where the weight of the project is.
- **Read the code in place.** A function's box shows its code, and each box shows a short plain-language description.
- **Find anything fast.** Press `/` to search for a file or a function. Click a name in the panel or in the path above the map to jump there.
- **Learn the code step by step.** When the project has a guided tour, it walks through how the project works and highlights the files at each stop.
- **Colour the map by what matters to you:** module, last change, description status, direct tests, coupling role, hotspot, blast radius, failure tests, or test coverage (with a coverage report).

### Understand how the parts connect

- **See what each file uses and what uses it.** The Details panel lists the imports in both directions. A Connections diagram lets you walk from file to file.
- **Find the central files first.** Each file gets a coupling role (hub, foundation, top level or leaf) from how many files it imports and how many files import it. The Backbone graph shows only the files that hold the project together.
- **Trace one name across the code.** "Used by" lists every file that imports a given function or type.
- **Find links that imports do not show.** "Changes together with" lists the files that change in the same commits, also when no import connects them.

### Change code with more confidence

- **See what a change can break.** The Blast radius follows imports backwards from a file, from your recent commits, from your branch, or from your uncommitted work. It counts the affected files and how many steps away they are.
- **Know which tests to run.** The Blast radius lists the test files that reach the changed code. One click copies their paths for your test command.
- **Find the untested areas.** Gaps are changed or affected files that no test reaches. Test priority suggests which files need a test of their own.
- **Find the failures that no test checks.** The Tests tab counts your test cases and their layers, finds the places where each function reports a failure, and lists the functions that have no failure assertion for them. It gives statistics, what it sees with evidence, next steps, and the limits of the scan.
- **See which parts are self-contained.** The Ripple table shows how far a change to one module can spread into each other module.

### Keep the codebase healthy

- **Get a list of code-health checks:** imports in a direction that your rules forbid, import cycles, exports that nobody uses, declarations with no matching implementation, hotspots (large files that change often), and files with zero recorded coverage hits.
- **Watch size limits and budgets.** Set a line limit for files and functions, and a line budget for each module. The map flags functions over the limit and shows each module's lines against its budget.
- **Track progress.** The Progress view shows, for each module, how many functions have an implementation and how many files tests import directly.

### See how the code grew

- **Replay the history.** The strip at the bottom shows the code commit by commit. Drag it to see the code as it was, or press play to watch it grow. New files get an outline.

### Ask questions about the code

- **Chat about the box that you selected.** `code-map serve` adds a chat that uses your Claude Code login. Answers link to `path:line`, and a click moves the map there. The chat reads the same version of the code that the map shows, and it can only read.

### Fit it into your work

- **Map any version.** Map a branch, a commit, or your uncommitted work. By default, code-map follows the branch where the code changed most recently.
- **Share one file.** The page is a single HTML file. You can keep it, email it or open it later.
- **Let an assistant write the descriptions.** `code-map todo` lists the files without a description, ready to give to an assistant. The map marks a description as stale when the file's exports change.
- **Give AI agents the same facts.** Use `code-map inspect` for compact JSON containing dependencies, cycles, shared-type candidates, declaration metrics, export usage, candidate tests and the test-quality summary. Refer to [AI-AGENT-USE.md](AI-AGENT-USE.md).
- **Map TypeScript and JavaScript projects,** including Next.js-style path aliases and `require(…)` imports.

All signals come from static imports and Git history. They show possible impact and candidate tests, not proof of runtime behaviour. [Section 4](#4-find-your-way-around-the-map) explains the limits of each signal.

| Open a file to read its functions and code | See what a change can break |
| --- | --- |
| ![The file server.mjs opened on the map. Each function is a box that shows its code. The Details panel shows the file's description, size, and the files that import it.](docs/images/file-view.png) | ![The Blast radius tab for lib/git.mjs. The files that import it are tinted orange on the map, and the panel counts the affected files, the tests to run and the gaps.](docs/images/blast-radius.png) |

---

## Contents

1. [What you need](#1-what-you-need)
2. [Install it once](#2-install-it-once)
3. [Make your first map](#3-make-your-first-map)
4. [Find your way around the map](#4-find-your-way-around-the-map)
5. [Chat with the code](#5-chat-with-the-code)
6. [Add descriptions](#6-add-descriptions)
7. [Keep the map up to date](#7-keep-the-map-up-to-date)
8. [Settings (optional)](#8-settings-optional)
9. [Questions and problems](#9-questions-and-problems)
10. [What's inside this folder](#10-whats-inside-this-folder)
11. [Contributing, security and license](#11-contributing-security-and-license)

---

## 1. What you need

| What | Why | How to check |
| --- | --- | --- |
| **A Mac, Linux or Windows computer with a terminal** | You type a few commands. | On a Mac, open the **Terminal** app. |
| **Node.js, version 20 or newer** | code-map is a Node.js program. | Type `node --version`. You should see `v20` or higher. If not, install it from [nodejs.org](https://nodejs.org). |
| **Git** | The map reads the project's history from Git. | Type `git --version`. On a Mac, Git comes with the Xcode command-line tools. |
| **A project in a Git repository** | That is what gets mapped. It must be TypeScript or JavaScript code. | In the project folder, `git status` should not say "not a git repository". |
| **Claude Code** (only for the chat) | The chat uses it to answer questions. | Type `claude --version`. Install it from the [Claude Code documentation](https://docs.claude.com/en/docs/claude-code/overview) and log in once. |

**A few words used below**

- **Terminal:** the window where you type commands. Every command below is typed there, followed by Enter.
- **Folder path:** where a folder is on your computer, for example `/Users/you/Coding/my-app`. Put it in quotes when it contains spaces.
- **Repository:** a project folder tracked by Git.
- **Branch:** a line of work in Git, for example `main`.
- **npm:** the Node Package Manager, installed together with Node.js. It installs programs and runs a project's shortcuts ("scripts").

---

## 2. Install it once

You do this only once per computer. First get a copy of this repository: clone it with Git, or download it and unpack it. Keep the folder where it is afterwards: the installed command points to it.

```sh
cd "/path/to/code-map"
npm install
npm install -g .
```

What each line does:

1. `cd "/path/to/code-map"` moves the terminal into this folder. Use the path where you keep it.
2. `npm install` downloads the one thing code-map needs to read code: the `typescript` package. It lands in a `node_modules` folder here.
3. `npm install -g .` makes the `code-map` command available everywhere on your computer (`-g` means global, `.` means this folder).

Check that it worked:

```sh
code-map --help
```

You should see a short list of commands.

> **Order matters.** If you skip `npm install`, running the map fails with *"Cannot find package 'typescript'"*. Run `npm install` in this folder and try again.

---

## 3. Make your first map

Go to the project you want to map (not this folder):

```sh
cd "/path/to/your/project"
code-map
```

It prints something like:

```
Code map of my-app · main (3f2a1c0): 128 files in src, 87 snapshots, 128 undescribed, 0 stale
  -> docs/code-map/code-map.html
```

The page has been written to `docs/code-map/code-map.html` inside the project. Open that file in your browser: double-click it in Finder, or on a Mac type `open docs/code-map/code-map.html`.

The page is a single file that works offline. You can keep it, email it or open it later.

### Optional: add the `npm run map` shortcut to a project

```sh
code-map init
```

This does two things in the project:

- It adds `"map": "code-map"` to the `scripts` section of `package.json`, so `npm run map` works there.
- It creates `.code-map.json`, a small settings file (see [section 8](#8-settings-optional)).

After that, in that project:

```sh
npm run map                 # same as: code-map
npm run map serve           # same as: code-map serve
```

> **Options with dashes.** Plain words such as `serve` pass straight through `npm run map`. Options that start with dashes, such as `--ref main`, need a lone `--` first, so npm knows they are meant for code-map: `npm run map -- --ref main`. Or run `code-map --ref main` directly.

> **Run it in the project, not here.** `npm run map` only works inside a project that has the `map` shortcut. Inside this code-map folder it fails with *"Missing script: map"*. That's expected.

---

## 4. Find your way around the map

### The boxes

- **Top level:** the project's main parts. If the project has a `src` folder, these are the folders inside it.
- **Inside them:** folders, then files.
- **Inside a file:** its functions, classes and types. When there's room, a function's box shows its code.
- **Size:** each box's area is its number of lines. The line count is in its top-right corner.
- **Description:** when there's room, the box shows a short description under its name.

### Moving around

| To | Do this |
| --- | --- |
| Open a box (zoom in) | Click it. |
| Close it again (zoom out) | Click its name bar at the top, or press `Esc`. |
| Jump somewhere | Click a name in the right panel, the path above the map, or a search result. The map animates out and back in, so you keep a sense of where you are. |
| Search | Type in the box at the top, or press `/`. Pick a file or function. |
| Switch light and dark | Click the moon button at the top right. |
| Make the right panel wider or narrower | Drag its left edge. Double-click the edge to reset it. The width is remembered. |

### The right-hand panel

- **Details:** what the selected box is for, how big it is, what it imports (outlined in orange on the map), what imports it (outlined in violet), and which tests use it.
  - For a file or function, a **Connections** diagram sits under the numbers: the file in the middle, the files that use it on the left, the files it uses on the right. Click a neighbour to walk there.
  - For the whole project, the default view is the **Backbone** graph (a legend above it shows the four roles and how many files each has): only the files that aren't leaves, in three layers (top level at the top, hubs in the middle, foundations at the bottom), with their import links. Hover a dot, or any box on the map, to light up its links: orange = what it uses, violet = what uses it. Hovering a dot also outlines the file on the map, and hovering a module lights up all its backbone files. A module's own panel shows the same graph with its files highlighted.
  - Next to it, **Progress** shows each module's functions with a matching body versus declaration only (striped; external providers unverified), and how many of its files tests import directly. The **Coupling** tab (second, after Backbone) shows the coupling chart (below), and **Budget** shows each module's lines against its line budget (called **Lines** when the project has no budget).
  - Each file shows its **coupling role**: hub, foundation, top level or leaf.
- **Tests:** which failures no test checks, for the whole project, a module, a folder, a file or a function. Refer to [Tests: which failures no test checks](#tests-which-failures-no-test-checks).

### Coupling: which files matter most

Two counts describe how connected a file is:

- **Fan-in** (`↙` on a box, "used by"): how many files import it. High fan-in means many files depend on it, so a change here can break them.
- **Fan-out** (`↗` on a box, "uses"): how many files it imports. High fan-out means it depends on many things, so changes elsewhere can break it.

Together they give each file a role:

| Role | Fan-in | Fan-out | What it means |
| --- | --- | --- | --- |
| **Hub** | high | high | Central: worth understanding first, risky to change. Orange-red border on the map. |
| **Foundation** | high | low | A stable building block many files rely on |
| **Top level** | low | high | Assembles other parts, such as the application setup |
| **Leaf** | low | low | Few connections either way |

On the map, every file that isn't a leaf has a thick coloured border (orange-red = hub, green = foundation, violet = top level), visible before you click anything; no border means a leaf. Wide boxes also show the role and the `↙ ↗` counts. At the top level, file boxes show only names and roles, without descriptions.

"High" means the top 15% of the project (and at least 4). The Coupling chart places every file: across is fan-in, up is fan-out, and the coloured corners are the roles. Click a dot to open its file. **Colour → by coupling role** colours the whole map the same way. A file that nothing imports sits at the far left; it may be an entry point, or not connected yet.
- **Guided tour:** a step-by-step story of how the project works, when one has been written ([section 6](#6-add-descriptions)). Each stop highlights the files involved, and **the journey** at the bottom shows all stops as a flow you can click.
- **Blast radius:** what a change can break, and which tests would catch it (see below).
- **Chat:** questions and answers about the code ([section 5](#5-chat-with-the-code)).
- **How to read:** a short reminder of all of this.

### Blast radius: what a change can break

The **Blast radius** tab (second in the right panel, after Details) follows imports backwards from a changed file. Files that import it are **1 step** away (direct). Files that import those are 2 steps away, and so on. Edges include type-only imports: this is possible impact, not proof of runtime calls or failures.

- **Selected file:** the blast radius of the selected file. Hovering a box on the map previews its blast radius instead (for a folder or module, all its files count as changed); move the pointer off the map to go back, or click the box to keep it. With a module, a folder or the whole project selected, it ranks the files there whose changes affect the most others. Click one to see its blast radius.
- **A change:** the blast radius of recent work. Pick the last commit, the last 3, 5 or 10 commits, everything since the branch left `main` (or `master`), or, with `--worktree`, your uncommitted changes.

What it shows:

- **The numbers:** files affected, how many directly, modules touched, tests to run, gaps, and the most steps away.
- **The squares:** one per file, grouped by module. Dark brown = changed, orange = 1 step, lighter = further away. Hover for the name; click to open it.
- **On the map:** changed files are hatched dark brown, and affected boxes are tinted orange (darker = closer). The tint shows on boxes that are visible, so zoom out to see all of it.
- **Tests to run:** every test file that imports a changed file, directly or through other files. **Copy paths** copies them, ready to paste after your test command.
- **Gaps** (red outline): changed or affected files that no test reaches at all. This is a signal to investigate; imports do not establish assertions.

"Reaches" means a test imports the file through some chain of files. It is a good guide, not proof: it doesn't show that a test runs every function in it. Test files are those named `*.test.*` or `*.spec.*`; helper files in test folders only pass imports along.

### Blast radius of the whole project

Three views show it for every file at once:

- **Colour → by blast radius** colours the map itself (see the Colour menu below).
- **Test priority** (a tab in the project overview, after Coupling) answers "should this file have its own test?". Each dot is a file: across is its blast radius, up is its lines of code (a rough measure of how much logic can go wrong), and the colour is how close its nearest test is. Files in the shaded corner affect at least 5 files, have at least 80 lines, and no test imports them directly: those are worth a direct test. Constants often affect many files but hold almost no logic, so tests through other files are usually enough. Two lists below the chart name the suggested files and the files no test reaches at all.
- **Ripple** (the next tab) is a table: for a change to a whole module (row), the share of each other module's files (column) that can be affected. Dark rows ripple everywhere; light rows are contained.

### Checks: code health

The project overview ends with **Checks**, a list of closed sections with counts. Each line opens the file.

| Check | What it finds | Also shown |
| --- | --- | --- |
| **Rule breaks** | Imports in a direction you forbid (`rules` in [settings](#8-settings-optional)) | Red frame in the Ripple table; red note in the file's Details |
| **Import cycles** | Switch between all dependencies and value dependencies, with source-line evidence; neither proves runtime initialization defects | Dependency controls and red dashed links in Backbone; note in Details |
| **Shared types** | A child imports a type from a file that imports the child as a value; a candidate for an independent type module | Declaration and both import directions linked in Checks |
| **Declarations with possible value importers** | Declarations with no matching body here and possible value importers; explicit type-only imports are excluded. An external runtime provider may exist | "Declaration only · provider unverified" in the file's Details |
| **Export usage** | Values, types, reexports and test-only consumers with no source importer; local use and entry-point candidates remain visible | File Details; optional primitive/vendor path filter |
| **Hotspots** | Files that change often (Git) and are large: where defects tend to appear | **Colour → by hotspot** |
| **Zero recorded hits** | Files with a valid, nonempty LCOV entry and zero hits; missing or invalid entries are listed as Coverage unknown | **Colour → by test coverage** |

Two more views live with the file or function you select:

- **Changes together with** (a file's Details): files changed in the same commits. **No import link** marks a correlation to investigate, not proof of a hidden dependency. In the Blast radius tab they get a dashed outline on the map.
- **Used by** (an exported function's or type's Details): every file that imports that name, including types and possible namespace references, outlined violet on the map. Handy to trace a shared concept across the code.

**With a coverage report** (`coverage/lcov.info`, which Jest, Vitest, c8 and nyc can all write), the working-tree view shows recorded instrumented line hits in Details, **Colour → by test coverage**, Blast radius gaps and Test priority. Missing, malformed and zero-instrumented entries are unknown; partial groups stay unknown, and unknown files are listed separately from the priority plot. Without a report, priority uses source line counts.

LCOV is read from the working folder and has **no revision or test-command binding**. Its timestamp does not bind it to the mapped source. Commit maps (`--ref`, including the default Git selection) and historical slider snapshots show coverage as unknown. Even in `--worktree`, hits do not prove assertions or behaviour; verify the report's origin yourself.

### Tests: which failures no test checks

The **Tests** tab, next to Blast radius, answers "which failures do our tests not check?" It finds functions whose failure exits have no failure test. It cannot judge whether an existing test checks the correct behavior. The tab shows this sentence at the top, so that nobody reads the result as a quality score.

For the whole project, a module or a folder, the tab shows four parts:

1. **Statistics:** test files by layer (unit, integration, e2e and others), test cases (running, skipped, todo, conditional, focused), cases with a failure assertion, functions with failure exits, functions with no failure assertion found, failure exits that ran (with a coverage report), fix commits with no test change, and model labels.
2. **What we see:** each finding with its evidence (file and line, and an existing test to start from), what to do, and the kind of evidence.
3. **Next steps:** the first actions, each tied to a source location.
4. **Limits of this scan:** what each number can and cannot show.

For a file or a function, the tab lists each function's failure exits, whether each exit ran, the tests that call it, and the tests that reach it through callers with their route.

Each statistic and finding names its kind of evidence:

| Evidence | Where it comes from |
| --- | --- |
| **inventory** | Counted in the test files: cases, statuses, test files that the scan cannot read |
| **inferred link** | A test that references a function, and a failure assertion that the scan ties to it. Check it in the code. |
| **pattern** | A source pattern, such as a fixed wait or a test with no assertion. Check it in the code. |
| **measured** | The working-folder coverage report. It is not tied to a revision, and the tab shows its age. |
| **Git** | Commit history, for example bug fixes that changed no test file |
| **model** | Optional labels that a model writes for each test case |

The rules behind the evidence:

- A failure assertion counts for a function only when it names the function, or a local variable or caught error that comes from it. It must run without a condition: a check inside an `if` is a candidate, and a check under `if (false)` does not count.
- A test name or a model label never closes a gap. It can only point to a test to read.
- Skipped, todo and conditional tests are counted, but they never count as evidence.
- "No failure assertion found" means unknown, not proof. A custom assertion helper can hide a check from the scan.

**Copy summary** copies the summary as Markdown, ready for a ticket or an agent. **Download JSON** saves the same report as `code-map inspect`, scoped to the selection.

To let a model label the intent of each test case (happy, unhappy, edge or regression), run `code-map labels`. Give its work list to the model, which writes the labels into `docs/code-map/test-labels.json`. Then run `code-map labels stamp`. When a test file changes, its labels become stale. After you review them, run `code-map labels stamp --file <test file>`.

### Words used on the map

| Word | What it means |
| --- | --- |
| **Import** | A static import or re-export edge, including type-only references. Almost everything on this map is worked out from imports; edges do not prove runtime calls. |
| **Fan-in (↙, "used by")** | How many files import this one. High fan-in: many files depend on it, so changing it is risky. |
| **Fan-out (↗, "uses")** | How many files this one imports. High fan-out: it depends on many things, so changes elsewhere can break it. |
| **Hub · foundation · top level · leaf** | Roles from fan-in and fan-out. **Hub**: high on both, central. **Foundation**: used a lot, uses little, a building block. **Top level**: uses a lot, used little, it assembles things. **Leaf**: few connections. "High" means the top 15% of this project, and at least 4. |
| **Backbone** | The graph of only the files that are not leaves: the skeleton of the code. |
| **Blast radius** | Every file that could break if a file changes: the files that import it, the files that import those, and so on. Each hop is one **step**; files 1 step away import it **directly**. |
| **Tests to run** | Test files that import a changed file, directly or through other files. Candidate tests to run; imports alone do not prove assertions cover the change. |
| **A test reaches a file** | A test imports it through some chain of files. A good guide, but not proof that the test runs its code. LCOV records instrumented line hits; it does not prove assertions or behaviour. |
| **Direct test** | A test file that imports this file itself, rather than reaching it through other files. |
| **Gap** | A changed or affected file that no test reaches (or, with a coverage report, whose valid, nonempty LCOV entry has zero hits). This is an evidence gap, not proof about assertions. |
| **Test priority** | Where a direct test pays off: files that affect many others and hold real logic (many lines, or many lines that never ran) but have no test of their own. |
| **Ripple** | For a change to a whole module, the share of each other module's files that could be affected. Shows which parts are self-contained and which touch everything. |
| **Failure exit** | A place where a function reports a failure: `throw`, a rejected promise, a `catch` block, a returned error such as `{ error }` or `{ ok: false }`, a 4xx or 5xx response, or a nonzero exit. Found by pattern. |
| **Failure assertion** | An assertion that checks a failure: `toThrow`, `rejects`, `assert.throws`, an error value that exists, a failed status or `ok: false`. It counts for a function only when it names that function, or a variable or caught error that comes from it. |
| **No failure assertion found** | Tests reach the function, but none has a failure assertion that the scan can tie to it. This means unknown, not proof that the tests check only success. |
| **Through callers** | A test has a failure assertion for a function that calls this one, up to 3 calls away. The Tests tab shows the route. This is weaker evidence than a direct failure assertion. |
| **Test layer** | Unit, integration, e2e, API, live and similar. It comes from folder and file names first, then from imports and side effects such as processes, the network, a database or a browser. |
| **Coverage** | The share of instrumented lines with hits in working-folder LCOV. Missing or invalid entries are unknown. See the report provenance limits above. |
| **Hotspot** | A file that is both **changed often** and **large**. Worked out as: number of commits that changed the file × its lines of code, compared with the rest of the project. Why it matters: code that keeps changing and has a lot in it is where mistakes most often slip in, and where a clean-up or extra tests pay back most. A large file that never changes is not a hotspot; neither is a tiny file that changes all the time. |
| **Changes together (change coupling)** | Files that were changed in the same commits again and again (at least 3 times, in at least 30% of one file's commits). Commits touching more than 25 files are ignored. **No import link** means neither file imports the other, a correlation that does not establish a hidden dependency. |
| **Import cycle** | Files that import each other round in a loop (A imports B, B imports C, C imports A). Type-only edges are included; this does not establish a runtime initialization cycle. |
| **Rule break** | An import in a direction your project forbids, from the `"rules"` in `.code-map.json` (for example `"verify -> engine"`: files in verify must not import files in engine). |
| **Export** | A function, type or value a file offers to other files. **Export usage** groups names with no source importer; this does not establish dead code. |
| **Declaration only (provider unverified)** | A declaration with no matching implementation in this file. Overload signatures with a body are implemented. Ambient declarations can have an external provider; this parser cannot verify it. **Declarations with possible value importers** have possible value-capable importers; imports are not proven calls. |
| **Used by (concept trace)** | For one exported name: files importing it, including type-only references. Namespace imports are possible use of every export, not proven calls. |

### Colour menu

- **By module:** each main part has its own colour.
- **By last change:** brighter boxes changed more recently.
- **By description:** shows which files still need a description.
- **By direct tests:** shows which files tests import directly.
- **By coupling role:** hub, foundation, top level or leaf (see below).
- **By test coverage** (only with a coverage report): the share of instrumented lines with recorded hits; unknown entries have a neutral colour.
- **By hotspot:** darker files change often and are large.
- **By blast radius:** darker boxes affect more files when they change. A dashed red frame means no test reaches the file; a dashed amber frame means no test imports it directly, so it's only tested through other files.
- **By failure tests:** each function's evidence category: no test reaches it, no failure assertion found, failure assertion only through callers, or failure assertion found. A file or folder shows its weakest function. Boxes with no failure exits have a neutral colour.

### The history strip at the bottom

- **To travel back:** drag across it or click it. The map shows the code as it was at that commit, and files that just appeared get an orange outline.
- **To watch it grow:** press ▶ to replay the whole history.

### Hatched (striped) boxes

These declarations have no matching body in the file. Their runtime provider is unverified; an ambient declaration may be backed by another module or platform. Implemented function, method and constructor overload signatures are not marked declaration only. Static and instance members are matched separately; abstract and ambient bodyless members remain declaration only.

---

## 5. Chat with the code

The chat lets you ask things like *"What does this function do?"* or *"Who calls this, and why?"* about whatever box you have selected.

### Start it

```sh
cd "/path/to/your/project"
code-map serve              # or: npm run map serve
```

It prints an address, normally **http://127.0.0.1:4477**. Open that address in your browser. Opening the HTML file directly won't work for the chat. Leave the terminal open while you use it; press `Ctrl+C` there to stop.

### Use it

1. Click a box on the map, for example a function.
2. Press **Ask about this**, above the map or in the Details panel, or open the **Chat** tab.
3. The chat shows **About: …** with the selected file or function. That reference, plus the selected code (or, for a folder, its list of files), is sent with your first question about it, so Claude can answer right away. Press ✕ to ask without it.
4. Type your question and press Enter. Use Shift+Enter for a new line.
5. Ask follow-up questions; the conversation continues. **New chat** starts over.
6. Answers mention places like `src/cli/server.ts:19`. Click one and the map moves there.

### Which version of the code does Claude read?

The same version the map shows. If the map shows a different branch from the one you have checked out (code-map follows the branch whose code changed most recently), `serve` copies that commit into a private temporary folder and runs Claude there. The copy is read-only for Claude, your repository is not touched, and the copy is replaced when the map moves to a newer commit.

### Is it safe?

- **It only reads.** The chat uses your installed Claude Code with only its read and search tools. Editing files, running commands, web access and MCP servers are switched off. The project's own Claude Code settings and hooks are ignored, so a repository that you map cannot add tools or run commands. The read tools are not locked to the project folder; [SECURITY.md](SECURITY.md) explains the details.
- **It stays on your computer.** The server only accepts connections from your own computer, and only the page it served can use it.
- **No API key.** It uses your normal Claude Code login. Questions and the code Claude reads go to Claude, exactly as when you use Claude Code yourself.

---

## 6. Add descriptions

The map computes everything except descriptions. Those are short, human-written sentences that say what each part is for. A new project starts with none; the map still works, it just says "No description yet".

Descriptions live in one file in the project: `docs/code-map/descriptions.json` (the location can be changed, see [section 8](#8-settings-optional)). It looks like this:

```json
{
  "modules": {
    "overview": { "title": "My app", "summary": "What the whole project does, in one or two sentences." },
    "cli": { "title": "Command line", "summary": "What this part of the project is for." }
  },
  "folders": {
    "src/core/constants": "What the files in this folder have in common."
  },
  "files": {
    "src/cli/args.ts": { "summary": "Turns the words you type into a command the program understands." }
  },
  "tour": [
    {
      "title": "1 · You type a command",
      "text": "Explain this step in plain words.",
      "files": ["src/cli/args.ts", "src/cli/server.ts"]
    }
  ]
}
```

- **`modules`:** one entry per main part, keyed by its folder name. `overview` describes the whole project.
- **`folders`:** one sentence per folder, keyed by its path.
- **`files`:** one sentence per file, keyed by its path.
- **`tour`:** the guided tour's stops, in order. Each one names the files it highlights.

**Functions** are described by the comment written directly above them in the code, for example:

```ts
/** Turns the words you type into a command the program understands. */
export function parseCommand(args) { … }
```

### Let an assistant write them

```sh
code-map todo
```

This prints a to-do list: every file without a description, with what it exports and any comment at its top. Give that list to Claude (or another assistant) and ask it to fill in `descriptions.json`. Then run:

```sh
code-map stamp
```

This records what each file looks like now. If a file's exported names change later, the map marks its description as possibly out of date, and it shows up in `todo` again.

`code-map stamp-all` re-records every description, after you have reviewed them all.

---

## 7. Keep the map up to date

- **The page:** run `code-map` (or `npm run map`) again whenever you want a fresh one. It only reads Git; it changes nothing in your project except the page itself.
- **With `serve`:** reloading the browser rebuilds the map automatically when there are new commits.
- **Which branch:** it maps the branch whose code changed most recently, so it follows the work wherever it is happening. Commits that only change documents don't count.
- **A different branch:** `code-map --ref main`.
- **Work you haven't committed yet:** `code-map --worktree`.

### All commands

| Command | What it does |
| --- | --- |
| `code-map` | Build the page |
| `code-map inspect` | Emit compact structural analysis as JSON, without HTML or a server |
| `code-map serve` | Build it and serve it with the chat |
| `code-map init` | Add `npm run map` and `.code-map.json` to the project |
| `code-map todo` | List files whose description is missing or out of date |
| `code-map stamp` | Mark new descriptions as matching the current code |
| `code-map stamp-all` | Mark all descriptions as matching the current code |
| `code-map labels` | List the test cases whose intent labels are missing or stale (optional model pass) |
| `code-map labels stamp` | Record the test version that new labels describe; add `--file <test file>` to refresh reviewed labels |
| `code-map labels stamp-all` | Record the current test version for all labelled test files |
| `code-map --help` | Show the commands |

| Option | What it does |
| --- | --- |
| `--ref <branch>` | Map this branch or commit |
| `--worktree` | Map the files as they are now, including uncommitted changes |
| `--out <file>` | Write HTML, or an inspection report, to this path |
| `--json` | Emit inspection JSON instead of HTML |
| `--file <path>` | Select a source file for inspection; repeat for several files. With `labels`, select a test file |
| `--change <selection>` | Inspect `latest`, `branch`, or `uncommitted` changes |
| `--exclude-vendors` | Omit primitive/vendor paths from inspection file details |
| `--descriptions <file>` | Use another descriptions file |
| `--labels <file>` | Use another test-labels file |
| `--port <number>` | Use another port for `serve` (default 4477) |

---

For report fields, source evidence, selection examples and HTML controls, see [Structural inspection and JSON reports](docs/inspection.md). Reports omit source bodies and full history; file selections retain relevant cycle and shared-type evidence. File Details also sorts declarations by size, referenced dependencies and hook call sites.

## 8. Settings (optional)

Most projects need no settings. To change something, create or edit `.code-map.json` at the top of the project:

```json
{
  "descriptions": "docs/code-map/descriptions.json",
  "out": "docs/code-map/code-map.html",
  "roots": ["src"],
  "limits": { "fileLines": 400, "functionLines": 60 },
  "budgets": { "core": 8000, "cli": 2000 },
  "history": 400,
  "rules": ["verify -> engine", "core -> *"],
  "coverage": "coverage/lcov.info",
  "testLabels": "docs/code-map/test-labels.json"
}
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `descriptions` | `docs/code-map/descriptions.json` | Where the descriptions file is |
| `out` | `docs/code-map/code-map.html` | Where the page is written |
| `roots` | `src` if it exists, otherwise every top-level folder with code | Which folders to map |
| `limits` | none | Shows a file-length limit and flags functions longer than the limit |
| `budgets` | none | A line budget per main part; the panel shows how much is used |
| `budgetsFrom` | none | Read budgets from a size-check script instead |
| `history` | 400 | The most commits shown in the history strip |
| `rules` | none | Forbidden import directions, as `"from -> to"`. Each side is a module or folder name; `*` means any other module. Breaks show in Checks, the Ripple table and the file's Details |
| `coverage` | `coverage/lcov.info` if it exists | Working-folder LCOV path, not read from Git. It has no revision or command binding; see the coverage limits in section 4 |
| `testLabels` | `docs/code-map/test-labels.json` | Where the optional model labels for test cases are |

What it maps automatically:

- **Mapped:** files ending in `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`. It understands Next.js-style short import paths (`@/components/…`) and older `require(…)` imports.
- **Import aliases:** reads root and nested `tsconfig*.json` and `jsconfig*.json`, project references, and local JSON/JSONC `extends` files from the mapped revision. Each file uses its matching project config; files outside compiler include lists fall back to the nearest `tsconfig.json` or `jsconfig.json`. TypeScript decides path-pattern precedence, fallback targets, and paths relative to their defining config. Aliases defined only in bundler config, or inherited from dependencies absent from the mapped files, remain unresolved.
- **Tests:** files named `*.test.*` or `*.spec.*`, or inside `test`, `tests`, `__tests__` or `e2e` folders. They aren't drawn; they appear as "tests that import it".
- **Ignored:** `node_modules`, build output (`dist`, `build`, `out`), `docs`, and hidden folders whose names start with a dot.

---

## 9. Questions and problems

**"Cannot find package 'typescript'"**
You skipped `npm install` in this folder. Run it here: `cd "/path/to/code-map"` then `npm install`.

**"Missing script: map"**
You ran `npm run map` in a folder without that shortcut, such as this one. Go to your project, or run `code-map init` there first.

**"command not found: code-map"**
The global install didn't happen. In this folder, run `npm install -g .`.

**"code-map needs to run inside a Git repository"**
Run it in a project folder that uses Git. To start using Git there: `git init`, then `git add -A`, then `git commit -m "First commit"`.

**The chat says it needs the local server**
You opened the HTML file directly. Run `code-map serve` and open the address it prints.

**The chat says the Claude Code command was not found**
Install Claude Code and log in once. If it's installed somewhere unusual, start the server with its path: `CODE_MAP_CLAUDE=/path/to/claude code-map serve`.

**"… is not a private folder that you own, so the chat cannot use it"**
The chat keeps its copies of commits in a `code-map-chat` folder inside your temporary folder. That folder is a symlink, another user on this computer owns it, or other users can open it. Remove it if it is yours, or start the server with a temporary folder that only you use: `TMPDIR="$HOME/.cache" code-map serve`.

**"port 4477 was busy"**
An older code-map server is still running, usually one you started earlier and didn't stop. The new one uses the next free port and prints its address. To stop the old one, press `Ctrl+C` in its terminal, or run `lsof -ti tcp:4477 | xargs kill`.

**The map looks old in the browser**
Reload without the cache: Cmd+Shift+R on a Mac, Ctrl+Shift+R on Windows or Linux.

**Many files show "No description yet"**
That's normal for a new project. See [section 6](#6-add-descriptions).

**Do I need to commit the generated page?**
It's up to you. It's a normal file and can be rebuilt any time. Commit `descriptions.json`, since that's hand-written work.

---

## 10. What's inside this folder

| File | What it is |
| --- | --- |
| `bin/code-map.mjs` | The `code-map` command: reads your options and runs the steps below |
| `lib/project.mjs` | Works out what to map: folders, tests, short import paths, project name, settings |
| `lib/git.mjs` | Reads files and history from Git (read-only) |
| `lib/analyze.mjs` | Reads each file: its functions, imports and exports |
| `lib/source-metrics.mjs` | Binds source names for declaration metrics and local export references |
| `lib/analysis.mjs` | Shared structural checks and compact report selection for CLI and HTML |
| `lib/test-scan.mjs` | Reads each test file: its cases, statuses, assertions, failure assertions and the source names each case references |
| `lib/test-assertions.mjs` | Recognizes assertions and classifies the failure that each one checks |
| `lib/test-quality.mjs` | Links test cases to source functions and compares failure exits with failure assertions |
| `lib/test-summary.mjs` | Builds the test-quality summary: statistics, findings, next steps and limits (also embedded in the page) |
| `lib/test-labels.mjs` | Loads the optional model labels for test cases, checks their freshness, builds their work list |
| `lib/history.mjs` | Counts lines at each commit for the history strip |
| `lib/changes.mjs` | Finds which files recent commits changed, and which files change together |
| `lib/coverage.mjs` | Reads a test coverage report (lcov), when there is one |
| `lib/descriptions.mjs` | Loads descriptions, spots outdated ones, builds the to-do list |
| `lib/build.mjs` | Puts everything together into the page |
| `lib/viewer.html` | The page itself: the map, panels, tour and chat |
| `lib/server.mjs` | The local server behind `serve` and the chat |
| `lib/snapshot.mjs` | Makes the private copy of the mapped commit that the chat reads |
| `package.json` | Tells npm the command's name and its one dependency |

To update code-map later, run `git pull` in this folder, or replace its files with a newer download. The `code-map` command picks up the change automatically, with no reinstall needed, unless `package.json` changed; then run `npm install` here again.

### Repair regressions

Run the built-in Node tests from this checkout:

```sh
npm test
```

Parser, alias-resolution, inspection, test-quality and LCOV tests use the installed TypeScript and temporary files. One coverage regression writes real LCOV with `node --test --experimental-test-coverage` and skips when the Node version cannot. Alias and CLI regressions also use temporary Git repositories to check snapshot selection and JSON/HTML parity. Viewer acceptance tests open the real generated template in isolated headless Chrome, with no server or personal profile. On macOS the default executable is Google Chrome in Applications; set `CODE_MAP_CHROME` to an installed Chrome executable elsewhere. Browser tests explicitly skip if Chrome is absent.

---

## 11. Contributing, security and license

- **Contributing:** read [CONTRIBUTING.md](CONTRIBUTING.md) before you open a pull request.
- **Code of Conduct:** everyone in the project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- **Security:** do not report a vulnerability in a public issue. Follow [SECURITY.md](SECURITY.md).
- **Help:** [SUPPORT.md](SUPPORT.md) tells you where to ask.
- **Changes:** [CHANGELOG.md](CHANGELOG.md) lists the changes in each version.

code-map is licensed under the [Apache License, Version 2.0](LICENSE). Copyright 2026 Cwik Technologies LLC. Refer to [NOTICE](NOTICE).
