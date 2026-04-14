# /api-drift — API Drift Review & Auto-Fix

Detect and resolve type-signature drift between the `firebase-js-sdk` and
`@react-native-firebase/*` packages by running the compare-types script,
analysing the output, and updating the affected `config.ts` files.

---

## When to use

Run this skill whenever:

- A new `firebase` npm version has been installed (version bumped in
  `packages/app/package.json` and `yarn install` has been run).
- A PR modifies types in any `@react-native-firebase/*` package.
- CI fails on the `compare:types` job and you need to triage the failures.
- You want a routine pre-release sanity check across all registered packages.

---

## Workflow

### Step 1 — Verify prerequisites

Check that both inputs to the comparison are available:

**Firebase JS SDK types (left side):**
Confirm `node_modules/firebase/package.json` exists at the repo root.
If it does not exist, run `yarn install` from the repo root and wait for it to
complete before continuing.

**RN Firebase built types (right side):**
Check for the presence of these sentinel files:
- `packages/ai/dist/typescript/lib/index.d.ts`
- `packages/firestore/dist/typescript/lib/types/firestore.d.ts`
- `packages/firestore/dist/typescript/lib/pipelines/index.d.ts`

If any are missing, tell the user:

> "The RN Firebase packages need to be compiled first. Run:
> `yarn build:all:build`
> then invoke `/api-drift` again."

Stop here — do not continue until the user confirms the build is done.

---

### Step 2 — Run the comparison

```
yarn compare:types
```

Capture the full stdout output. Record the exit code.

If the exit code is 0 and no failures appear in the output, report:

> "✓ No API drift detected. All differences across every registered package are
> documented in their config.ts files."

Stop here.

---

### Step 3 — Parse failures from the output

From the captured output, extract every line that contains `[UNDOCUMENTED]` or
`[STALE]`, together with the package header (`📦 <name>`) that preceded it.

Build a structured failure list:

```
undocumented_missing:       { package, exportName, sdkShape? }[]
undocumented_extra:         { package, exportName, rnShape? }[]
undocumented_different:     { package, exportName, sdkShape, rnShape }[]
stale_missing:              { package, exportName }[]
stale_extra:                { package, exportName }[]
stale_different_shape:      { package, exportName }[]
```

Print a concise summary table so the user can see the scope before changes are
made:

```
Package               Undocumented   Stale
──────────────────────────────────────────
ai                         3             0
firestore                  1             2
firestore-pipelines        0             1
──────────────────────────────────────────
Total                      4             3
```

---

### Step 4 — Propose config.ts changes

For each affected package, read its config file at:

```
.github/scripts/compare-types/packages/<package-name>/config.ts
```

#### 4a — New entries for undocumented differences

For each undocumented item, draft a `KnownDifference` entry:

```typescript
{
  name: '<exportName>',
  reason: '<generated reason>',
}
```

Write the `reason` by applying this logic:

| Category | Guidance for the reason |
|---|---|
| `missingInRN` | Is the export browser-only (Web Crypto, IndexedDB, DOM APIs, WebSockets, Chrome on-device)? Say so. Does it require a capability React Native doesn't expose natively? Say so. Otherwise flag it as "not yet implemented". |
| `extraInRN` | Is this a legacy/namespaced API kept for backwards compatibility? A platform-specific helper with no web equivalent? Describe it briefly. |
| `differentShape` | What specifically differs (return type, parameter count, a changed member)? Why does RN diverge — native module contract, null vs void, platform limitation? Reference the sdk/rn shapes shown in the output. |

When in doubt, look at the surrounding entries already in the same `config.ts`
to match the tone and level of detail.

#### 4b — Removals for stale entries

For each stale item, identify the exact object literal (including the trailing
comma if present) to remove from `config.ts`.

---

### Step 5 — Confirm before applying

Show the complete set of proposed edits grouped by file in a readable diff-style
block, for example:

```
── .github/scripts/compare-types/packages/ai/config.ts ──

  ADD to missingInRN:
  + {
  +   name: 'startAudioConversation',
  +   reason: 'Browser-only audio helper built on Web Audio / getUserMedia. No React Native equivalent.',
  + },

  REMOVE from differentShape:
  - {
  -   name: 'getGenerativeModel',
  -   reason: '...',
  - },
```

Ask:

> "Ready to apply these changes to config.ts? Reply **yes** to apply, or
> describe any adjustments you'd like first."

Wait for confirmation before writing any files.

---

### Step 6 — Apply the changes

Apply every addition and removal using the Edit tool, one file at a time.
Maintain the existing code style:
- Trailing commas on all object properties and array items.
- Blank line between entries in the same array.
- Keep entries sorted alphabetically by `name` within each array section.

---

### Step 7 — Verify the fix

Re-run the comparison:

```
yarn compare:types
```

If it exits 0:

> "✓ All differences are now documented. `yarn compare:types` passes cleanly."

If it still fails, repeat from Step 3 for the remaining items. If the same
items reappear as undocumented after being added to config, diagnose why —
the most common cause is a mis-typed `name` field (names are case-sensitive
and must match the firebase-js-sdk export exactly as shown in the script output).

---

## Key file locations

| Purpose | Path |
|---|---|
| Script entry point | `.github/scripts/compare-types/src/index.ts` |
| Package registry | `.github/scripts/compare-types/src/registry.ts` |
| Type shape comparison | `.github/scripts/compare-types/src/compare.ts` |
| Config — ai | `.github/scripts/compare-types/packages/ai/config.ts` |
| Config — firestore | `.github/scripts/compare-types/packages/firestore/config.ts` |
| Config — firestore-pipelines | `.github/scripts/compare-types/packages/firestore-pipelines/config.ts` |
| Config — remote-config | `.github/scripts/compare-types/packages/remote-config/config.ts` |
| Firebase SDK types (source) | `node_modules/firebase/<subpackage>/dist/index.d.ts` |
| RN Firebase built types | `packages/<name>/dist/typescript/lib/` |

## Config.ts shape reference

```typescript
const config: PackageConfig = {
  // SDK export name → RN export name (when renamed)
  nameMapping: { 'SdkName': 'RNName' },

  // In firebase-js-sdk but absent from RN Firebase
  missingInRN: [
    { name: 'exportName', reason: 'Why it is absent.' },
  ],

  // In RN Firebase but absent from firebase-js-sdk
  extraInRN: [
    { name: 'exportName', reason: 'Why it is extra.' },
  ],

  // Present in both but with a different type signature
  differentShape: [
    { name: 'exportName', reason: 'What specifically differs and why.' },
  ],
};
```
