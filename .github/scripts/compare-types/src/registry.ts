/**
 * Package registry — defines which packages are compared and where to find
 * their type files.
 *
 * Firebase JS SDK types are resolved at runtime from the installed `firebase`
 * npm package (see `resolveFirebaseTypes`). No manual type snapshots are needed.
 *
 * To add a new package:
 *  1. Create .github/scripts/compare-types/packages/<name>/config.ts
 *     documenting any known differences.
 *  2. Add an entry to the `packages` array below, using `resolveFirebaseTypes`
 *     with the relevant firebase sub-path export key (e.g. "firestore").
 */

import fs from 'fs';
import path from 'path';
import type { PackageConfig } from './types';

import aiConfig from '../packages/ai/config';
import firestoreConfig from '../packages/firestore/config';
import firestorePipelinesConfig from '../packages/firestore-pipelines/config';

const SCRIPT_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');

// ---------------------------------------------------------------------------
// Firebase package resolution
// ---------------------------------------------------------------------------

/**
 * Finds the root directory of the installed `firebase` npm package.
 *
 * Checks the repo root and packages/app workspace node_modules in order,
 * to handle both hoisted and workspace-local installations.
 *
 * Throws a clear error if the package is not found so the user knows to run
 * `yarn install` before running the comparison script.
 */
