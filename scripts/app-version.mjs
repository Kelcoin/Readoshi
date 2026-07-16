import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function runGit(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function readPackageVersion(cwd) {
  const version = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(version || ''))) {
    throw new Error('package.json version must be valid SemVer');
  }
  return version;
}

export function resolveAppVersion({
  cwd = process.cwd(),
  hash = process.env.VITE_GIT_SHA || process.env.GITHUB_SHA || '',
} = {}) {
  const packageVersion = readPackageVersion(cwd);
  const shortHash = (hash || runGit(['rev-parse', '--short=7', 'HEAD'], cwd) || 'dev').slice(0, 7);
  return {
    packageVersion,
    version: `v${packageVersion}+${shortHash}`,
    buildId: `${packageVersion}-${shortHash}`,
  };
}
