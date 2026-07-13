import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getReaderArchivePanelModel, getReaderToolbarGroups, isReaderMobileViewport } from './readerUiState.js';

test('reader toolbar has stable merged control groups', () => {
  assert.deepEqual(getReaderToolbarGroups(false), {
    left: ['← 返回', '归档列表'],
    right: ['沉浸模式', '设为封面', '阅读设定', '缩略面板'],
  });
  assert.deepEqual(getReaderToolbarGroups(true), {
    left: ['', ''],
    right: ['', '', '', ''],
  });
});

test('reader detects mobile layout on first render', () => {
  assert.equal(isReaderMobileViewport(390, false), true);
  assert.equal(isReaderMobileViewport(1440, true), true);
  assert.equal(isReaderMobileViewport(1440, false), false);
});

test('archive panel model selects matching behavior', () => {
  const removeHistory = () => 'history';
  const removeWatchlist = () => 'watchlist';
  const sources = {
    historyItems: [{ id: 'h' }], watchlistItems: [{ id: 'w' }],
    historyEmptyMessage: '暂无阅读历史', watchlistEmptyMessage: '暂无待看归档',
    removeHistory, removeWatchlist,
  };
  assert.deepEqual(getReaderArchivePanelModel('history', sources), {
    type: 'history', title: '阅读历史', items: [{ id: 'h' }],
    emptyMessage: '暂无阅读历史', onDelete: removeHistory,
  });
  assert.deepEqual(getReaderArchivePanelModel('watchlist', sources), {
    type: 'watchlist', title: '待看归档', items: [{ id: 'w' }],
    emptyMessage: '暂无待看归档', onDelete: removeWatchlist,
  });
});

test('bulk archive actions live in the expandable second row', () => {
  const source = readFileSync(new URL('../pages/Home.jsx', import.meta.url), 'utf8');
  const header = source.indexOf('archive-toolbar-primary');
  const actions = source.indexOf('archive-selection-actions');
  assert.ok(header >= 0 && actions > header);
  assert.match(source, /aria-hidden=\{!archiveSelectionMode\}/);
});
