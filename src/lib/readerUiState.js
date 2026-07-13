const DESKTOP_TOOLBAR = Object.freeze({
  left: Object.freeze(['← 返回', '归档列表']),
  right: Object.freeze(['沉浸模式', '设为封面', '阅读设定', '缩略面板']),
});

const MOBILE_TOOLBAR = Object.freeze({
  left: Object.freeze(['', '']),
  right: Object.freeze(['', '', '', '']),
});

export function getReaderToolbarGroups(isMobile) {
  return isMobile ? MOBILE_TOOLBAR : DESKTOP_TOOLBAR;
}

export function isReaderMobileViewport(width, hasTouch) {
  return width < 768 || hasTouch;
}

export function getReaderArchivePanelModel(type, sources) {
  if (type === 'watchlist') {
    return {
      type,
      title: '待看归档',
      items: sources.watchlistItems,
      emptyMessage: sources.watchlistEmptyMessage,
      onDelete: sources.removeWatchlist,
    };
  }
  return {
    type: 'history',
    title: '阅读历史',
    items: sources.historyItems,
    emptyMessage: sources.historyEmptyMessage,
    onDelete: sources.removeHistory,
  };
}
