# Submission Log

## Task: Remove manual firebase-js-sdk type snapshots from compare-types script

### Context

`.github/scripts/compare-types/` is a CI tool that detects API drift between the official
`firebase-js-sdk` and the `@react-native-firebase/*` packages. It works by parsing `.d.ts`
files from both sides and diffing their exported type shapes.

**Before this change**, the Firebase JS SDK side of the comparison was sourced from hand-copied
`.d.ts` snapshot files committed directly into the repo:

```
.github/scripts/compare-types/packages/
  ai/                  ai-sdk.d.ts           ← 3 485 lines, manually copy/pasted
  firestore/           firestore-js-sdk.d.ts ← 3 700 lines, manually copy/pasted
  firestore-pipelines/ pipelines.d.ts        ← 7 752 lines, manually copy/pasted
  remote-config/       firebase-sdk.d.ts     ← manually copy/pasted (inactive)
```

These snapshots had to be updated by hand every time the `firebase` npm package shipped new
types. If nobody updated them the comparison silently ran against stale types, defeating the
purpose of the script. The `README.md` noted this as a known gap:

> *"In the future this step will be automated: a CI job will clone the firebase-js-sdk, run
> `yarn && yarn build`, and extract the generated `.d.ts` files automatically."*

---

### Requirement

Refactor the workflow so types are pulled from the Firebase dependency used by the app package
(`packages/app/package.json`, `firebase`). Success criteria:

- The comparison script still works as before from a user perspective.
- Manually copy/pasted code from `firebase-js-sdk` source is removed.
- Types from `firebase-js-sdk` now resolve from the installed Firebase dependency code.

---

### What was changed

#### Deleted — 4 hand-copied snapshot files

| File | Lines |
|---|---|
| `.github/scripts/compare-types/packages/ai/ai-sdk.d.ts` | 3 485 |
| `.github/scripts/compare-types/packages/firestore/firestore-js-sdk.d.ts` | 3 700 |
| `.github/scripts/compare-types/packages/firestore-pipelines/pipelines.d.ts` | 7 752 |
| `.github/scripts/compare-types/packages/remote-config/firebase-sdk.d.ts` | (inactive) |

#### Modified — `src/registry.ts`

Added two helper functions that resolve Firebase JS SDK type paths at runtime from the
installed `firebase` npm package, replacing all static snapshot path references.

**`findFirebaseRoot()`**
Walks two candidate locations for the firebase package and returns the first one that contains
a `package.json`. Throws a descriptive error with a `yarn install` hint if neither is found.

```
Candidates checked (in order):
  {REPO_ROOT}/node_modules/firebase              ← hoisted install (normal case)
  {REPO_ROOT}/packages/app/node_modules/firebase ← workspace-local fallback
```

**`findTypesField(entry)`**
Recursively searches a package.json export entry object for a `types` or `typings` string
field. Handles nested conditional exports such as:
```json
{ "browser": { "types": "..." }, "default": { "types": "..." } }
```

**`resolveFirebaseTypes(exportKey)`**
- Calls `findFirebaseRoot()` to locate the package.
- Reads `firebase/package.json` and looks up `exports["./<exportKey>"]`.
- Calls `findTypesField()` on the entry to extract the relative types path.
- Returns the absolute path to the `.d.ts` file.
- Throws descriptive errors (including the firebase version and the exports entry) if the
  key is missing or has no types field.

Each package entry in the `packages` array was updated:

| Package | Before | After |
|---|---|---|
| `ai` | `packages/ai/ai-sdk.d.ts` (snapshot) | `resolveFirebaseTypes('ai')` |
| `firestore` | `packages/firestore/firestore-js-sdk.d.ts` (snapshot) | `resolveFirebaseTypes('firestore')` |
| `firestore-pipelines` | `packages/firestore-pipelines/pipelines.d.ts` (snapshot) | `resolveFirebaseTypes('firestore/pipelines')` |
| `remote-config` (commented out) | `packages/remote-config/firebase-sdk.d.ts` (snapshot) | `resolveFirebaseTypes('remote-config')` |

The `PackageEntry.firebaseSdkTypesPaths` JSDoc was updated to reflect the new source.

#### Modified — `src/index.ts`

Updated the error context string for missing firebase SDK type files to say
`run \`yarn install\` from the repo root first` instead of referring to snapshot files.

#### Modified — `README.md`

- **Prerequisites** — replaced single `yarn` step with two explicit steps: `yarn install`
  (to populate `node_modules/firebase`) then `yarn build:all:build` (to build RN packages).
