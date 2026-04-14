# /api-drift

Detect and resolve type-signature drift between the `firebase-js-sdk` and
`@react-native-firebase/*` packages by running the compare-types script,
analysing every failure, and updating the affected `config.ts` files.

---

## Intent

Every time the `firebase` npm package is upgraded, or RN Firebase types are
changed, new drift can appear between the two APIs. This skill runs the full
comparison, classifies each failure, drafts the precise `config.ts` entries
needed to document intentional differences, removes stale entries that are no
longer needed, and re-runs to confirm a clean result — all in one command.

---

## How the comparison works (context for the agent)

The script at `.github/scripts/compare-types/` parses `.d.ts` files from both
sides using ts-morph and diffs their exported type shapes:

- **Left side (SDK):** resolved at runtime from
  `node_modules/firebase/<subpackage>/dist/index.d.ts` via the `firebase`
  package's own exports map. The version compared always matches what is
  installed — i.e. the version pinned in `packages/app/package.json`.
- **Right side (RN Firebase):** compiled `dist/typescript/lib/` output from
  each `@react-native-firebase/*` package.

Four packages are currently registered:

| Registry name | Firebase export key | Config file |
|---|---|---|
| `ai` | `ai` | `.github/scripts/compare-types/packages/ai/config.ts` |
| `firestore` | `firestore` | `.github/scripts/compare-types/packages/firestore/config.ts` |
| `firestore-pipelines` | `firestore/pipelines` | `.github/scripts/compare-types/packages/firestore-pipelines/config.ts` |
| `remote-config` | `remote-config` | `.github/scripts/compare-types/packages/remote-config/config.ts` *(inactive)* |

Each difference falls into one of three categories:

| Category | Meaning | Config array |
|---|---|---|
| **Missing in RN Firebase** | SDK exports it, RN does not | `missingInRN` |
| **Extra in RN Firebase** | RN exports it, SDK does not | `extraInRN` |
| **Different shape** | Same name, different signature/members | `differentShape` |

A difference is a **CI blocker** if it has no entry in the package's
`config.ts`. An entry in `config.ts` is a **CI blocker** if the API now
matches (stale entry).

---

## Repeatable workflow

### Step 1 — Verify prerequisites

**Firebase JS SDK types (left side):**

Check that `node_modules/firebase/package.json` exists at the repo root.
If it does not, run:

```bash
yarn install
```

Wait for completion before continuing.

**RN Firebase built types (right side):**

Check for the presence of these sentinel files:

- `packages/ai/dist/typescript/lib/index.d.ts`
- `packages/firestore/dist/typescript/lib/types/firestore.d.ts`
- `packages/firestore/dist/typescript/lib/pipelines/index.d.ts`

If any are missing, tell the user:

> "One or more RN Firebase packages have not been built yet.
> Run `yarn build:all:build` from the repo root, then invoke `/api-drift` again."

Stop here until the user confirms the build is complete.

---

### Step 2 — Run the comparison

```bash
yarn compare:types
```

Capture the complete stdout output and the exit code.

If exit code is **0**: report success and stop.

> "✓ `yarn compare:types` exits cleanly. No undocumented drift and no stale
> config entries across all registered packages."

---

### Step 3 — Parse every failure from the output

Scan the captured output. For each package header (`📦 <name>`) collect:

**Undocumented differences** — lines containing `[UNDOCUMENTED]`:

```
  ✗ <exportName> [UNDOCUMENTED]  — (no reason shown)
     sdk: <sdkShape>
     rn:  <rnShape>              ← only present for "Different shape" entries
```

**Stale config entries** — lines containing `[STALE]`:

```
  ✗ <exportName> [STALE]  — now matches the firebase-js-sdk; remove from config.ts
```

Build a structured failure list:

