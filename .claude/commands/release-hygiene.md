# /release-hygiene

Run a pre-release health check across every `@react-native-firebase/*` package
and produce a clear **go / no-go** report before cutting a release.

---

## Intent

React Native Firebase releases 18+ packages simultaneously using Lerna. Before
tagging a release, a maintainer must verify that version numbers, changelogs,
TypeScript types, and API drift are all consistent. This skill automates every
one of those checks and surfaces blockers early.

---

## Repeatable workflow

### Step 1 — Read the canonical release version

Read `lerna.json` and extract the `version` field. This is the single source of
truth for the entire monorepo.

```
RELEASE_VERSION = lerna.json → version
```

Record this. Every check below is measured against it.

---

### Step 2 — Version consistency across packages

For every directory under `packages/`, read its `package.json`. Perform three
sub-checks:

#### 2a — Package version matches lerna.json

```
packages/<name>/package.json → version  must equal  RELEASE_VERSION
```

#### 2b — Peer dependency on `@react-native-firebase/app` is exact and current

Every package except `app` itself declares `@react-native-firebase/app` as a
peer dependency. That pinned version must equal RELEASE_VERSION.

```
packages/<name>/package.json → peerDependencies["@react-native-firebase/app"]
                               must equal  RELEASE_VERSION
```

#### 2c — Internal cross-package dependencies are consistent

If any package lists another `@react-native-firebase/*` package as a
`dependencies` or `peerDependencies` entry, that version must also equal
RELEASE_VERSION.

Report all mismatches as blockers. A single version skew breaks the npm install
graph for consumers.

---

### Step 3 — CHANGELOG coverage

For every package, check whether `packages/<name>/CHANGELOG.md` contains a
heading for the release version in the format produced by lerna's
conventional-commits changelog preset:

```
## [<RELEASE_VERSION>]
```

Use a case-sensitive substring match. A package whose CHANGELOG lacks this
heading has not been documented for the release.

**Important nuance:** Some packages may have no user-facing changes in this
release cycle. Check git log to distinguish:

```bash
git log --oneline packages/<name>/ -- ':(exclude)packages/<name>/docs' \
    ':(exclude)packages/<name>/e2e' ':(exclude)packages/<name>/tests'
```

(The `ignoreChanges` patterns in `lerna.json` exclude `**/docs/**`,
`**/.github/**`, `**/e2e/**`, `**/tests/**` — mirror that here.)

- If there are commits for this package **and** no CHANGELOG heading → **blocker**
- If there are no commits for this package **and** no CHANGELOG heading → informational
  only (lerna would skip this package on publish)
- If CHANGELOG heading exists → ✓

---

### Step 4 — TypeScript compilation

Run:

```bash
yarn tsc:compile
```

This compiles the entire monorepo using the root `tsconfig.json`. Capture stdout
and stderr. Any errors are **blockers**. Report the file path and error message
for each one.

If the built `dist/` directories are missing, `tsc:compile` will still work
because it reads from source `lib/` files — but note it to the user.

---

### Step 5 — API drift check

Run:

```bash
yarn compare:types
```

This requires two things. Check them before running:

1. `node_modules/firebase/package.json` exists — if not, run `yarn install` first.
2. Built type files exist for the registered packages. Check for these sentinels:
   - `packages/ai/dist/typescript/lib/index.d.ts`
   - `packages/firestore/dist/typescript/lib/types/firestore.d.ts`

   If either is missing, warn:
   > "Built types are missing for one or more packages. Run `yarn build:all:build`
   > to generate them. Skipping api-drift check for now."
   >
   > Mark this check as **skipped** and continue to Step 6.

Capture the output. Any line containing `[UNDOCUMENTED]` or `[STALE]` is a
**blocker**. Report the package name, export name, and category.

---

### Step 6 — Native SDK version alignment (informational)

Read the canonical native SDK versions from `packages/app/package.json`:

```
sdkVersions.ios.firebase    → iOS Firebase SDK version
sdkVersions.android.firebase → Android Firebase SDK version
```

Podspecs and Gradle files in this repo read those values dynamically at build
time — no static file check is needed. But surface the versions so the release
notes author can reference them:

```
iOS Firebase SDK:     <version>
Android Firebase SDK: <version>
```

Cross-reference against the JS SDK version installed:

```bash
node -e "console.log(require('./node_modules/firebase/package.json').version)"
```

If `node_modules` is not installed, skip this informational step.

---

### Step 7 — Print the go / no-go report

Print a structured report in this exact format:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  React Native Firebase — Release Hygiene
  Candidate version: v<RELEASE_VERSION>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CHECK 1 — Version consistency
  ✓  All 18 packages are at v<RELEASE_VERSION>
  ✓  All peer deps on @react-native-firebase/app are pinned to v<RELEASE_VERSION>

CHECK 2 — CHANGELOG coverage
  ✓  16 packages have a CHANGELOG entry for v<RELEASE_VERSION>
  ✗  packages/auth — has 3 commits but no CHANGELOG entry for v<RELEASE_VERSION>  [BLOCKER]
  ℹ  packages/ml — no commits since last release, no entry expected

CHECK 3 — TypeScript compilation
  ✓  yarn tsc:compile passed with 0 errors

CHECK 4 — API drift
  ✗  firestore: 2 undocumented differences  [BLOCKER]
     → CollectionReference [UNDOCUMENTED] — Missing in RN Firebase
     → snapshotEqual [UNDOCUMENTED] — Different shape

CHECK 5 — Native SDK versions (informational)
  iOS Firebase SDK:      12.12.0
  Android Firebase SDK:  34.12.0
  JS firebase npm:       12.12.0

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  RESULT:  ✗ BLOCKED — 2 issue(s) must be resolved before releasing

  Blockers:
    1. packages/auth — missing CHANGELOG entry for v<RELEASE_VERSION>
    2. API drift — 2 undocumented differences in firestore
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Use ✓ (green), ✗ (red), ℹ (dim) for visual scanning.

If there are **zero blockers**, end with:

```
  RESULT:  ✓ CLEAR TO RELEASE v<RELEASE_VERSION>
```

---

### Step 8 — Offer to fix blockers

After printing the report, if there are blockers, ask:

> "Would you like me to fix any of these blockers now?
>
> - **CHANGELOG** — I can draft a CHANGELOG entry for the missing packages
>   based on `git log` output since the last release.
> - **API drift** — I can run `/api-drift` to resolve the undocumented
>   differences in `config.ts`.
> - **Version skew** — I can update mismatched `package.json` version fields
>   to match `lerna.json`.
>
> Reply with which blocker(s) to fix, or 'all' to fix everything."

Wait for the user's reply before making any changes.

---

## Key file locations

| File | Purpose |
|---|---|
| `lerna.json` | Canonical release version (`version` field) |
| `packages/app/package.json` | Native SDK versions (`sdkVersions`), JS peer dep anchor |
| `packages/<name>/package.json` | Per-package version + peer deps |
| `packages/<name>/CHANGELOG.md` | Must contain `## [<version>]` heading |
| `packages/<name>/*.podspec` | Reads version dynamically from `package.json` — no static check needed |
| `packages/<name>/android/build.gradle` | Reads version dynamically from `appPackageJson` — no static check needed |
| `.github/scripts/compare-types/` | API drift script (`yarn compare:types`) |

## Packages in scope

All 18 packages under `packages/`:
`ai`, `analytics`, `app`, `app-check`, `app-distribution`, `auth`,
`crashlytics`, `database`, `firestore`, `functions`, `in-app-messaging`,
`installations`, `messaging`, `ml`, `perf`, `remote-config`, `storage`,
`vertexai`
