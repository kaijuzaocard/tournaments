import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertBrowserPreviewEnvironment, browserPreviewEnvironment } from './b4aBrowserPreviewConfig.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const targetArgs = process.argv.slice(3);
if (!target) throw new Error('B4A_PREVIEW_TARGET_SCRIPT_REQUIRED');
const targetPath = path.resolve(projectRoot, target);
if (!targetPath.startsWith(`${projectRoot}${path.sep}`)) throw new Error('B4A_PREVIEW_TARGET_OUTSIDE_PROJECT');

const env = browserPreviewEnvironment(process.env);
assertBrowserPreviewEnvironment(env);
const result = spawnSync(process.execPath, [targetPath, ...targetArgs], {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