```
undocumentedMissing:    { package, exportName }[]
undocumentedExtra:      { package, exportName }[]
undocumentedDifferent:  { package, exportName, sdkShape, rnShape }[]
staleMissing:           { package, exportName }[]
staleExtra:             { package, exportName }[]
staleDifferent:         { package, exportName }[]
```

Print a concise summary before proposing changes:

```
Package               Undocumented   Stale
──────────────────────────────────────────
ai                         2             0
firestore                  1             3
firestore-pipelines        0             1
──────────────────────────────────────────
Total                      3             4
```

---

### Step 4 — Read the affected config files

For each package that has failures, read its config file now:

```
.github/scripts/compare-types/packages/ai/config.ts
.github/scripts/compare-types/packages/firestore/config.ts
.github/scripts/compare-types/packages/firestore-pipelines/config.ts
```

Study the existing entries for tone and detail level. All `reason` strings in
this repo follow a consistent style: one or two plain-English sentences
explaining *why* the difference exists, referencing the platform limitation or
deliberate design decision. Use the existing entries as style guides.

---

### Step 5 — Draft all config.ts changes

#### 5a — New entries for undocumented differences

For each undocumented item, draft a `KnownDifference` entry for the correct
array. Use this logic to write the `reason` field:

**Missing in RN Firebase (`missingInRN`):**

Ask: why would this export be absent from the React Native package?

- Is the export name or its shape a browser-only API? Common signals:
  - Uses `IndexedDB`, `Web Crypto`, `WebSocket`, `DOM`, `getUserMedia`, `Web Audio`
  - Has `Browser`, `Web`, `Chrome`, `Tab`, `Window` in the name
  - Is marked `@deprecated` and relates to web-specific persistence (e.g. `enableIndexedDbPersistence`)
  → Reason: "Web-specific API — [brief description]. Not applicable to React Native."

- Is it a Chrome on-device / hybrid inference API?
  → Reason: "Chrome on-device AI adapter / hybrid inference is browser-only and not supported in React Native."

- Is it a type or options interface for one of the above?
  → Reason: "Options/type for the browser-only [parent API], which is intentionally not implemented in React Native."

- Does it require a capability React Native does not expose natively?
  → Reason: "Requires [specific capability] which is not available in React Native."

- Is it simply not yet implemented?
  → Reason: "Not yet implemented in RN Firebase."

**Extra in RN Firebase (`extraInRN`):**

Ask: why would this export exist in RN but not in the web SDK?

- Legacy namespaced API kept for backwards compatibility:
  → Reason: "Legacy namespaced API retained for backwards compatibility. No equivalent in the modular firebase-js-sdk."

- RN-specific helper or platform convenience:
  → Reason: "React Native-specific [description]. No equivalent in the firebase-js-sdk."

- Type alias that wraps an SDK type for RN convenience:
  → Reason: "RN Firebase-specific type alias for [underlying type]. Provides [benefit]."

**Different shape (`differentShape`):**

Reference the `sdk:` and `rn:` lines from the output. Answer: what precisely
differs, and why does RN diverge?

- Return type differs (e.g. `Promise<null>` vs `Promise<void>`):
  → Reason: "Returns `<rnType>` instead of `<sdkType>` because the native module resolves with `<explanation>`."

- Parameter type differs:
  → Reason: "Accepts `<rnType>` instead of `<sdkType>` — [reason, e.g. 'the native bridge requires a serialisable value']."

- Member count or type differs in an interface:
  → Reason: "RN Firebase adds/omits [member] because [platform reason]."

- SDK uses a class, RN uses an interface (class boundary):
  → This is often already handled transparently by the comparator. Only document if the shapes actually differ in meaningful members.

#### 5b — Removals for stale entries

For each stale item, identify the exact `{ name: '...', reason: '...' }` object
literal (including its surrounding commas and blank lines) to remove from the
config array.

---

### Step 6 — Show proposed changes and confirm

Print all proposed edits in a readable diff-style block grouped by file:

