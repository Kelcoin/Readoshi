import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_VERSION = '1.0.0';

function runGit(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function parseVersion(version) {
  const match = String(version || '').match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [1, 0, 0];
  return match.slice(1).map(Number);
}

function readPackageVersion(cwd, ref = '') {
  if (ref) {
    const content = runGit(['show', `${ref}:package.json`], cwd);
    if (content) {
      try { return JSON.parse(content).version || DEFAULT_VERSION; } catch {}
    }
  }
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).version || DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
}

export function classifySemverBump(files = [], messages = []) {
  const joinedMessages = messages.join('\n');
  if (/(BREAKING CHANGE|^[a-z]+(?:\([^)]+\))?!:)/m.test(joinedMessages)) return 'major';
  if (files.some(file => /^(src\/|public\/|worker\.js$|vite\.config\.js$|Dockerfile$|nginx\.conf|scripts\/)/.test(file.replace(/\\/g, '/')))) return 'minor';
  return files.length ? 'patch' : 'patch';
}

export function bumpVersion(version, bump) {
  const [major, minor, patch] = parseVersion(version);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function resolveAppVersion({
  cwd = process.cwd(),
  baseRef = 'main',
  headRef = 'dev',
  hash = process.env.VITE_GIT_SHA || process.env.GITHUB_SHA || '',
} = {}) {
  const baseVersion = readPackageVersion(cwd, baseRef);
  const diffFiles = runGit(['diff', '--name-only', `${baseRef}...${headRef}`], cwd)
    || runGit(['diff', '--name-only', `${baseRef}..HEAD`], cwd);
  const messages = runGit(['log', '--format=%s', `${baseRef}..${headRef}`], cwd)
    || runGit(['log', '--format=%s', `${baseRef}..HEAD`], cwd);
  const shortHash = (hash || runGit(['rev-parse', '--short=7', 'HEAD'], cwd) || 'dev').slice(0, 7);
  const files = diffFiles ? diffFiles.split(/\r?\n/).filter(Boolean) : [];
  const bump = classifySemverBump(files, messages ? messages.split(/\r?\n/).filter(Boolean) : []);
  return {
    version: `v${bumpVersion(baseVersion, bump)}+${shortHash}`,
    buildId: `${bumpVersion(baseVersion, bump)}-${shortHash}`,
    bump,
    files,
  };
}
