import assert from 'node:assert/strict';
import fs from 'node:fs';

const home = fs.readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8');
const reader = fs.readFileSync(new URL('../src/pages/Reader.jsx', import.meta.url), 'utf8');
const recommendations = fs.readFileSync(new URL('../src/components/Recommendations.jsx', import.meta.url), 'utf8');

assert.doesNotMatch(
  home,
  /lastFetchedFilterRef\.current = filterKey;\s*lastFetchedRef\.current = now;\s*archiveRequestInFlightRef\.current = true;/,
  'archive freshness must not be recorded before a request starts',
);
assert.equal((home.match(/markArchiveFetchCompleted\(\);/g) || []).length, 3, 'every successful archive result path must record freshness');

assert.match(reader, /const \[showLoadingStatus, setShowLoadingStatus\] = useState\(false\)/);
assert.match(reader, /setTimeout\(\(\) => setShowLoadingStatus\(true\), 160\)/);
assert.match(reader, /return \(\) => clearTimeout\(timer\)/);
assert.match(reader, /loadState === 'error' \|\| showLoadingStatus/);
assert.match(reader, /clamp\(18px, 2\.2vw, 28px\)/);
assert.match(reader, /clamp\(13px, 1\.4vw, 18px\)/);

assert.match(recommendations, /className="btn"[\s\S]*onClick=\{refreshCache\}[\s\S]*disabled=\{loading\}/);
assert.match(recommendations, /\{loading \? '刷新中' : '刷新'\}/);
assert.doesNotMatch(recommendations, /title="清理缓存并刷新">\s*<svg/);

console.log('loading state and refresh checks passed');