```
── .github/scripts/compare-types/packages/ai/config.ts ──

  ADD to missingInRN (keep array sorted alphabetically by name):
  + {
  +   name: 'ChromeAdapter',
  +   reason:
  +     "Chrome on-device AI adapter is browser-specific and intentionally not " +
  +     "supported by React Native Firebase's AI package.",
  + },

  ADD to differentShape:
  + {
  +   name: 'generateContent',
  +   reason:
  +     'Returns Promise<null> instead of Promise<void> because the native module ' +
  +     'resolves with null.',
  + },

── .github/scripts/compare-types/packages/firestore/config.ts ──

  REMOVE from missingInRN:
  - {
  -   name: 'aggregateFieldEqual',
  -   reason: '...',
  - },
```

Ask:

> "Ready to apply these changes? Reply **yes** to apply all, **no** to cancel,
> or describe any adjustments to specific entries."

Wait for confirmation before writing any files.

---

### Step 7 — Apply the changes

Apply every addition and removal using the Edit tool, one config file at a time.

Formatting rules — match the existing file exactly:

- Trailing comma after every object property and after every array item.
- One blank line between entries within the same array.
- Keep entries sorted **alphabetically by `name`** within each array section.
- Multi-line `reason` strings: use string concatenation (`'...' + '...'`) to
  stay within ~100 characters per line, matching the style of long existing
  entries.
- Do not reorder, reformat, or touch any section you are not adding to or
  removing from.

---

### Step 8 — Verify

Re-run the comparison:

```bash
yarn compare:types
```

If exit code is **0**:

> "✓ All differences are now documented. `yarn compare:types` passes cleanly."

If it still fails, go back to Step 3 for the remaining items.

**Common reason for repeated failure:** The `name` field in a config entry must
exactly match the export name as shown in the script output — it is
case-sensitive. If the same export is still flagged after being added, re-read
the output carefully and correct the name.

---

## Config.ts shape reference

```typescript
import type { PackageConfig } from '../../src/types';

const config: PackageConfig = {
  // SDK export name → RN export name (when the export has been renamed)
  nameMapping: {
    // 'SdkName': 'RNFirebaseName',
  },

  // In firebase-js-sdk but absent from RN Firebase
  missingInRN: [
    {
      name: 'exportName',
      reason: 'Why this SDK export is absent from the RN package.',
    },
  ],

  // In RN Firebase but absent from firebase-js-sdk
  extraInRN: [
    {
      name: 'exportName',
      reason: 'Why this RN export has no firebase-js-sdk equivalent.',
    },
  ],

  // Present in both packages but with a different type signature
  differentShape: [
    {
      name: 'exportName',
      reason: 'What precisely differs and why RN diverges from the SDK.',
    },
  ],
};

export default config;
```

## Key file locations

| Purpose | Path |
|---|---|
| Script entry point | `.github/scripts/compare-types/src/index.ts` |
| Package registry + path resolution | `.github/scripts/compare-types/src/registry.ts` |
| Shape parsing logic | `.github/scripts/compare-types/src/parse.ts` |
| Diff + stale detection | `.github/scripts/compare-types/src/compare.ts` |
| Terminal report formatting | `.github/scripts/compare-types/src/report.ts` |
| TypeScript types for config schema | `.github/scripts/compare-types/src/types.ts` |
| Config — ai | `.github/scripts/compare-types/packages/ai/config.ts` |
| Config — firestore | `.github/scripts/compare-types/packages/firestore/config.ts` |
| Config — firestore-pipelines | `.github/scripts/compare-types/packages/firestore-pipelines/config.ts` |
| Config — remote-config *(inactive)* | `.github/scripts/compare-types/packages/remote-config/config.ts` |
| Firebase SDK types source | `node_modules/firebase/<subpackage>/dist/index.d.ts` |
| RN Firebase built types | `packages/<name>/dist/typescript/lib/` |
