import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveAppVersion } from '../scripts/app-version.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const packageVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

test('application version always uses package.json SemVer plus build SHA', () => {
  const resolved = resolveAppVersion({ cwd, hash: 'abcdef1234567890' });
  assert.equal(resolved.version, `v${packageVersion}+abcdef1`);
  assert.equal(resolved.buildId, `${packageVersion}-abcdef1`);
});

test('branch history cannot change application SemVer', () => {
  const resolved = resolveAppVersion({
    cwd,
    baseRef: 'missing-base',
    headRef: 'missing-head',
    hash: '1234567890abcdef',
  });
  assert.equal(resolved.version, `v${packageVersion}+1234567`);
  assert.equal(resolved.buildId, `${packageVersion}-1234567`);
});

test('Android workflow uses the shared application version resolver', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/android-apk.yml', import.meta.url), 'utf8');
  assert.match(workflow, /import \{ resolveAppVersion \} from '\.\/scripts\/app-version\.mjs'/);
  assert.match(workflow, /resolveAppVersion\(\{ cwd: process\.cwd\(\), hash: process\.env\.GITHUB_SHA \}\)/);
});
