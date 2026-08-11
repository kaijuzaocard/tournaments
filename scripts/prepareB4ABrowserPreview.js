import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  B4A_BROWSER_ENV_FILE_CONTENT,
  B4A_BROWSER_SECRET_FILE_CONTENT,
  assertBrowserPreviewEnvironment,
  browserPreviewPaths,
} from './b4aBrowserPreviewConfig.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = browserPreviewPaths(projectRoot);
assertBrowserPreviewEnvironment(process.env);

if (fs.existsSync(paths.secretOverride) || fs.existsSync(paths.parameterOverride)) {
  throw new Error('Refusing to overwrite an existing Functions emulator override file.');
}
if (fs.existsSync(paths.processState)) {
  throw new Error('B4A preview process state exists; run npm run stop:browser before preparing again.');
}

let secretCreated = false;
try {
  fs.writeFileSync(paths.secretOverride, B4A_BROWSER_SECRET_FILE_CONTENT, { flag: 'wx' });
  secretCreated = true;
  fs.writeFileSync(paths.parameterOverride, B4A_BROWSER_ENV_FILE_CONTENT, { flag: 'wx' });
  console.log('B4A Browser Preview local Functions overrides prepared.');
} catch (error) {
  if (secretCreated) fs.rmSync(paths.secretOverride, { force: true });
  throw error;
}
