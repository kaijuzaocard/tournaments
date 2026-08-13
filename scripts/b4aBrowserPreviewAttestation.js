import fs from 'node:fs';
import {
  B4A_BROWSER_AUTH_ENDPOINT,
  B4A_BROWSER_FIRESTORE_ENDPOINT,
  B4A_BROWSER_FUNCTIONS_ENDPOINT,
  B4A_BROWSER_PROJECT_ID,
} from './b4aBrowserPreviewConfig.js';

export const B4A_BROWSER_BUILD_ATTESTATION = Object.freeze({
  schemaVersion: 1,
  mode: 'emulator',
  projectId: B4A_BROWSER_PROJECT_ID,
  authEndpoint: B4A_BROWSER_AUTH_ENDPOINT,
  firestoreEndpoint: B4A_BROWSER_FIRESTORE_ENDPOINT,
  functionsEndpoint: B4A_BROWSER_FUNCTIONS_ENDPOINT,
});

export function validateB4ABrowserBuildAttestation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('B4A_PREVIEW_BUILD_ATTESTATION_INVALID');
  }
  const expectedEntries = Object.entries(B4A_BROWSER_BUILD_ATTESTATION);
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedEntries.length
    || actualKeys.some((key) => !Object.hasOwn(B4A_BROWSER_BUILD_ATTESTATION, key))) {
    throw new Error('B4A_PREVIEW_BUILD_ATTESTATION_SHAPE_INVALID');
  }
  for (const [key, expected] of expectedEntries) {
    if (value[key] !== expected) throw new Error(`B4A_PREVIEW_BUILD_ATTESTATION_${key.toUpperCase()}_INVALID`);
  }
  return Object.freeze({ ...value });
}

export function readB4ABrowserBuildAttestation(file) {
  if (!fs.existsSync(file)) throw new Error('B4A_PREVIEW_BUILD_ATTESTATION_REQUIRED');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('B4A_PREVIEW_BUILD_ATTESTATION_JSON_INVALID');
  }
  return validateB4ABrowserBuildAttestation(parsed);
}

export function writeB4ABrowserBuildAttestation(file) {
  fs.writeFileSync(file, `${JSON.stringify(B4A_BROWSER_BUILD_ATTESTATION, null, 2)}\n`, { flag: 'wx' });
  return B4A_BROWSER_BUILD_ATTESTATION;
}
