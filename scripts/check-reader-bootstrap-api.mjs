import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8');

assert.match(
  source,
  /getArchiveFiles:\s*\(id, options = \{\}\)\s*=>\s*request\(`\/archives\/\$\{id\}\/files`,\s*'GET',\s*null,\s*options\)/,
  'archive file manifest must forward request options',
);
assert.match(
  source,
  /extractArchive:\s*\(id, options = \{\}\)\s*=>\s*request\(`\/archives\/\$\{id\}\/extract`,\s*'POST',\s*null,\s*options\)/,
  'archive extraction must forward request options',
);

console.log('Reader bootstrap API checks passed');
