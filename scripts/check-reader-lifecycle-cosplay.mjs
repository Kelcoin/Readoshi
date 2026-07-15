import assert from 'node:assert/strict';
import fs from 'node:fs';
import { categorizeTags } from '../src/lib/tags.js';

const reader = fs.readFileSync(new URL('../src/pages/Reader.jsx', import.meta.url), 'utf8');
const recommendations = fs.readFileSync(new URL('../src/components/Recommendations.jsx', import.meta.url), 'utf8');
const home = fs.readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

const groups = categorizeTags([
  'artist:a',
  'uploader:u',
  'date_added:1',
  'timestamp:2',
  'source:example.test',
  'cosplayer:c',
  'custom:value',
]);
assert.deepEqual(
  groups.map(({ ns }) => ns).slice(-4),
  ['uploader', 'date_added', 'timestamp', 'source'],
  'archive metadata namespaces must stay at bottom',
);
assert.ok(groups.findIndex(({ ns }) => ns === 'cosplayer') < groups.findIndex(({ ns }) => ns === 'uploader'));
assert.ok(groups.findIndex(({ ns }) => ns === 'custom') < groups.findIndex(({ ns }) => ns === 'uploader'));

assert.match(reader, /const PageImage[\s\S]*?useLayoutEffect\(\(\) => \{/);
assert.doesNotMatch(reader, /if \(!imgSrc \|\| loadState !== 'ready'\) \{/);
assert.match(reader, /const imageAlreadyReady =/);
assert.match(reader, /ref=\{swipeContainerRef\}[\s\S]*?immersivePagePending[\s\S]*?ref=\{zoomWrapperRef\}/);
assert.match(reader, /const readerCleanupTimersRef = useRef\(new Set\(\)\)/);
assert.match(reader, /releaseReaderImageElements/);
assert.match(reader, /const detectorImages = new Map\(\)/);
assert.match(reader, /reject\(new DOMException\('Reader unmounted', 'AbortError'\)\)/);
assert.match(reader, /formatArchiveSize/);
assert.match(reader, /className="reader-archive-summary"/);

assert.match(recommendations, /const isCosplayWithCosplayer =/);
assert.match(recommendations, /const sameCreatorTags =/);
assert.match(recommendations, /const sameCreatorLabel = isCosplayWithCosplayer \? '同Coser' : '同作者'/);
assert.match(recommendations, /sameCreatorType/);
assert.match(recommendations, /buildSameCreator/);
assert.doesNotMatch(recommendations, /transition:\s*'all/);

assert.match(home, /className="archive-category-list"/);
assert.match(home, /className="btn archive-category-button"/);
assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.archive-category-list/);
assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.archive-category-button\s*\{[\s\S]*?min-height:\s*36px/);
assert.match(css, /@media \(hover: none\)[\s\S]*?\.archive-category-button:hover:not\(:disabled\)/);
assert.match(css, /@media \(hover: none\)[\s\S]*?background:\s*var\(--button-bg\)/);
assert.match(css, /@media \(hover: none\)[\s\S]*?transform:\s*none/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.archive-category-button/);
assert.match(css, /\[data-ios="true"\] \.reader-content-fade-in\s*\{[^}]*animation:\s*none/);

console.log('reader lifecycle and cosplay checks passed');
