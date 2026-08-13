import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listeningB4ABrowserProcessIds,
  verifyB4ABrowserFunctionsReadiness,
} from './b4aBrowserFunctionsReadiness.js';
import {
  assertBrowserPreviewEnvironment,
  browserPreviewPaths,
} from './b4aBrowserPreviewConfig.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assertBrowserPreviewEnvironment(process.env);
await verifyB4ABrowserFunctionsReadiness({
  paths: browserPreviewPaths(projectRoot),
  listeningProcessIds: listeningB4ABrowserProcessIds,
});
console.log('B4A Browser Functions readiness verified.');
