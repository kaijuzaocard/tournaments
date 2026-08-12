import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  B4A_BROWSER_ENV_FILE_CONTENT,
  B4A_BROWSER_PROJECT_ID,
  B4A_BROWSER_SECRET_FILE_CONTENT,
  assertBrowserPreviewEnvironment,
  browserPreviewPaths,
} from './b4aBrowserPreviewConfig.js';
import { deleteB4APreviewAdminFixture } from './b4aBrowserPreviewAuthFixture.js';
import { listeningB4ABrowserProcessIds } from './b4aBrowserFunctionsReadiness.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = browserPreviewPaths(projectRoot);
assertBrowserPreviewEnvironment(process.env);

function removeOwnedFile(file, expectedContent) {
  if (!fs.existsSync(file)) return;
  if (fs.readFileSync(file, 'utf8') !== expectedContent) {
    throw new Error(`Refusing to remove a local file not created by the B4A preview harness: ${file}`);
  }
  fs.rmSync(file);
}

const dataCleanupErrors = [];
if (!process.argv.includes('--files-only')) {
  const requireFromFunctions = createRequire(path.join(projectRoot, 'functions', 'package.json'));
  const { deleteApp, initializeApp } = requireFromFunctions('firebase-admin/app');
  const { getAuth } = requireFromFunctions('firebase-admin/auth');
  const { getFirestore } = requireFromFunctions('firebase-admin/firestore');
  const app = initializeApp({ projectId: B4A_BROWSER_PROJECT_ID }, `b4a-browser-cleanup-${Date.now()}`);
  try {
    const db = getFirestore(app);
    await db.recursiveDelete(db.collection('artifacts'));
  } catch (error) {
    dataCleanupErrors.push(error);
  }
  try {
    await deleteB4APreviewAdminFixture(getAuth(app));
  } catch (error) {
    dataCleanupErrors.push(error);
  } finally {
    await deleteApp(app);
  }
}

fs.rmSync(paths.manifest, { force: true });
fs.rmSync(paths.functionsReadiness, { force: true });
removeOwnedFile(paths.secretOverride, B4A_BROWSER_SECRET_FILE_CONTENT);
removeOwnedFile(paths.parameterOverride, B4A_BROWSER_ENV_FILE_CONTENT);
if (process.argv.includes('--files-only')) {
  if (Object.keys(listeningB4ABrowserProcessIds()).length) {
    throw new Error('B4A_PREVIEW_FILES_CLEANUP_REQUIRES_STOPPED_LISTENERS');
  }
  fs.rmSync(paths.processState, { force: true });
  fs.rmSync(paths.functionsLog, { force: true });
}
console.log('B4A Browser Preview local files cleaned.');
if (dataCleanupErrors.length) throw dataCleanupErrors[0];
