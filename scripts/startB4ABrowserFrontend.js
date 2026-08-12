import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readB4ABrowserBuildAttestation } from './b4aBrowserPreviewAttestation.js';
import {
  listeningB4ABrowserProcessIds,
  verifyB4ABrowserFunctionsReadiness,
} from './b4aBrowserFunctionsReadiness.js';
import {
  B4A_BROWSER_PROJECT_ID,
  assertBrowserPreviewEnvironment,
  assertBrowserPreviewViteEnvironment,
  browserPreviewPaths,
} from './b4aBrowserPreviewConfig.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = browserPreviewPaths(projectRoot);
assertBrowserPreviewEnvironment(process.env);
assertBrowserPreviewViteEnvironment(process.env);
await verifyB4ABrowserFunctionsReadiness({
  paths,
  listeningProcessIds: listeningB4ABrowserProcessIds,
});
readB4ABrowserBuildAttestation(paths.buildAttestation);
const assets = path.join(projectRoot, 'dist', 'assets');
if (!fs.existsSync(assets)) throw new Error('B4A_PREVIEW_EMULATOR_BUILD_REQUIRED');
const bundle = fs.readdirSync(assets)
  .filter((name) => name.endsWith('.js'))
  .map((name) => fs.readFileSync(path.join(assets, name), 'utf8'))
  .join('\n');
for (const evidence of ['LOCAL FIREBASE EMULATOR PREVIEW', B4A_BROWSER_PROJECT_ID, '127.0.0.1', '9099', '8080', '5001']) {
  if (!bundle.includes(evidence)) throw new Error('B4A_PREVIEW_EMULATOR_BUILD_EVIDENCE_MISSING');
}

const viteCli = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const child = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
});
let interrupted = false;
process.on('SIGINT', () => {
  interrupted = true;
  console.log('Waiting for the local preview server to stop...');
});
const status = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code) => resolve(code));
});
process.exitCode = interrupted && status === null ? 130 : (status ?? 1);
