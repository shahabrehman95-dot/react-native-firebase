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