function findFirebaseRoot(): string {
  const candidates = [
    path.join(REPO_ROOT, 'node_modules', 'firebase'),
    path.join(REPO_ROOT, 'packages', 'app', 'node_modules', 'firebase'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
  }

  throw new Error(
    'Could not find the `firebase` package in node_modules.\n' +
    'Run `yarn install` from the repo root first, then re-run `yarn compare:types`.',
  );
}

/**
 * Recursively searches a package.json export entry object for a `types` or
 * `typings` field, following conditional export nesting
 * (e.g. `{ browser: { types: "..." }, default: { types: "..." } }`).
 */
function findTypesField(entry: unknown): string | null {
  if (typeof entry === 'string') return null;
  if (typeof entry !== 'object' || entry === null) return null;

  const obj = entry as Record<string, unknown>;

  if (typeof obj['types'] === 'string') return obj['types'];
  if (typeof obj['typings'] === 'string') return obj['typings'];

  for (const value of Object.values(obj)) {
    const found = findTypesField(value);
    if (found) return found;
  }

  return null;
}

/**
 * Resolves the absolute path to the `.d.ts` types file for a given firebase
 * sub-path export key (e.g. `"ai"`, `"firestore"`, `"firestore/pipelines"`).
 *
 * Reads the `exports` map from the installed `firebase/package.json` and
 * extracts the `types` field for the requested export entry.
 *
 * The firebase version is determined by whatever is installed in node_modules,
 * which tracks the version pinned in `packages/app/package.json`.
 */
function resolveFirebaseTypes(exportKey: string): string {
  const firebaseRoot = findFirebaseRoot();
  const pkgJsonPath = path.join(firebaseRoot, 'package.json');

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as {
    version?: string;
    exports?: Record<string, unknown>;
  };

  const entry = pkg.exports?.[`./${exportKey}`];
  if (!entry) {
    throw new Error(
      `firebase@${pkg.version ?? '?'} has no "./${exportKey}" export.\n` +
      `Check the exports map in ${pkgJsonPath}`,
    );
  }

  const typesRelPath = findTypesField(entry);
  if (!typesRelPath) {
    throw new Error(
      `No "types" field found in the "./${exportKey}" export entry of firebase@${pkg.version ?? '?'}.\n` +
      `Export entry: ${JSON.stringify(entry, null, 2)}`,
    );
  }

  return path.join(firebaseRoot, typesRelPath);
}

export interface PackageEntry {
  /** Short name used in reports (e.g. "remote-config"). */
  name: string;
  /**
   * Paths to the firebase-js-sdk public type files (.d.ts).
   * Resolved at runtime from the installed `firebase` npm package via
   * `resolveFirebaseTypes()`. Exports from all files are merged (first file
   * wins for duplicate names).
   */
  firebaseSdkTypesPaths: string[];
  /**
   * The primary modular .d.ts files from the built RN Firebase package,
   * listed in priority order (first file's exports take precedence).
   */
  rnFirebaseModularFiles: string[];
  /**
   * Additional .d.ts files added to the ts-morph project so that re-export
   * chains can be resolved. Their exports are NOT compared directly.
   */
  rnFirebaseSupportFiles: string[];
  /** Documented known differences for this package. */
  config: PackageConfig;
}

function rnDist(packageName: string): string {
  return path.join(
    REPO_ROOT,
    'packages',
    packageName,
    'dist',
    'typescript',
    'lib',
  );
}

export const packages: PackageEntry[] = [
  // {
  //   name: 'remote-config',
  //   firebaseSdkTypesPaths: [
  //     resolveFirebaseTypes('remote-config'),
  //   ],
  //   rnFirebaseModularFiles: [
  //     path.join(rnDist('remote-config'), 'types', 'modular.d.ts'),
  //     path.join(rnDist('remote-config'), 'modular.d.ts'),
  //   ],
  //   rnFirebaseSupportFiles: [
  //     path.join(rnDist('remote-config'), 'statics.d.ts'),
  //     path.join(rnDist('remote-config'), 'types', 'namespaced.d.ts'),
  //     path.join(rnDist('remote-config'), 'types', 'internal.d.ts'),
  //   ],
  //   config: remoteConfigConfig,
  // },
  {
    name: 'ai',
    firebaseSdkTypesPaths: [
      resolveFirebaseTypes('ai'),
    ],
    rnFirebaseModularFiles: [
      path.join(rnDist('ai'), 'index.d.ts'),
    ],
    rnFirebaseSupportFiles: [
      path.join(rnDist('ai'), 'backend.d.ts'),
      path.join(rnDist('ai'), 'errors.d.ts'),
      path.join(rnDist('ai'), 'public-types.d.ts'),
      path.join(rnDist('ai'), 'methods', 'chat-session.d.ts'),
      path.join(rnDist('ai'), 'methods', 'live-session.d.ts'),
      path.join(rnDist('ai'), 'models', 'index.d.ts'),
      path.join(rnDist('ai'), 'models', 'ai-model.d.ts'),
      path.join(rnDist('ai'), 'models', 'generative-model.d.ts'),
      path.join(rnDist('ai'), 'models', 'imagen-model.d.ts'),
      path.join(rnDist('ai'), 'models', 'live-generative-model.d.ts'),
      path.join(rnDist('ai'), 'models', 'template-generative-model.d.ts'),
      path.join(rnDist('ai'), 'models', 'template-imagen-model.d.ts'),
      path.join(rnDist('ai'), 'requests', 'imagen-image-format.d.ts'),
      path.join(rnDist('ai'), 'requests', 'schema-builder.d.ts'),
      path.join(rnDist('ai'), 'types', 'index.d.ts'),
      path.join(rnDist('ai'), 'types', 'content.d.ts'),
      path.join(rnDist('ai'), 'types', 'enums.d.ts'),
      path.join(rnDist('ai'), 'types', 'error.d.ts'),
      path.join(rnDist('ai'), 'types', 'googleai.d.ts'),
      path.join(rnDist('ai'), 'types', 'live-responses.d.ts'),
      path.join(rnDist('ai'), 'types', 'requests.d.ts'),
      path.join(rnDist('ai'), 'types', 'responses.d.ts'),
      path.join(rnDist('ai'), 'types', 'schema.d.ts'),
      path.join(rnDist('ai'), 'types', 'imagen', 'index.d.ts'),
      path.join(rnDist('ai'), 'types', 'imagen', 'requests.d.ts'),
      path.join(rnDist('ai'), 'types', 'imagen', 'responses.d.ts'),
    ],
    config: aiConfig,
  },
  {
    name: 'firestore',
    firebaseSdkTypesPaths: [
      resolveFirebaseTypes('firestore'),
    ],
    rnFirebaseModularFiles: [
      path.join(rnDist('firestore'), 'types', 'firestore.d.ts'),
      path.join(rnDist('firestore'), 'modular.d.ts'),
      path.join(rnDist('firestore'), 'modular', 'query.d.ts'),
      path.join(rnDist('firestore'), 'modular', 'snapshot.d.ts'),
      path.join(rnDist('firestore'), 'modular', 'Bytes.d.ts'),
      path.join(rnDist('firestore'), 'modular', 'FieldPath.d.ts'),
      path.join(rnDist('firestore'), 'modular', 'FieldValue.d.ts'),
      path.join(rnDist('firestore'), 'modular', 'GeoPoint.d.ts'),
      path.join(rnDist('firestore'), 'modular', 'Timestamp.d.ts'),
      path.join(rnDist('firestore'), 'modular', 'VectorValue.d.ts'),
    ],
    rnFirebaseSupportFiles: [
      path.join(rnDist('firestore'), 'types', 'namespaced.d.ts'),
      path.join(rnDist('firestore'), 'types', 'internal.d.ts'),
      path.join(rnDist('firestore'), 'FirestoreAggregate.d.ts'),
      path.join(rnDist('firestore'), 'FirestoreFilter.d.ts'),
      path.join(rnDist('firestore'), 'FirestoreBlob.d.ts'),
      path.join(rnDist('firestore'), 'FirestoreDocumentSnapshot.d.ts'),
      path.join(rnDist('firestore'), 'FirestoreQuerySnapshot.d.ts'),
      path.join(rnDist('firestore'), 'FirestoreSnapshotMetadata.d.ts'),
      path.join(rnDist('firestore'), 'FirestoreGeoPoint.d.ts'),
      path.join(rnDist('firestore'), 'FirestoreTimestamp.d.ts'),
      path.join(rnDist('firestore'), 'FirestoreVectorValue.d.ts'),
      path.join(rnDist('firestore'), 'FirestorePersistentCacheIndexManager.d.ts'),
      path.join(rnDist('firestore'), 'LoadBundleTask.d.ts'),
      path.join(rnDist('firestore'), 'FirestoreWriteBatch.d.ts'),
      path.join(rnDist('firestore'), 'FieldPath.d.ts'),
      path.join(rnDist('firestore'), 'FieldValue.d.ts'),
    ],
    config: firestoreConfig,
  },
  {
    name: 'firestore-pipelines',
    firebaseSdkTypesPaths: [
      resolveFirebaseTypes('firestore/pipelines'),
    ],
    rnFirebaseModularFiles: [
      path.join(rnDist('firestore'), 'pipelines', 'index.d.ts'),
    ],
    rnFirebaseSupportFiles: [
      path.join(rnDist('firestore'), 'pipelines', 'expressions.d.ts'),
      path.join(rnDist('firestore'), 'pipelines', 'pipeline.d.ts'),
      path.join(rnDist('firestore'), 'pipelines', 'pipeline-result.d.ts'),
      path.join(rnDist('firestore'), 'pipelines', 'pipeline-source.d.ts'),
      path.join(rnDist('firestore'), 'pipelines', 'pipeline_impl.d.ts'),
      path.join(rnDist('firestore'), 'pipelines', 'pipeline_options.d.ts'),
      path.join(rnDist('firestore'), 'pipelines', 'stage_options.d.ts'),
      path.join(rnDist('firestore'), 'pipelines', 'types.d.ts'),
    ],
    config: firestorePipelinesConfig,
  },
];
