import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeB4ABrowserBuildAttestation } from './b4aBrowserPreviewAttestation.js';
import {
  assertBrowserPreviewViteEnvironment,
  browserPreviewPaths,
  browserPreviewViteEnvironment,
} from './b4aBrowserPreviewConfig.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = browserPreviewPaths(projectRoot);
const env = browserPreviewViteEnvironment(process.env);
assertBrowserPreviewViteEnvironment(env);
fs.rmSync(paths.buildAttestation, { force: true });

const viteCli = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const result = spawnSync(process.execPath, [viteCli, 'build', '--mode', 'emulator'], {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

writeB4ABrowserBuildAttestation(paths.buildAttestation);
console.log(`B4A emulator build attested: ${paths.buildAttestation}`);