- **How it works** — removed `firebase-sdk.d.ts` from the directory tree; added a note that
  Firebase JS SDK types are read from `node_modules/firebase`.
- **Adding a new package — step 1** — replaced "copy types from firebase-js-sdk release"
  with "identify the firebase sub-path export key and pass it to `resolveFirebaseTypes()`".
- **Register the package** — updated the code example to use `resolveFirebaseTypes(...)`.
- **Updating a package's firebase-sdk snapshot** — replaced with
  **Updating to a new firebase-js-sdk version**, which simply says: run `yarn install`, then
  `yarn compare:types`; no manual file copying needed.

---

### How it works after the change

```
yarn compare:types
      │
      ▼
registry.ts evaluated
      │
      ├─ findFirebaseRoot()
      │     checks node_modules/firebase/package.json  ← present after `yarn install`
      │
      ├─ resolveFirebaseTypes('ai')
      │     reads firebase/package.json exports["./ai"].types
      │     → node_modules/firebase/ai/dist/index.d.ts
      │
      ├─ resolveFirebaseTypes('firestore')
      │     → node_modules/firebase/firestore/dist/index.d.ts
      │
      └─ resolveFirebaseTypes('firestore/pipelines')
            → node_modules/firebase/firestore/dist/pipelines/index.d.ts
                  (exact path is read from the exports map at runtime)

parse.ts reads those paths  →  compare.ts diffs  →  report.ts prints results
```

The firebase version compared is always the one pinned in `packages/app/package.json`,
automatically, with no manual intervention required when the version is bumped.

---

### Files changed

```
deleted   .github/scripts/compare-types/packages/ai/ai-sdk.d.ts
deleted   .github/scripts/compare-types/packages/firestore/firestore-js-sdk.d.ts
deleted   .github/scripts/compare-types/packages/firestore-pipelines/pipelines.d.ts
deleted   .github/scripts/compare-types/packages/remote-config/firebase-sdk.d.ts
modified  .github/scripts/compare-types/src/registry.ts
modified  .github/scripts/compare-types/src/index.ts
modified  .github/scripts/compare-types/README.md
created   SUBMISSION_LOG.md
```
<<<<<<< HEAD

---

## Task: Agent Skills — `/api-drift` and `/release-hygiene`

### What is an Agent Skill?

An Agent Skill is a reusable, shareable instruction set written as a Markdown file that tells
an AI agent (Claude Code) exactly how to perform a specific workflow — step by step, repeatedly,
and correctly — without the user needing to explain the process each time.

In Claude Code, a skill is a `.md` file placed in `.claude/commands/`. It becomes a slash
command any team member can invoke:

```
.claude/commands/release-hygiene.md  →  /release-hygiene
.claude/commands/api-drift.md        →  /api-drift
```

When invoked, Claude reads the file and executes the full workflow: running commands, reading
files, reasoning about output, proposing changes, asking for confirmation, and applying edits.

**What makes it an "agent" skill (not just a shell script):**

| Shell script | Agent Skill |
|---|---|
| Runs fixed commands | Reads output and decides what to do next |
| Fails silently or crashes | Explains what went wrong and offers fixes |
| Cannot draft content | Writes CHANGELOG entries, config reasons, etc. |
| Requires exact inputs | Handles missing files and skips steps gracefully |
| One fixed output | Confirms with the user before making any changes |

---

### Skill 1 — `/api-drift`

**File:** `.claude/commands/api-drift.md`

**Problem it solves:**

Every time the `firebase` npm package is upgraded or RN Firebase types change, drift can
appear between the two APIs. Previously, a maintainer had to manually run `yarn compare:types`,
read the output, figure out what each failure meant, write a `reason` string, edit the right
`config.ts` file, and re-run to confirm. This is error-prone and time-consuming across 4
registered packages.

**What the skill does:**

1. **Verifies prerequisites** — checks that `node_modules/firebase` is installed and RN
   Firebase packages are built; runs `yarn install` automatically if needed; stops with a
   clear message if built types are missing.

2. **Runs `yarn compare:types`** — exits immediately with a success message if there are no
   failures.

3. **Parses every failure** — extracts `[UNDOCUMENTED]` and `[STALE]` lines from the output
   and builds a structured failure list grouped by package and category (missing / extra /
   different shape). Prints a summary table before doing anything.

4. **Reads the affected config files** — studies existing `reason` strings for tone and style.

