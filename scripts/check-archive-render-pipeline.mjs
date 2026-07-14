import assert from 'node:assert/strict';
import fs from 'node:fs';

const home = fs.readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8');
const card = fs.readFileSync(new URL('../src/components/ArchiveCard.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

function section(start, end) {
  const startIndex = home.indexOf(start);
  const endIndex = home.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing section: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return home.slice(startIndex, endIndex);
}

assert.match(home, /const archiveAbortControllerRef = useRef\(null\)/);
assert.match(home, /archiveAbortControllerRef\.current\?\.abort\(\)/);
assert.match(home, /signal:\s*controller\.signal/);
assert.match(home, /if \(fetchSeq !== archiveFetchSeqRef\.current\) return false;[\s\S]*finally \{\s*if \(fetchSeq === archiveFetchSeqRef\.current\) \{/);
assert.match(home, /useEffect\(\(\) => \(\) => \{\s*archiveFetchSeqRef\.current \+= 1;\s*archiveRequestInFlightRef\.current = false;\s*archiveAbortControllerRef\.current\?\.abort\(\);\s*\}, \[\]\)/);

assert.doesNotMatch(section('const handleUntaggedCategoryClick', 'const clearFilter'), /doFetch\(/);
assert.doesNotMatch(section('const clearFilter', 'const handleSearch'), /doFetch\(/);
assert.doesNotMatch(section('const handleArchiveBrowseModeChange', 'const ehFavoriteCookieValid'), /doFetch\(/);

assert.match(home, /archiveBrowseStateRef\.current = \{/);
assert.match(home, /selectedCategory\?\.id/);
assert.match(home, /const \[selectedCategory, setSelectedCategory\] = useState\(\(\) => homeSnapshot\?\.selectedCategory \|\| null\)/);
assert.match(section('const buildHomeStateSnapshot', 'const saveCurrentHomeForNavigation'), /selectedCategory,/);
assert.match(home, /archiveLoadError/);
assert.match(home, /\|\$\{mode\}\|\$\{pageSize\}\|\$\{isPagedMode \? requestedPage : 'scroll'\}/);
assert.match(home, /const batchStart = isPagedMode \? getArchivePageStart\(nextPage, pageSize\) : \(isReset \? 0 : current\.startOffset\)/);
assert.doesNotMatch(home, /isReset \? 0 : startOffset/);
assert.match(home, /if \(background\) \{\s*setLoading\(false\);\s*setArchivesRefreshing\(true\);\s*\} else \{\s*setArchivesRefreshing\(false\);\s*setLoading\(true\);\s*\}/);
assert.match(home, /if \(isReset && isUntaggedMode && !background\) \{/);
assert.match(home, /loadingRef\.current = loading \|\| archivesRefreshing/);
assert.match(home, /if \(!isReset && archiveRequestInFlightRef\.current\) return false/);
assert.match(home, /!archiveRequestInFlightRef\.current/);
assert.match(home, /disabled=\{loading \|\| archivesRefreshing\}/);
assert.match(home, /archiveLoadError && archives\.length > 0/);

assert.doesNotMatch(css, /\.archive-grid\s*\{[^}]*grid-auto-flow:\s*dense/s);
assert.match(css, /\.archive-grid:not\(\.is-paged\)\s*\{[^}]*grid-auto-flow:\s*dense/s);
assert.doesNotMatch(home, /mutationObserver\.observe\(grid,\s*\{[^}]*subtree:\s*true/s);
assert.match(home, /mutationObserver\.observe\(item,\s*\{ attributes: true, attributeFilter: \['class'\] \}\)/);
assert.match(home, /mutationObserver\.disconnect\(\);\s*mutationObserver\.observe\(grid, \{ childList: true \}\);\s*observeCardClasses\(\)/);
assert.match(card, /const closeTimerRef = useRef\(null\)/);
assert.match(card, /if \(closeTimerRef\.current\) clearTimeout\(closeTimerRef\.current\)/);
