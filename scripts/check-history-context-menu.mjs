import assert from 'node:assert/strict';
import fs from 'node:fs';

const historyPage = fs.readFileSync(new URL('../src/pages/HistoryPage.jsx', import.meta.url), 'utf8');

assert.match(historyPage, /import ArchiveContextMenu from/);
assert.match(historyPage, /onArchiveContextMenu=/);
assert.match(historyPage, /<ArchiveContextMenu/);
assert.match(historyPage, /onDelete=/);
assert.match(historyPage, /deleteArchiveWithFavoriteSync/);
assert.match(historyPage, /isArchiveMissingError\(error\)/);
assert.match(historyPage, /归档已不存在于 LANraragi，相关历史记录已清理。/);
assert.match(historyPage, /showCancel=\{false\}/);
assert.match(historyPage, /destructive=\{false\}/);

console.log('history context menu checks passed');