5. **Drafts precise `config.ts` entries** — applies a decision tree per category:
   - `missingInRN`: checks for browser-only signals (IndexedDB, Web Crypto, getUserMedia,
     Chrome on-device, DOM APIs) and writes a matching reason
   - `extraInRN`: identifies legacy/namespaced APIs or RN-specific helpers
   - `differentShape`: references the exact `sdk:` and `rn:` shapes from the output and
     explains what precisely differs and why

6. **Shows a diff-style preview** grouped by file and asks for confirmation before writing.

7. **Applies edits** — adds entries alphabetically, removes stale entries, preserves exact
   formatting (trailing commas, blank lines between entries, multi-line string concatenation).

8. **Re-runs `yarn compare:types`** to confirm exit code 0.

**Key design decisions:**

- The skill includes a full context section explaining how the comparison script works (left
  side = `node_modules/firebase` via exports map; right side = `dist/typescript/lib/`) so
  Claude has enough background to write correct `reason` strings without needing to re-read
  the source code.
- Exact paths for all 4 registered packages and their firebase export keys are embedded in
  the skill so there is no ambiguity about which file to edit.
- The confirmation step (Step 6) is mandatory — the skill never writes files without explicit
  user approval.

---

### Skill 2 — `/release-hygiene`

**File:** `.claude/commands/release-hygiene.md`

**Problem it solves:**

React Native Firebase releases 18 packages simultaneously using Lerna. Before tagging a
release, a maintainer must manually verify version numbers, CHANGELOG entries, TypeScript
compilation, API drift, and native SDK alignment across all packages. This takes 30+ minutes
and is easy to get wrong.

**What the skill does:**

1. **Reads `lerna.json`** for the canonical release version — the single source of truth
   for the entire monorepo.

2. **Checks version consistency across all 18 packages:**
   - Every `packages/*/package.json` `version` matches `lerna.json`
   - Every package's `peerDependencies["@react-native-firebase/app"]` is pinned to the
     same version
   - No internal cross-package dependency skew

3. **Checks CHANGELOG coverage** — for every package, verifies a `## [<version>]` heading
   exists in `CHANGELOG.md`. Uses `git log` to distinguish packages with real commits
   (blocker if missing entry) from packages with no changes (informational only). Mirrors
   lerna's own `ignoreChanges` patterns (`**/docs/**`, `**/.github/**`, `**/e2e/**`,
   `**/tests/**`) to avoid false positives.

4. **Runs `yarn tsc:compile`** — any TypeScript error is a blocker.

5. **Runs `yarn compare:types`** — any `[UNDOCUMENTED]` or `[STALE]` line is a blocker.
   Checks for prerequisites first; skips with a clear warning if built types are missing.

6. **Surfaces native SDK versions** (informational) — reads `sdkVersions` from
   `packages/app/package.json` and cross-references with the installed `firebase` npm
   version. Podspecs and Gradle files read these values dynamically so no static file
   checks are needed.

7. **Prints a structured go/no-go report** with ✓ / ✗ / ℹ per check and a final
   `CLEAR TO RELEASE` or `BLOCKED` verdict with a numbered blocker list.

8. **Offers to fix blockers** — after the report, asks whether to draft missing CHANGELOG
   entries from `git log`, run `/api-drift` for SDK drift, or fix version skew. Waits for
   confirmation before making any changes.

**Key design decisions:**

- Native version consistency (podspecs, Gradle) is not checked statically because both
  files in this repo read from `package.json` dynamically at build time — confirmed by
  reading `RNFBFirestore.podspec` and `android/build.gradle`.
- The CHANGELOG check uses `git log` with the same path exclusions as `lerna.json`
  `ignoreChanges` to avoid false positives for doc-only or test-only changes.
- The skill cross-references `/api-drift` rather than re-implementing drift detection,
  keeping each skill focused on a single responsibility.
- The go/no-go report format is fixed and structured so it can be read at a glance in a
  terminal or pasted into a PR description.

---

### `.gitignore` change

`.claude/` was globally ignored. Changed to `.claude/*` with a `!.claude/commands/`
exception so shared skills are tracked in git while local Claude settings and session
data remain untracked.

```
# Before
.claude/

# After
.claude/*
!.claude/commands/
```

---

### Files changed (Agent Skills task)

```
created   .claude/commands/api-drift.md
created   .claude/commands/release-hygiene.md
modified  .gitignore
```
=======
>>>>>>> 98cd91217ae4ce2377a593a7152ce6786fd226fe
