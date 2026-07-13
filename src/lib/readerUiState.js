const DESKTOP_TOOLBAR = Object.freeze({
  left: Object.freeze(['← 返回', '快速跳转']),
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

export function shouldUseCompactReaderToolbar({
  isMobile,
  availableWidth,
  requiredWidth,
  tolerance = 8,
}) {
  if (isMobile) return true;
  if (!Number.isFinite(availableWidth) || !Number.isFinite(requiredWidth)) return false;
  return availableWidth < requiredWidth + tolerance;
}

export function isIosWebKitPlatform(userAgent = '', platform = '', maxTouchPoints = 0) {
  if (/iPad|iPhone|iPod/i.test(userAgent) || /iPad|iPhone|iPod/i.test(platform)) return true;
  return platform === 'MacIntel' && Number(maxTouchPoints) > 1;
}

export function getReaderArchivePanelModel(type, sources) {
  if (type === 'random') {
    return {
      type,
      title: '随机漫游',
      items: sources.randomItems,
      emptyMessage: sources.randomEmptyMessage,
      onDelete: null,
    };
  }
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
