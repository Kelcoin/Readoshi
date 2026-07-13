import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { lrrApi } from '../lib/api';
import { flushHistorySync, getHistory, saveHistory, getHideRead, removeHistoryItem, loadHistoryState } from '../lib/history';
import { getWatchlist, loadWatchlistState, removeWatchlistItem } from '../lib/watchlist';
import { getReaderArchiveListMeta } from '../lib/readerArchiveList';
import { isArchiveMissingError } from '../lib/historyMaintenance';
import { translateTag, categorizeTags } from '../lib/tags';
import { getCachedImage, getImage, clearImageCache, primeImage } from '../lib/imageCache';
import { DEFAULT_READER_SETTINGS, READER_SETTINGS_KEY, normalizeReaderSettings, prepareReaderSettingsForArchiveChange } from '../lib/readerSettings';
import { getReaderSkeletonToolbarGroups } from '../lib/readerSkeletonLayout';
import {
  getReaderArchivePanelModel,
  isIosWebKitPlatform,
  isReaderMobileViewport,
  shouldUseCompactReaderToolbar,
} from '../lib/readerUiState';
import { computeContainedImageRect, rectsOverlap } from '../lib/pageIndicatorLayout';
import { classifyWebtoonSeams, compareSeamPixels, sampleImageSeam } from '../lib/webtoonDetector';
import { detectImageBorderInsets } from '../lib/readerImageTransform';
import { getWorkerUrl, getSyncToken } from '../lib/worker-config';
import { getBootState, markBackground, loadReaderSnapshot, saveReaderSnapshot } from '../lib/sessionState';
import { getStoredServerInfo, loadServerInfo } from '../lib/serverInfoCache';
import { navigateHome, navigateToArchive, navigateToMetadata, parseRouteFromLocation } from '../lib/navigation';
import Recommendations from '../components/Recommendations';
import EhComments from '../components/EhComments';
import ConfirmDialog from '../components/ConfirmDialog';
import CustomSelect from '../components/CustomSelect';
import ToggleSwitch from '../components/ToggleSwitch';
import { HomeSectionGlyph, NamespaceGlyph, stripDecoratedLabel, ToolbarGlyph } from '../components/AppGlyphs';

// ===== Authenticated Image Component =====
const getConfiguredServerUrl = () => {
  try {
    return (localStorage.getItem('lrr_server_url') || '').replace(/\/$/, '');
  } catch {
    return '';
  }
};

const isLanraragiAssetPath = (pathname) => (
  pathname.startsWith('/api/') ||
  pathname.startsWith('/reader/') ||
  pathname.startsWith('/download/')
);

const archiveHasNewMarker = (archive) => {
  const marker = archive?.isnew ?? archive?.is_new ?? archive?.isNew ?? archive?.new;
  if (marker === true || marker === 1) return true;
  return ['1', 'true', 'new'].includes(String(marker ?? '').trim().toLowerCase());
};

const clearArchiveNewMarker = (archive) => ({
  ...archive,
  isnew: false,
  is_new: false,
  isNew: false,
  new: false,
});

const toLocalUrl = (url) => {
  if (!url) return url;
  const serverUrl = getConfiguredServerUrl();
  try {
    const parsed = new URL(url, window.location.origin);
    if (serverUrl && parsed.origin === window.location.origin && isLanraragiAssetPath(parsed.pathname)) {
      return `${serverUrl}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    if (import.meta.env.DEV && parsed.origin === window.location.origin) {
      return parsed.pathname + parsed.search + parsed.hash;
    }
    return parsed.href;
  } catch {
    if (serverUrl && url.startsWith('/')) return `${serverUrl}${url}`;
    return url;
  }
};

async function resolvePageImageSource(pageUrl, { cacheOnly = false, allowNetworkFallback = true } = {}) {
  if (!pageUrl) return null;
  const normalized = toLocalUrl(pageUrl);
  const key = localStorage.getItem('lrr_api_key') || '';
  if (cacheOnly && !allowNetworkFallback) {
    return getCachedImage(normalized);
  }
  return getImage(normalized, async () => {
    const headers = {};
    if (key) headers.Authorization = `Bearer ${btoa(key)}`;
    const res = await fetch(normalized, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  });
}

async function ensureImageDecoded(src) {
  if (!src) return false;
  const probe = new Image();
  probe.decoding = 'async';
  probe.src = src;
  if (!probe.complete) {
    await new Promise((resolve, reject) => {
      probe.onload = () => resolve();
      probe.onerror = reject;
    });
  }
  if (typeof probe.decode === 'function') {
    try {
      await probe.decode();
    } catch {}
  }
  return true;
}

// ===== Thumbnail concurrency pool (max 2 simultaneous fetches) =====
const thumbPending = [];
let thumbActive = 0;
const THUMB_MAX = 2;
const DRAWER_COLUMNS = 3;
const DRAWER_GAP = 12;
const DRAWER_OVERSCAN_ROWS = 4;
const DRAWER_ITEM_RATIO = 1.3;
function getDrawerItemWidth(gridWidth) {
  return gridWidth > 0
    ? Math.max(72, (gridWidth - (DRAWER_COLUMNS - 1) * DRAWER_GAP) / DRAWER_COLUMNS)
    : 110;
}

function getDrawerRowHeight(gridWidth) {
  return getDrawerItemWidth(gridWidth) * DRAWER_ITEM_RATIO;
}

function thumbQueue(key, fetcher) {
  return new Promise((resolve) => {
    thumbPending.push({ key, fetcher, resolve });
    thumbPump();
  });
}
function thumbPump() {
  while (thumbActive < THUMB_MAX && thumbPending.length > 0) {
    const t = thumbPending.shift();
    thumbActive++;
    getImage(t.key, t.fetcher)
      .then(t.resolve)
      .finally(() => { thumbActive--; thumbPump(); });
  }
}
const DrawerThumb = ({ archiveId, pageIndex, active, cacheOnly = false, eager = false }) => {
  const [src, setSrc] = useState(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [allowNetworkFallback, setAllowNetworkFallback] = useState(() => !cacheOnly);
  const [thumbState, setThumbState] = useState('idle');
  const [retryTick, setRetryTick] = useState(0);
  const wrapRef = useRef(null);
  const retryTimerRef = useRef(null);

  useEffect(() => {
    if (!cacheOnly) {
      setAllowNetworkFallback(true);
    }
  }, [cacheOnly]);

  useEffect(() => {
    if (!active) { setShouldLoad(false); return; }
    if (eager) { setShouldLoad(true); return undefined; }
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setShouldLoad(true); io.disconnect(); }
    }, { rootMargin: '140px' });
    io.observe(el);
    return () => io.disconnect();
  }, [active, eager]);

  useEffect(() => {
    let m = true;
    if (!shouldLoad || !archiveId || typeof pageIndex !== 'number') return;

    const clearRetry = () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const scheduleRetry = () => {
      clearRetry();
      retryTimerRef.current = setTimeout(() => {
        if (!m) return;
        setRetryTick((tick) => tick + 1);
      }, 900);
    };

    (async () => {
      const page = pageIndex + 1;
      const thumbKey = `thumb:drawer:v3:${archiveId}:${page}`;
      try {
        setThumbState('loading');
        let blobUrl = cacheOnly && !allowNetworkFallback
          ? await getCachedImage(thumbKey)
          : await getCachedImage(thumbKey);
        if (!blobUrl && !(cacheOnly && !allowNetworkFallback)) {
          const result = await lrrApi.getArchiveThumbnail(archiveId, { page, noFallback: true });
          if (result.status !== 202 && result.blob) {
            blobUrl = await thumbQueue(thumbKey, async () => result.blob);
          }
        }
        if (!m) return;
        if (blobUrl) {
          setSrc(blobUrl);
          setThumbState('ready');
          clearRetry();
          return;
        }
        if (cacheOnly && !allowNetworkFallback) {
          setAllowNetworkFallback(true);
          return;
        }
        setSrc(null);
        setThumbState('queued');
        scheduleRetry();
      } catch {
        if (!m) return;
        if (cacheOnly && !allowNetworkFallback) {
          setAllowNetworkFallback(true);
          return;
        }
        setSrc(null);
        setThumbState('error');
        clearRetry();
      }
    })();
    return () => {
      m = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [allowNetworkFallback, archiveId, cacheOnly, pageIndex, retryTick, shouldLoad]);

  if (!src) {
    return (
      <div
        ref={wrapRef}
        style={{
          width: '100%',
          height: '100%',
          background: thumbState === 'error' ? 'color-mix(in srgb, var(--danger) 22%, transparent)' : 'var(--reader-skeleton-base)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: thumbState === 'error' ? 'rgba(255,196,196,0.82)' : 'rgba(222,231,243,0.52)',
          fontSize: '10px',
          letterSpacing: '0.2px',
          textAlign: 'center',
          padding: '6px',
          boxSizing: 'border-box',
        }}
      >
        {thumbState === 'error' ? '缩略图失败' : thumbState === 'queued' ? '生成中' : ''}
      </div>
    );
  }
  return (
    <img
      ref={wrapRef}
      src={src}
      alt=""
      onLoad={() => setThumbState('ready')}
      onError={() => {
        setSrc(null);
        setThumbState('error');
      }}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      loading="eager"
    />
  );
};

const PageImage = React.forwardRef(({
  pageUrl,
  pageIndex,
  style,
  className,
  isImmersive,
  cacheOnly = false,
  loadingLabel,
  loadingHint,
  errorLabel,
  onLoadStart,
  onReady,
  onError,
  splitWide = false,
  cropBorders = false,
}, fwdRef) => {
  const [imgSrc, setImgSrc] = useState(null);
  const [loadState, setLoadState] = useState(() => (pageUrl ? 'loading' : 'idle'));
  const [allowNetworkFallback, setAllowNetworkFallback] = useState(() => !cacheOnly);
  const requestSeqRef = useRef(0);
  const imgRef = useRef(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [cropInsets, setCropInsets] = useState({ top: 0, right: 0, bottom: 0, left: 0 });

  useEffect(() => {
    if (!cacheOnly) {
      setAllowNetworkFallback(true);
    }
  }, [cacheOnly]);

  const setRefs = useCallback((el) => {
    imgRef.current = el;
    if (!fwdRef) return;
    if (typeof fwdRef === 'function') fwdRef(el);
    else fwdRef.current = el;
  }, [fwdRef]);

  useEffect(() => {
    let isMounted = true;
    const requestSeq = ++requestSeqRef.current;
    setLoadState(pageUrl ? 'loading' : 'idle');

    (async () => {
      if (!pageUrl) return;
      onLoadStart?.(pageIndex);

      try {
        const src = await resolvePageImageSource(pageUrl, { cacheOnly, allowNetworkFallback });
        if (!isMounted || requestSeq !== requestSeqRef.current) return;
        if (src) {
          const decoded = new Image(); decoded.src = src; await decoded.decode?.().catch(() => {});
          if (!isMounted || requestSeq !== requestSeqRef.current) return;
          setNaturalSize({ width: decoded.naturalWidth, height: decoded.naturalHeight });
          setImgSrc(src);
          setLoadState('ready');
          onReady?.(pageIndex);
          return;
        }
        if (cacheOnly && !allowNetworkFallback) {
          setAllowNetworkFallback(true);
          return;
        }
        setLoadState('error');
        onError?.(pageIndex);
      } catch {
        if (!isMounted || requestSeq !== requestSeqRef.current) return;
        if (cacheOnly && !allowNetworkFallback) {
          setAllowNetworkFallback(true);
          return;
        }
        setLoadState('error');
        onError?.(pageIndex);
      }
    })();

    return () => { isMounted = false; };
  }, [allowNetworkFallback, cacheOnly, onError, onLoadStart, onReady, pageIndex, pageUrl]);

  if (!imgSrc) {
    return (
      <div
        className="reader-shell-pulse reader-skeleton-fade reader-skeleton-surface"
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          borderRadius: '8px',
          background: 'var(--reader-skeleton-base)',
          border: '1px solid var(--reader-control-border)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div className="shimmer-strip" style={{ position: 'absolute', inset: 0 }} />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '18px',
            textAlign: 'center',
            pointerEvents: 'none',
            color: loadState === 'error' ? 'var(--danger)' : 'var(--text-main)',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '0.3px' }}>
            {loadState === 'error'
              ? (errorLabel || '图片加载失败')
              : (loadingLabel || '正在加载图像')}
          </div>
          <div style={{ fontSize: '12px', color: loadState === 'error' ? 'rgba(255,180,180,0.84)' : 'rgba(223,231,245,0.68)' }}>
            {loadState === 'error'
              ? '保留当前画面，稍后可再次翻页重试'
              : (loadingHint || '图像就绪后会立即显示')}
          </div>
        </div>
      </div>
    );
  }

  if (splitWide && naturalSize.width > naturalSize.height * 1.2) {
    return <div style={{ display: 'flex', width: '100%', height: '100%', gap: 2 }}>
      {[0, 1].map(part => <div key={part} style={{ width: '50%', height: '100%', overflow: 'hidden', position: 'relative' }}><img ref={part === 0 ? setRefs : undefined} src={imgSrc} alt="Comic Content" draggable={false} style={{ position: 'absolute', height: '100%', width: '200%', maxWidth: 'none', objectFit: 'fill', left: part === 0 ? 0 : '-100%', userSelect: 'none' }} /></div>)}
    </div>;
  }

  return (
    <img
      ref={setRefs}
      src={imgSrc}
      className={[className, 'reader-content-fade-in'].filter(Boolean).join(' ')}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        pointerEvents: isImmersive ? 'none' : 'auto',
        WebkitUserDrag: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none',
        ...style
        , ...(cropBorders ? { clipPath: `inset(${cropInsets.top * 100}% ${cropInsets.right * 100}% ${cropInsets.bottom * 100}% ${cropInsets.left * 100}%)` } : {})
      }}
      alt="Comic Content"
      draggable={false}
      loading="eager"
      fetchpriority="high"
      decoding="async"
      onLoad={(event) => { if (cropBorders) { try { setCropInsets(detectImageBorderInsets(event.currentTarget)); } catch {} } }}
      onContextMenu={(e) => isImmersive && e.preventDefault()}
    />
  );
});

const ReaderArchiveThumb = ({ archiveId, cacheOnly = false }) => {
  const [src, setSrc] = useState(null);
  const [allowNetworkFallback, setAllowNetworkFallback] = useState(() => !cacheOnly);
  useEffect(() => {
    if (!cacheOnly) {
      setAllowNetworkFallback(true);
    }
  }, [cacheOnly]);
  useEffect(() => {
    let m = true;
    (async () => {
      if (!archiveId) return;
      try {
        const blobUrl = cacheOnly && !allowNetworkFallback
          ? await getCachedImage(`thumb:hist:${archiveId}`)
          : await getImage(`thumb:hist:${archiveId}`, async () => {
              const base = (localStorage.getItem('lrr_server_url') || '').replace(/\/$/, '');
              const key = localStorage.getItem('lrr_api_key') || '';
              const h = {};
              if (key) h['Authorization'] = `Bearer ${btoa(key)}`;
              const r = await fetch(`${base}/api/archives/${archiveId}/thumbnail`, { headers: h });
              if (!r.ok) throw new Error();
              return r.blob();
            });
        if (!m) return;
        if (blobUrl) {
          setSrc(blobUrl);
          return;
        }
        if (cacheOnly && !allowNetworkFallback) {
          setAllowNetworkFallback(true);
        }
      } catch {
        if (!m) return;
        if (cacheOnly && !allowNetworkFallback) {
          setAllowNetworkFallback(true);
        }
      }
    })();
    return () => { m = false; };
  }, [allowNetworkFallback, archiveId, cacheOnly]);
  return (
    <div style={{ width: '48px', height: '66px', borderRadius: '5px', overflow: 'hidden', flexShrink: 0, background: 'var(--cover-bg)' }}>
      {src && <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
    </div>
  );
};

function ReaderArchiveListPanel({ type, title, items, emptyMessage, cacheOnly, onDelete, activeType, onTypeChange }) {
  return (
    <div
      data-panel={type}
      className="reader-panel-surface glass-panel dropdown-animate no-scrollbar"
      style={{
        position: 'absolute',
        top: '62px',
        left: '20px',
        zIndex: 110,
        padding: '18px',
        borderRadius: '14px',
        width: 'min(360px, calc(100vw - 40px))',
        boxSizing: 'border-box',
        maxHeight: '70vh',
        overflowY: 'auto',
        boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
        border: '1px solid var(--reader-control-border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '12px', borderBottom: '1px solid var(--reader-control-border)', paddingBottom: '8px' }}>
        <span style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: 600 }}>{title}</span>
        <div className="reader-panel-tabs" role="group" aria-label="归档列表类型">
          {[
            ['history', '阅读历史'],
            ['watchlist', '待看归档'],
            ['random', '随机漫游'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="reader-panel-tab"
              aria-pressed={activeType === value}
              onClick={() => onTypeChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: '12px', color: 'var(--text-sub)', padding: '8px 0' }}>{emptyMessage}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {items.map((item) => {
            const id = item.id || item.arcid;
            const tags = (item.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
            const showNs = new Set(['category', 'parody', 'male', 'female']);
            const displayTags = tags
              .filter((tag) => showNs.has(tag.split(':')[0].toLowerCase()))
              .map((tag) => {
                const separator = tag.indexOf(':');
                if (separator <= 0) return tag;
                return translateTag(tag.slice(0, separator).toLowerCase(), tag.slice(separator + 1).trim());
              })
              .filter(Boolean)
              .slice(0, 6);
            const meta = getReaderArchiveListMeta(item, type);

            return (
              <div
                key={id}
                onClick={() => navigateToArchive(id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigateToArchive(id);
                  }
                }}
                role="button"
                tabIndex={0}
                className="reader-archive-list-item"
                style={{
                  display: 'flex', gap: '10px', alignItems: 'center',
                  padding: '8px 10px', borderRadius: '8px', cursor: 'pointer',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--glass-border)',
                  transition: 'background-color 0.15s ease, border-color 0.15s ease',
                }}
              >
                <ReaderArchiveThumb archiveId={id} cacheOnly={cacheOnly} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </div>
                  {displayTags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '4px' }}>
                      {displayTags.map((tag, index) => (
                        <span key={index} style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '3px', color: 'var(--text-sub)', background: 'var(--surface-3)', whiteSpace: 'nowrap' }}>{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right', minWidth: '52px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-sub)' }}>
                    {meta.timestamp ? new Date(meta.timestamp).toLocaleDateString() : ''}
                  </div>
                  {meta.progress && (
                    <div style={{ fontSize: '10px', color: 'var(--accent)', marginTop: '2px' }}>{meta.progress}</div>
                  )}
                </div>
                {onDelete && <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(item);
                  }}
                  style={{
                    background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                    fontSize: '16px', lineHeight: 1, padding: '2px 4px', borderRadius: '4px', flexShrink: 0,
                  }}
                  title={type === 'watchlist' ? '移出待看' : '删除历史'}
                  aria-label={type === 'watchlist' ? `将${item.title || '归档'}移出待看` : `删除${item.title || '归档'}的历史记录`}
                >
                  ×
                </button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function normalizePageUrl(rawUrl, serverUrl) {
  if (!rawUrl) return '';
  let url = rawUrl.replace(/^\.\/+/, '/').replace(/\/page&path=/, '/page?path=');
  if (!url.startsWith('http')) return `${serverUrl}${url.startsWith('/') ? url : `/${url}`}`;
  try {
    const parsed = new URL(url);
    if (serverUrl && parsed.origin === window.location.origin && isLanraragiAssetPath(parsed.pathname)) {
      return `${serverUrl}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {}
  return url;
}

async function primePageImage(pageUrl) {
  if (!pageUrl) return false;
  const normalized = toLocalUrl(pageUrl);
  const key = localStorage.getItem('lrr_api_key') || '';
  return primeImage(normalized, async () => {
    const headers = {};
    if (key) headers.Authorization = `Bearer ${btoa(key)}`;
    const res = await fetch(normalized, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  });
}

function getNormalReaderFrameHeight(isMobile) {
  return isMobile ? 'min(72vh, 680px)' : 'min(82vh, 1080px)';
}

const normalReaderStageShellStyle = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  maxWidth: '1300px',
  width: '100%',
  margin: '0 auto',
  padding: '24px 16px 0 16px',
};

const normalReaderStageLayoutStyle = {
  ...normalReaderStageShellStyle,
  flex: '0 0 auto',
};

const skeletonViewportStyle = {
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
};

function forceWindowScrollTop() {
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

function getNormalReaderFrameStyle(isMobile) {
  const height = getNormalReaderFrameHeight(isMobile);
  return {
    flex: '0 0 auto',
    minHeight: height,
    height,
    maxHeight: height,
    maxWidth: '850px',
    width: '100%',
    marginLeft: 'auto',
    marginRight: 'auto',
    background: 'var(--reader-stage-bg)',
    border: '1px solid var(--reader-stage-border)',
    borderRadius: '16px',
    padding: isMobile ? '16px' : '24px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    boxShadow: '0 18px 50px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.035)',
    boxSizing: 'border-box',
  };
}

function getTopBarButtonStyle(isMobile, disabled = false) {
  return {
    padding: isMobile ? '8px 10px' : '8px 14px',
    minWidth: isMobile ? '40px' : 'unset',
    height: isMobile ? '40px' : 'auto',
    background: 'var(--reader-control-bg)',
    border: '1px solid var(--reader-control-border)',
    color: 'var(--reader-control-text)',
    borderRadius: '8px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: isMobile ? '16px' : '13px',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: isMobile ? '0' : '6px',
    transition: 'background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.2s ease',
    opacity: disabled ? 0.45 : 1,
    flexShrink: 0,
  };
}

function getPageNavButtonStyle(isMobile) {
  return {
    width: isMobile ? '52px' : '56px',
    height: isMobile ? '52px' : '56px',
    background: 'var(--reader-control-bg)',
    border: '1px solid var(--reader-control-border)',
    color: 'var(--reader-control-text)',
    borderRadius: isMobile ? '10px' : '12px',
    cursor: 'pointer',
    fontSize: isMobile ? '20px' : '22px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    transition: 'background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.2s ease',
    flexShrink: 0,
  };
}

function useCompactReaderToolbar(isMobile) {
  const toolbarRef = useRef(null);
  const expandedWidthRef = useRef(0);
  const [compact, setCompact] = useState(isMobile);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return undefined;
    const update = () => {
      const availableWidth = toolbar.clientWidth;
      if (!compact) {
        const left = toolbar.querySelector('.reader-toolbar-group-left');
        const right = toolbar.querySelector('.reader-toolbar-group-right');
        const title = toolbar.querySelector('.reader-toolbar-title');
        const horizontalPadding = 48;
        const groupGaps = 32;
        const titleWidth = title ? Math.min(title.scrollWidth, 240) : 0;
        expandedWidthRef.current = (left?.scrollWidth || 0) + (right?.scrollWidth || 0) + titleWidth + horizontalPadding + groupGaps;
      }
      const requiredWidth = expandedWidthRef.current || availableWidth;
      setCompact(shouldUseCompactReaderToolbar({ isMobile, availableWidth, requiredWidth }));
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [compact, isMobile]);

  return { toolbarRef, compact };
}

function ReaderToolbarButtonContent({ icon, label, size = 18 }) {
  return (
    <span className="reader-toolbar-button-content" aria-hidden="true">
      <span className="reader-toolbar-icon"><ToolbarGlyph name={icon} size={size} /></span>
      <span className="reader-toolbar-label">{label}</span>
    </span>
  );
}

function ReaderStageSkeleton({ title = '', hasMeta = false, hasPages = false, isMobile = false }) {
  const { toolbarRef, compact } = useCompactReaderToolbar(isMobile);
  const topBtnStyle = getTopBarButtonStyle(compact);
  const toolbarGroups = getReaderSkeletonToolbarGroups(compact);
  const pageNavBtnStyle = getPageNavButtonStyle(isMobile);
  const frameStyle = getNormalReaderFrameStyle(isMobile);
  return (
    <div className="reader-root" style={{ minHeight: '100vh', background: 'transparent' }}>
      <div style={skeletonViewportStyle}>
        <div
          ref={toolbarRef}
          className="reader-toolbar"
          data-reader-toolbar
          data-mobile={isMobile ? 'true' : 'false'}
          data-compact={compact ? 'true' : 'false'}
          style={{
            padding: '14px 24px',
            background: 'var(--reader-toolbar-bg)',
            backdropFilter: 'blur(16px)',
            borderBottom: '1px solid var(--reader-control-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div className="reader-toolbar-group-left" style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '6px' : '16px', flex: '1 0 0', minWidth: 0 }}>
            {toolbarGroups.left.map((label, index) => (
              <div
                key={index}
                className="reader-toolbar-button reader-toolbar-skeleton"
                style={{
                  ...topBtnStyle,
                  ...(compact ? { width: '40px', height: '40px', padding: 0 } : {}),
                  color: 'transparent',
                  background: 'var(--reader-skeleton-base)',
                  borderColor: 'var(--reader-control-border)',
                }}
              >
                {label}
              </div>
            ))}
          </div>
          {!compact && (
            <div
              className="reader-toolbar-title"
              style={{
                flex: '0 1 auto',
                maxWidth: '50vw',
                minWidth: 0,
                height: '18px',
                borderRadius: '8px',
                background: title ? 'transparent' : 'var(--reader-skeleton-base)',
                color: title ? 'var(--text-main)' : 'transparent',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textAlign: 'center',
                fontSize: '15px',
                fontWeight: 700,
              }}
            >
              {title || 'loading'}
            </div>
          )}
          {compact && <span style={{ flex: '0 0 0', minWidth: 0 }} />}
          <div className="reader-toolbar-group-right" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: isMobile ? '6px' : '8px', flex: '1 0 0', minWidth: 0 }}>
            {toolbarGroups.right.map((label, index) => (
              <div
                key={index}
                className="reader-toolbar-button reader-toolbar-skeleton"
                style={{
                  ...topBtnStyle,
                  ...(compact ? { width: '40px', height: '40px', padding: 0 } : {}),
                  color: 'transparent',
                  background: 'var(--reader-skeleton-base)',
                  borderColor: 'var(--reader-control-border)',
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>

        <div style={normalReaderStageLayoutStyle}>
          <div
            className="reader-shell-pulse reader-stage-frame"
            style={frameStyle}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                maxWidth: '100%',
                maxHeight: '100%',
                minWidth: 0,
                borderRadius: '8px',
                background: 'var(--reader-skeleton-base)',
                border: '1px solid var(--reader-control-border)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div className="shimmer-strip" style={{ position: 'absolute', inset: 0 }} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: isMobile ? '18px' : '24px', padding: '20px 8px', flexShrink: 0 }}>
            <div className="reader-skeleton-surface" style={pageNavBtnStyle} />
            <div className="reader-skeleton-surface" style={{ width: hasPages ? '72px' : '96px', height: '18px', borderRadius: '8px' }} />
            <div className="reader-skeleton-surface" style={pageNavBtnStyle} />
          </div>
        </div>

        {hasMeta && (
          <div style={{ maxWidth: '1300px', width: '100%', margin: '0 auto', padding: '0 16px 24px 16px' }}>
            <div className="section-reveal section-reveal-delay-2" style={{ display: 'grid', gap: '20px' }}>
              <div className="reader-panel-surface glass-panel" style={{ minHeight: '168px' }} />
              <div className="reader-panel-surface glass-panel" style={{ minHeight: '220px' }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Reader({ archiveId, onBack, coldRestoreBoot = false }) {
  const bootState = getBootState();
  const readerSnapshotRef = useRef(null);
  if (readerSnapshotRef.current === null) {
    const fallbackReaderSnapshot = loadReaderSnapshot(archiveId);
    readerSnapshotRef.current = coldRestoreBoot
      ? fallbackReaderSnapshot
      : ((bootState.wasDiscarded || bootState.navigationType === 'reload') ? fallbackReaderSnapshot : null);
  }
  const readerSnapshot = readerSnapshotRef.current;
  const hasSnapshot = !!readerSnapshot;
  const coldRestoreRef = useRef(!!readerSnapshot);
  const serverUrlRef = useRef((localStorage.getItem('lrr_server_url') || '').replace(/\/$/, ''));
  const serverInfoRef = useRef(getStoredServerInfo());
  // ===== Core States =====
  const [archive, setArchive] = useState(() => readerSnapshot?.archive || null);
  const [pages, setPages] = useState(() => Array.isArray(readerSnapshot?.pages) ? readerSnapshot.pages : []);
  const [currentIndex, setCurrentIndex] = useState(() => {
    const next = readerSnapshot?.currentIndex;
    return typeof next === 'number' && next >= 0 ? next : 0;
  });
  const [displayedIndex, setDisplayedIndex] = useState(() => {
    const next = readerSnapshot?.displayedIndex;
    return typeof next === 'number' && next >= 0 ? next : 0;
  });
  const [loading, setLoading] = useState(() => !hasSnapshot);
  const [loadingPages, setLoadingPages] = useState(() => !hasSnapshot);

  // ===== UI States =====
  const [viewMode, setViewMode] = useState(() => readerSnapshot?.viewMode || 'normal');
  const [showUI, setShowUI] = useState(true);
  const [showHeader, setShowHeader] = useState(() => readerSnapshot?.showHeader ?? true);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [showArchivePanel, setShowArchivePanel] = useState(false);
  const [archivePanelType, setArchivePanelType] = useState('history');
  const [randomEntries, setRandomEntries] = useState([]);
  const [randomEntriesLoading, setRandomEntriesLoading] = useState(false);
  const [historyDeleteTarget, setHistoryDeleteTarget] = useState(null);
  const [coverSetting, setCoverSetting] = useState(false);
  const [coverSetPage, setCoverSetPage] = useState(0);
  const [coverConfirmPage, setCoverConfirmPage] = useState(0);
  const [drawerPrefetchSet, setDrawerPrefetchSet] = useState(() => new Set());
  const [drawerViewport, setDrawerViewport] = useState({ height: 0, scrollTop: 0, width: 0 });
  const [readerReady, setReaderReady] = useState(() => hasSnapshot);
  const [assetCacheOnly, setAssetCacheOnly] = useState(() => hasSnapshot);
  const [historyEntries, setHistoryEntries] = useState(() => getHistory());
  const [watchlistEntries, setWatchlistEntries] = useState(() => getWatchlist());
  const [hideRead] = useState(getHideRead);
  const [isMobile, setIsMobile] = useState(() => isReaderMobileViewport(window.innerWidth, 'ontouchstart' in window));
  const { toolbarRef, compact: toolbarCompact } = useCompactReaderToolbar(isMobile);
  const isIosWebKit = useMemo(() => isIosWebKitPlatform(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints,
  ), []);
  const [serverTracksProgress, setServerTracksProgress] = useState(() => {
    const stored = getStoredServerInfo();
    if (stored && typeof stored.server_tracks_progress === 'boolean') {
      return stored.server_tracks_progress;
    }
    return null;
  });
  const [pageLoadPhase, setPageLoadPhase] = useState(() => ({
    status: pages.length > 0 ? 'loading' : 'idle',
    visibleIndex: typeof readerSnapshot?.displayedIndex === 'number' && readerSnapshot.displayedIndex >= 0
      ? readerSnapshot.displayedIndex
      : 0,
    targetIndex: typeof readerSnapshot?.currentIndex === 'number' && readerSnapshot.currentIndex >= 0
      ? readerSnapshot.currentIndex
      : 0,
    progress: 0,
    shownAt: 0,
  }));
  const [loadingUiArmed, setLoadingUiArmed] = useState(false);

  useLayoutEffect(() => {
    forceWindowScrollTop();
    const frame = requestAnimationFrame(forceWindowScrollTop);
    const timer = setTimeout(forceWindowScrollTop, 80);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [archiveId]);

  useEffect(() => {
    if (!readerReady) return undefined;
    const frame = requestAnimationFrame(forceWindowScrollTop);
    return () => cancelAnimationFrame(frame);
  }, [archiveId, readerReady]);

  // ===== Zoom =====
  const [zoomScale, setZoomScale] = useState(() => readerSnapshot?.zoomScale || 1.0);

  // ===== Pan (drag-to-scroll when zoomed) =====
  const [panX, setPanX] = useState(() => readerSnapshot?.panX || 0);
  const [panY, setPanY] = useState(() => readerSnapshot?.panY || 0);

  // Reset pan offset whenever zoom returns to 100%
  useEffect(() => {
    if (zoomScale === 1.0) {
      panRef.current = { x: 0, y: 0, startX: 0, startY: 0, originX: 0, originY: 0 };
      setPanX(0);
      setPanY(0);
    }
  }, [zoomScale]);

  // ===== Settings (persisted across archives) =====
  const [settings, setSettingsState] = useState(() => {
    try {
      return normalizeReaderSettings(JSON.parse(localStorage.getItem(READER_SETTINGS_KEY)));
    } catch {}
    return { ...DEFAULT_READER_SETTINGS };
  });
  const [autoWebtoon, setAutoWebtoon] = useState(false);
  const snapshotSaveTimerRef = useRef(null);

  const [preloadInput, setPreloadInput] = useState(String(settings.preloadCount));
  const [autoTurnInput, setAutoTurnInput] = useState(String(settings.autoTurnInterval));
  const archiveRef = useRef(archive);
  const pagesRef = useRef(pages);
  const currentIndexRefSnapshot = useRef(currentIndex);
  const displayedIndexRef = useRef(displayedIndex);
  const viewModeSnapshotRef = useRef(viewMode);
  const pageLoadPhaseRef = useRef(pageLoadPhase);

  useEffect(() => { archiveRef.current = archive; }, [archive]);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => { currentIndexRefSnapshot.current = currentIndex; }, [currentIndex]);
  useEffect(() => { displayedIndexRef.current = displayedIndex; }, [displayedIndex]);
  useEffect(() => { viewModeSnapshotRef.current = viewMode; }, [viewMode]);
  useEffect(() => { pageLoadPhaseRef.current = pageLoadPhase; }, [pageLoadPhase]);

  useEffect(() => {
    const refreshHistory = () => setHistoryEntries(getHistory());
    window.addEventListener('lrr:history-changed', refreshHistory);
    return () => window.removeEventListener('lrr:history-changed', refreshHistory);
  }, []);

  useEffect(() => () => { flushHistorySync().catch(() => {}); }, []);

  useEffect(() => {
    loadHistoryState().then((state) => setHistoryEntries(state.histories)).catch(() => {});
  }, []);

  useEffect(() => {
    const refreshWatchlist = () => setWatchlistEntries(getWatchlist());
    window.addEventListener('lrr:watchlist-changed', refreshWatchlist);
    loadWatchlistState().then((state) => setWatchlistEntries(state.items)).catch(() => {});
    return () => window.removeEventListener('lrr:watchlist-changed', refreshWatchlist);
  }, []);

  const saveReaderStateSnapshot = useCallback(() => {
    if (!archiveRef.current || pagesRef.current.length === 0) return;
    saveReaderSnapshot({
      archiveId,
      archive: archiveRef.current,
      pages: pagesRef.current,
      currentIndex: currentIndexRefSnapshot.current,
      displayedIndex: displayedIndexRef.current,
      viewMode: viewModeSnapshotRef.current,
      showHeader,
      zoomScale: zoomScaleRef.current,
      panX: panRef.current.x,
      panY: panRef.current.y,
    });
  }, [archiveId, showHeader]);
  useEffect(() => {
    serverInfoRef.current = { ...(serverInfoRef.current || {}), server_tracks_progress: serverTracksProgress };
  }, [serverTracksProgress]);

  useEffect(() => {
    let cancelled = false;
    loadServerInfo().then((info) => {
      if (cancelled) return;
      serverInfoRef.current = info;
      if (typeof info?.server_tracks_progress === 'boolean') {
        setServerTracksProgress(info.server_tracks_progress);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const exitColdRestoreMode = useCallback(async () => {
    if (!coldRestoreRef.current) return serverInfoRef.current;
    coldRestoreRef.current = false;
    setAssetCacheOnly(false);
    try {
      const info = await loadServerInfo();
      serverInfoRef.current = info;
      if (typeof info?.server_tracks_progress === 'boolean') {
        setServerTracksProgress(info.server_tracks_progress);
      }
      return info;
    } catch {
      return serverInfoRef.current;
    }
  }, []);

  useEffect(() => {
    if (!readerReady || !assetCacheOnly) return undefined;
    const timer = setTimeout(() => {
      void exitColdRestoreMode();
    }, 1200);
    return () => clearTimeout(timer);
  }, [assetCacheOnly, exitColdRestoreMode, readerReady]);

  const updateSettings = useCallback((updater) => {
    setSettingsState((prev) => {
      const next = normalizeReaderSettings(typeof updater === 'function' ? updater(prev) : updater);
      localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(next));
      setPreloadInput(String(next.preloadCount));
      setAutoTurnInput(String(next.autoTurnInterval));
      return next;
    });
  }, []);

  useEffect(() => {
    updateSettings(prepareReaderSettingsForArchiveChange);
  }, [archiveId, updateSettings]);

  useEffect(() => {
    if (settings.readingLayout !== 'auto' || pages.length < 2) { setAutoWebtoon(false); return undefined; }
    let active = true;
    (async () => {
      const seams = [];
      const count = Math.min(12, pages.length - 1);
      const loadDetectorImage = async (pageUrl) => {
        const source = await resolvePageImageSource(pageUrl);
        return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = source; });
      };
      let previousImage = await loadDetectorImage(pages[0]);
      for (let index = 0; index < count; index++) {
        if (!active) return;
        const nextImage = await loadDetectorImage(pages[index + 1]);
        seams.push(compareSeamPixels(await sampleImageSeam(previousImage, 'bottom'), await sampleImageSeam(nextImage, 'top')));
        previousImage = nextImage;
      }
      const result = classifyWebtoonSeams(seams, { minimumValid: pages.length <= 3 ? 1 : 3 });
      if (active) setAutoWebtoon(result.isWebtoon);
    })().catch(() => { if (active) setAutoWebtoon(false); });
    return () => { active = false; };
  }, [pages, settings.readingLayout]);

  useEffect(() => {
    if (!archive || pages.length === 0) return;
    if (snapshotSaveTimerRef.current) clearTimeout(snapshotSaveTimerRef.current);
    snapshotSaveTimerRef.current = setTimeout(() => {
      snapshotSaveTimerRef.current = null;
      saveReaderStateSnapshot();
    }, 250);
  }, [archive, pages, currentIndex, displayedIndex, viewMode, zoomScale, panX, panY, saveReaderStateSnapshot]);

  useEffect(() => {
    if (pages.length === 0) {
      setPageLoadPhase({ status: 'idle', visibleIndex: 0, targetIndex: 0, progress: 0, shownAt: 0 });
      return;
    }
    setPageLoadPhase((prev) => {
      const visibleIndex = Math.max(0, Math.min(prev.visibleIndex, pages.length - 1));
      const targetIndex = Math.max(0, Math.min(currentIndex, pages.length - 1));
      const targetChanged = targetIndex !== prev.targetIndex;
      const visibleChanged = visibleIndex !== prev.visibleIndex;
      if (!targetChanged && !visibleChanged) return prev;
      return {
        status: targetChanged && targetIndex !== visibleIndex ? 'loading' : prev.status,
        visibleIndex,
        targetIndex,
        progress: targetChanged && targetIndex !== visibleIndex ? 0.08 : prev.progress,
        shownAt: targetChanged && targetIndex !== visibleIndex ? Date.now() : prev.shownAt,
      };
    });
  }, [currentIndex, pages.length]);

  useEffect(() => {
    if (showDrawer) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showDrawer]);

  // Lock body scroll in immersive mode
  useEffect(() => {
    if (viewMode === 'immersive') {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
      };
    }
  }, [viewMode]);

  // ── bfcache / visibility / keep-alive guard ──
  const lastFetchedRef = useRef(0);
  useEffect(() => {
    const bump = () => { lastFetchedRef.current = Date.now(); };
    const handlePageShow = (e) => { if (e.persisted) bump(); };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        bump();
      } else {
        markBackground({ kind: 'reader', archiveId });
        saveReaderStateSnapshot();
      }
      // No timers to restart in Reader — just bump the ref
    };
    // Release memory on pagehide to reduce kill likelihood
    const handlePageHide = () => {
      markBackground({ kind: 'reader', archiveId });
      saveReaderStateSnapshot();
    };
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [archiveId, saveReaderStateSnapshot]);

  // ===== Swipe engine (100% ref+RAF — zero React re-render during drag) =====
  const isSwipingRef = useRef(false);
  const swipeRef = useRef({ startX: 0, startY: 0, offset: 0 });
  const swipeRAF = useRef(null);
  const swipeStartTimeRef = useRef(0);
  const swipeDidMoveRef = useRef(false);
  const swipeContainerRef = useRef(null);
  const imgCurrRef = useRef(null);
  const imgLeftRef = useRef(null);
  const imgRightRef = useRef(null);
  const leftDivRef = useRef(null);
  const rightDivRef = useRef(null);
  const immersiveLoadSeqRef = useRef(0);
  const watchlistAutoRemovedRef = useRef(new Set());
  const lrrProgressSentRef = useRef(new Set());
  const commitPageTargetRef = useRef(null);
  const viewModeRef = useRef(viewMode);
  const currentIndexRef = useRef(0);
  const pagesLenRef = useRef(0);

  // ===== Zoom refs =====
  const zoomScaleRef = useRef(1.0);
  const isZoomingRef = useRef(false);
  const zoomWrapperRef = useRef(null);
  const lastTapRef = useRef(0);
  const lastTapPosRef = useRef({ x: 0, y: 0 });
  const singleTapTimerRef = useRef(null);
  const pinchStartRef = useRef({ dist: 0, scale: 1.0, cx: 0, cy: 0 });
  const overshootTimerRef = useRef(null);
  const skipNextClickRef = useRef(false);
  const lastTouchTimeRef = useRef(0);

  // ===== Pan refs =====
  const panRef = useRef({ x: 0, y: 0, startX: 0, startY: 0, originX: 0, originY: 0 });
  const isPanningRef = useRef(false);

  const getImmersiveTopTriggerHeight = useCallback(() => {
    return isMobile ? 112 : 104;
  }, [isMobile]);

  const revealImmersiveHeader = useCallback(() => {
    setShowHeader(true);
    if (headerTimerRef.current) clearTimeout(headerTimerRef.current);
    headerTimerRef.current = setTimeout(() => setShowHeader(false), 2600);
  }, []);

  const applyZoomAtPoint = useCallback((nextScale, focalX = window.innerWidth / 2, focalY = window.innerHeight / 2) => {
    const prevScale = zoomScaleRef.current || 1;
    let scale = Math.max(1, Math.min(5, nextScale));

    if (scale <= 1.01) {
      scale = 1;
      panRef.current = { x: 0, y: 0, startX: 0, startY: 0, originX: 0, originY: 0 };
      zoomScaleRef.current = scale;
      setPanX(0);
      setPanY(0);
      setZoomScale(scale);
      return scale;
    }

    const ratio = scale / Math.max(prevScale, 0.001);
    const originX = window.innerWidth / 2;
    const originY = window.innerHeight / 2;
    const focalOffsetX = focalX - originX;
    const focalOffsetY = focalY - originY;
    const maxTx = Math.max(0, (scale - 1) * window.innerWidth / 2);
    const maxTy = Math.max(0, (scale - 1) * window.innerHeight / 2);
    const nextX = Math.max(-maxTx, Math.min(maxTx, ratio * panRef.current.x + (1 - ratio) * focalOffsetX));
    const nextY = Math.max(-maxTy, Math.min(maxTy, ratio * panRef.current.y + (1 - ratio) * focalOffsetY));

    panRef.current = { ...panRef.current, x: nextX, y: nextY };
    zoomScaleRef.current = scale;
    setPanX(nextX);
    setPanY(nextY);
    setZoomScale(scale);
    return scale;
  }, []);

  // ===== Refs =====
  const autoTurnTimerRef = useRef(null);
  const headerTimerRef = useRef(null);
  const progressBarRef = useRef(null);
  const containerRef = useRef(null);
  const indicatorRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const drawerGridRef = useRef(null);

  // ===== isMobile detection =====
  useEffect(() => {
    const check = () => setIsMobile(isReaderMobileViewport(window.innerWidth, 'ontouchstart' in window));
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ===== Immersive image loader (raw img.src via ref — never unmounts) =====
  useEffect(() => {
    if (viewMode !== 'immersive' || pages.length === 0) return;
    const idx = currentIndex;
    const loadSeq = immersiveLoadSeqRef.current + 1;
    immersiveLoadSeqRef.current = loadSeq;
    let alive = true;
    const key = localStorage.getItem('lrr_api_key') || '';

    const loadImg = async (imgRef, pageUrl) => {
      if (!pageUrl || !imgRef.current) return false;
      try {
        const normalized = toLocalUrl(pageUrl);
        const src = coldRestoreRef.current
          ? await getCachedImage(normalized)
          : await getImage(normalized, async () => {
              const headers = {};
              if (key) headers.Authorization = `Bearer ${btoa(key)}`;
              const res = await fetch(normalized, { headers });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return res.blob();
            });
        if (!alive || loadSeq !== immersiveLoadSeqRef.current) return false;
        if (src) {
          await ensureImageDecoded(src);
        }
        if (!alive || loadSeq !== immersiveLoadSeqRef.current || !imgRef.current) return false;
        if (src) {
          imgRef.current.style.display = '';
          imgRef.current.src = src;
        } else {
          imgRef.current.src = '';
          imgRef.current.style.display = 'none';
        }
        return !!src;
      } catch {
        return false;
      }
    };
    const unloadImg = (imgRef) => {
      if (imgRef.current) {
        imgRef.current.src = '';
        imgRef.current.style.display = 'none';
      }
    };

    loadImg(imgCurrRef, pages[idx]).then((ok) => {
      if (!alive || loadSeq !== immersiveLoadSeqRef.current) return;
      if (currentIndexRef.current !== idx) return;
      if (ok) {
        setDisplayedIndex(idx);
        setLoadingUiArmed(false);
        setPageLoadPhase((prev) => (
          idx !== prev.targetIndex
            ? prev
            : { status: 'ready', visibleIndex: idx, targetIndex: idx, progress: 1, shownAt: prev.shownAt }
        ));
      } else {
        setPageLoadPhase((prev) => (
          idx !== prev.targetIndex
            ? prev
            : { ...prev, status: 'error', progress: 1 }
        ));
      }
    });

    const l2r = settings.direction === 'ltr';
    const prevIdx = l2r ? idx - 1 : idx + 1;
    const nextIdx = l2r ? idx + 1 : idx - 1;
    if (prevIdx >= 0 && prevIdx < pages.length) void loadImg(imgLeftRef, pages[prevIdx]);
    else unloadImg(imgLeftRef);
    if (nextIdx >= 0 && nextIdx < pages.length) void loadImg(imgRightRef, pages[nextIdx]);
    else unloadImg(imgRightRef);
    return () => {
      alive = false;
    };
  }, [viewMode, currentIndex, pages, settings.direction]);

  // ===== Immersive header auto-hide (only top-zone shows header) =====
  useEffect(() => {
    if (viewMode !== 'immersive') {
      setShowHeader(true);
      if (headerTimerRef.current) clearTimeout(headerTimerRef.current);
      return;
    }

    const handleMouse = (e) => {
      if (e.clientY >= getImmersiveTopTriggerHeight()) return;
      revealImmersiveHeader();
    };

    setShowHeader(false);
    window.addEventListener('mousemove', handleMouse, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleMouse);
      if (headerTimerRef.current) clearTimeout(headerTimerRef.current);
    };
  }, [getImmersiveTopTriggerHeight, revealImmersiveHeader, viewMode]);

  // ===== Page number visibility with overlap detection =====
  const pageIndicatorVisibilityMode = settings.pageIndicatorVisibilityMode;
  const [pageNumVisible, setPageNumVisible] = useState(true);
  const [pageIndicatorMode, setPageIndicatorMode] = useState('pinned');
  const pageNumTimerRef = useRef(null);
  const pageIndicatorTransientActiveRef = useRef(false);


  const showTransientPageIndicator = useCallback((duration = 1400) => {
    if (pageNumTimerRef.current) clearTimeout(pageNumTimerRef.current);
    pageIndicatorTransientActiveRef.current = true;
    setPageNumVisible(true);
    setPageIndicatorMode('transient');
    pageNumTimerRef.current = setTimeout(() => {
      pageIndicatorTransientActiveRef.current = false;
      pageNumTimerRef.current = null;
      setPageNumVisible(false);
    }, duration);
  }, []);

  const checkIndicatorOverlap = useCallback((preferVisible = false) => {
    const indicator = indicatorRef.current;
    const imgEl = imgCurrRef.current;
    if (!indicator || !imgEl) return;

    const baseGap = window.innerWidth < 960 ? 12 : 8;
    const loweredGap = window.innerWidth < 960 ? 2 : 0;

    const imageRect = imgEl.getBoundingClientRect();
    const renderRect = computeContainedImageRect(imageRect, imgEl.naturalWidth, imgEl.naturalHeight);
    const doesOverlap = (rect) => rectsOverlap(renderRect, rect, 6);

    const measureRectForBottom = (bottomGapPx) => {
      const width = indicator.offsetWidth || indicator.getBoundingClientRect().width;
      const height = indicator.offsetHeight || indicator.getBoundingClientRect().height;
      const left = isMobile
        ? (window.innerWidth - width) / 2
        : window.innerWidth - 20 - width;
      const bottom = window.innerHeight - bottomGapPx;
      return {
        left,
        right: left + width,
        top: bottom - height,
        bottom,
      };
    };

    const baseRect = measureRectForBottom(baseGap);
    if (!doesOverlap(baseRect)) {
      if (pageNumTimerRef.current) clearTimeout(pageNumTimerRef.current);
      pageNumTimerRef.current = null;
      pageIndicatorTransientActiveRef.current = false;
      setPageIndicatorMode('pinned');
      setPageNumVisible(true);
      return;
    }

    const loweredRect = measureRectForBottom(loweredGap);
    if (!doesOverlap(loweredRect)) {
      if (pageNumTimerRef.current) clearTimeout(pageNumTimerRef.current);
      pageNumTimerRef.current = null;
      pageIndicatorTransientActiveRef.current = false;
      setPageIndicatorMode('lowered');
      setPageNumVisible(true);
      return;
    }

    if (preferVisible) {
      showTransientPageIndicator();
      return;
    }

    if (pageIndicatorTransientActiveRef.current) {
      setPageIndicatorMode('transient');
      setPageNumVisible(true);
      return;
    }

    setPageIndicatorMode('transient');
    setPageNumVisible(false);
  }, [isMobile, showTransientPageIndicator]);

  useEffect(() => {
    if (viewMode !== 'immersive' || pageIndicatorVisibilityMode !== 'auto') {
      setPageNumVisible(true);
      setPageIndicatorMode('pinned');
      if (pageNumTimerRef.current) clearTimeout(pageNumTimerRef.current);
      pageNumTimerRef.current = null;
      pageIndicatorTransientActiveRef.current = false;
      if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null; }
      return;
    }

    if (pageNumTimerRef.current) clearTimeout(pageNumTimerRef.current);
    pageNumTimerRef.current = null;
    pageIndicatorTransientActiveRef.current = false;
    setPageNumVisible(true);
    setPageIndicatorMode('pinned');
    requestAnimationFrame(() => checkIndicatorOverlap(true));

    let overlapFrame = 0;
    const scheduleOverlapCheck = () => {
      if (overlapFrame) return;
      overlapFrame = requestAnimationFrame(() => {
        overlapFrame = 0;
        checkIndicatorOverlap();
      });
    };
    const ro = new ResizeObserver(scheduleOverlapCheck);
    resizeObserverRef.current = ro;

    const imgEl = imgCurrRef.current;
    if (imgEl) ro.observe(imgEl);
    if (indicatorRef.current) ro.observe(indicatorRef.current);
    window.addEventListener('resize', scheduleOverlapCheck, { passive: true });
    window.visualViewport?.addEventListener('resize', scheduleOverlapCheck, { passive: true });
    window.visualViewport?.addEventListener('scroll', scheduleOverlapCheck, { passive: true });

    return () => {
      if (pageNumTimerRef.current) clearTimeout(pageNumTimerRef.current);
      pageNumTimerRef.current = null;
      pageIndicatorTransientActiveRef.current = false;
      ro.disconnect();
      if (overlapFrame) cancelAnimationFrame(overlapFrame);
      window.removeEventListener('resize', scheduleOverlapCheck);
      window.visualViewport?.removeEventListener('resize', scheduleOverlapCheck);
      window.visualViewport?.removeEventListener('scroll', scheduleOverlapCheck);
    };
  }, [viewMode, currentIndex, pageIndicatorVisibilityMode, checkIndicatorOverlap]);

  // ===== Inject scrollbar-hide CSS =====
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'lrr-reader-scrollbar-hidden';
    style.innerHTML = `
      .no-scrollbar::-webkit-scrollbar { display: none !important; }
      .no-scrollbar { scrollbar-width: none !important; -ms-overflow-style: none !important; }
      [data-reader-immersive-stage="true"] { touch-action: none !important; }
      .reader-page-enter { transform: translateX(100%); }
      .reader-page-enter-active { transform: translateX(0); transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1); }
      .reader-page-exit { transform: translateX(0); }
      .reader-page-exit-active { transform: translateX(-100%); transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1); }
    `;
    document.head.appendChild(style);
    return () => { const el = document.getElementById('lrr-reader-scrollbar-hidden'); if (el) el.remove(); };
  }, []);

  // ===== 1. Init archive =====
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const serverUrl = serverUrlRef.current;

      if (coldRestoreRef.current && readerSnapshot) {
        let restoredArchive = readerSnapshot.archive || null;
        if (archiveHasNewMarker(restoredArchive)) {
          const progressKey = `${archiveId}:1`;
          lrrProgressSentRef.current.add(progressKey);
          try {
            await lrrApi.updateProgress(archiveId, 1);
            restoredArchive = clearArchiveNewMarker(restoredArchive);
          } catch {
            lrrProgressSentRef.current.delete(progressKey);
          }
        }
        if (cancelled) return;
        setArchive(restoredArchive);
        setPages(Array.isArray(readerSnapshot.pages) ? readerSnapshot.pages : []);
        setCurrentIndex(typeof readerSnapshot.currentIndex === 'number' ? readerSnapshot.currentIndex : 0);
        setDisplayedIndex(typeof readerSnapshot.displayedIndex === 'number' ? readerSnapshot.displayedIndex : 0);
        setLoadingUiArmed(false);
        setPageLoadPhase({
          status: 'loading',
          visibleIndex: typeof readerSnapshot.displayedIndex === 'number' ? readerSnapshot.displayedIndex : 0,
          targetIndex: typeof readerSnapshot.currentIndex === 'number' ? readerSnapshot.currentIndex : 0,
          progress: 0.08,
          shownAt: Date.now(),
        });
        setViewMode(readerSnapshot.viewMode || 'normal');
        setShowHeader(readerSnapshot.showHeader ?? true);
        setZoomScale(readerSnapshot.zoomScale || 1.0);
        setPanX(readerSnapshot.panX || 0);
        setPanY(readerSnapshot.panY || 0);
        setLoading(false);
        setLoadingPages(false);
        setReaderReady(true);
        return;
      }

      setLoading(true);
      setLoadingPages(true);
      try {
        let meta = await lrrApi.getArchive(archiveId);
        if (archiveHasNewMarker(meta)) {
          const progressKey = `${archiveId}:1`;
          lrrProgressSentRef.current.add(progressKey);
          try {
            await lrrApi.updateProgress(archiveId, 1);
            meta = { ...clearArchiveNewMarker(meta), progress: Math.max(1, Number.parseInt(meta.progress, 10) || 0) };
          } catch {
            lrrProgressSentRef.current.delete(progressKey);
          }
        }
        if (cancelled) return;
        setArchive(meta);
        setLoading(false);

        let extractedPages = [];

        try {
          const fileListRes = await lrrApi.getArchiveFiles(archiveId);
          if (cancelled) return;
          extractedPages = (fileListRes.pages || []).map((url) => normalizePageUrl(url, serverUrl)).filter(Boolean);
        } catch {
          const extractRes = await lrrApi.extractArchive(archiveId);
          if (cancelled) return;
          extractedPages = (extractRes.pages || []).map((url) => normalizePageUrl(url, serverUrl)).filter(Boolean);
        }

        if (cancelled) return;
        setPages(extractedPages);
        setLoadingPages(false);
        setReaderReady(true);
        const savedProgress = parseInt(meta.progress || 0);
        if (savedProgress > 0 && savedProgress <= extractedPages.length) {
          setCurrentIndex(savedProgress - 1);
          setDisplayedIndex(savedProgress - 1);
          setLoadingUiArmed(false);
          setPageLoadPhase({ status: 'loading', visibleIndex: savedProgress - 1, targetIndex: savedProgress - 1, progress: 0.08, shownAt: Date.now() });
        } else {
          setDisplayedIndex(0);
          setLoadingUiArmed(false);
          setPageLoadPhase({ status: extractedPages.length > 0 ? 'loading' : 'idle', visibleIndex: 0, targetIndex: 0, progress: extractedPages.length > 0 ? 0.08 : 0, shownAt: extractedPages.length > 0 ? Date.now() : 0 });
        }
      } catch (e) {
        if (!cancelled) {
          if (isArchiveMissingError(e)) {
            removeHistoryItem(archiveId).catch(() => {});
          }
          console.error('画廊解析失败:', e);
          setLoading(false);
          setLoadingPages(false);
          setReaderReady(false);
        }
      }
    };
    init();
    return () => { cancelled = true; };
  }, [archiveId, readerSnapshot]);

  // ===== 2. Save progress =====
  useEffect(() => {
    if (archive && pages.length > 0) {
      const page = currentIndex + 1;
      saveHistory(archive, page, { deferRemote: serverTracksProgress !== false }).catch(() => {});
      setHistoryEntries(getHistory());
      const archiveId = archive.arcid || archive.id;
      const totalPages = Number(archive.pagecount || pages.length) || 0;
      if (archiveId && totalPages > 0 && (currentIndex + 1) / totalPages > 0.8 && !watchlistAutoRemovedRef.current.has(archiveId)) {
        watchlistAutoRemovedRef.current.add(archiveId);
        removeWatchlistItem(archiveId).catch(() => {});
      }
      if (serverTracksProgress && archiveId) {
        const progressKey = `${archiveId}:${page}`;
        if (!lrrProgressSentRef.current.has(progressKey)) {
          lrrProgressSentRef.current.add(progressKey);
          lrrApi.updateProgress(archiveId, page).catch(() => {
            lrrProgressSentRef.current.delete(progressKey);
          });
        }
      }
    }
    return undefined;
  }, [currentIndex, archive, pages, serverTracksProgress]);

  // ===== Pointer down =====
  const handlePointerDown = useCallback((e) => {
    if (viewMode !== 'immersive') return;

    const touches = e.touches;
    const isTouchEvent = !!touches;

    if (isTouchEvent && touches.length >= 2) {
      isZoomingRef.current = true;
      isSwipingRef.current = false;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      pinchStartRef.current = {
        dist: Math.hypot(dx, dy),
        scale: zoomScaleRef.current,
        cx: (touches[0].clientX + touches[1].clientX) / 2,
        cy: (touches[0].clientY + touches[1].clientY) / 2,
      };
      return;
    }

    // Mobile browsers synthesize a mousedown event 100-300ms after touchstart.
    // If this mousedown arrives within 500ms of a real touch, skip tap tracking
    // to avoid falsely detecting a single tap as a double-tap.
    const now = Date.now();
    if (!isTouchEvent && now - lastTouchTimeRef.current < 500) return;
    if (isTouchEvent) lastTouchTimeRef.current = now;

    const clientX = isTouchEvent ? touches[0].clientX : e.clientX;
    const clientY = isTouchEvent ? touches[0].clientY : e.clientY;

    // Double-tap detection (works in both 100% and zoomed states)
    const dxTap = Math.abs(clientX - lastTapPosRef.current.x);
    const dyTap = Math.abs(clientY - lastTapPosRef.current.y);
    if (now - lastTapRef.current < 350 && dxTap < 30 && dyTap < 30) {
      if (singleTapTimerRef.current) { clearTimeout(singleTapTimerRef.current); singleTapTimerRef.current = null; }
      lastTapRef.current = 0;
      skipNextClickRef.current = true;
      const isZoomed = zoomScaleRef.current !== 1.0;
      const w = window.innerWidth;
      if (isZoomed) {
        applyZoomAtPoint(1.0, clientX, clientY);
      } else if (clientX >= w * 0.42 && clientX <= w * 0.58) {
        applyZoomAtPoint(1.75, clientX, clientY);
      }
      return;
    }
    lastTapRef.current = now;
    lastTapPosRef.current = { x: clientX, y: clientY };

    if (zoomScaleRef.current !== 1.0) {
      isPanningRef.current = true;
      panRef.current = {
        x: panRef.current.x, y: panRef.current.y,
        startX: clientX, startY: clientY,
        originX: panRef.current.x, originY: panRef.current.y,
      };
      swipeDidMoveRef.current = false;
      return;
    }

    swipeRef.current = { startX: clientX, startY: clientY, offset: 0 };
    swipeStartTimeRef.current = Date.now();
    swipeDidMoveRef.current = false;
    isSwipingRef.current = true;
    if (swipeRAF.current) { cancelAnimationFrame(swipeRAF.current); swipeRAF.current = null; }
    const sctr = swipeContainerRef.current;
    if (sctr) { sctr.style.transition = 'none'; sctr.style.transform = 'translateX(0px)'; }
    if (leftDivRef.current)  { leftDivRef.current.style.transition = 'none'; leftDivRef.current.style.transform = 'translateX(-100%)'; }
    if (rightDivRef.current) { rightDivRef.current.style.transition = 'none'; rightDivRef.current.style.transform = 'translateX(100%)'; }
  }, [applyZoomAtPoint, viewMode]);

  // ===== Pointer move (RAF-batched — translateX only, zero adjacent manipulation) =====
  const handlePointerMove = useCallback((e) => {
    if (viewMode !== 'immersive') return;

    const touches = e.touches;
    if (touches && touches.length >= 2 && isZoomingRef.current) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinchStartRef.current.dist > 0) {
        let scale = pinchStartRef.current.scale * (dist / pinchStartRef.current.dist);
        if (scale > 3.15) scale = 3.15;
        if (scale < 0.95) scale = 0.95;
        const cx = (touches[0].clientX + touches[1].clientX) / 2;
        const cy = (touches[0].clientY + touches[1].clientY) / 2;
        applyZoomAtPoint(scale, cx, cy);
      }
      return;
    }
    const moveClientX = touches ? touches[0].clientX : e.clientX;
    const moveClientY = touches ? touches[0].clientY : e.clientY;
    if (zoomScaleRef.current !== 1.0 || !isSwipingRef.current) {
      if (isPanningRef.current) {
        const dx = moveClientX - panRef.current.startX;
        const dy = moveClientY - panRef.current.startY;
        panRef.current.x = panRef.current.originX + dx;
        panRef.current.y = panRef.current.originY + dy;
        setPanX(panRef.current.x);
        setPanY(panRef.current.y);
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) swipeDidMoveRef.current = true;
      }
      return;
    }

    const clientX = moveClientX;
    const clientY = moveClientY;
    const deltaX = clientX - swipeRef.current.startX;
    const deltaY = clientY - swipeRef.current.startY;
    if (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) return;
    swipeDidMoveRef.current = true;

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      const curIdx = currentIndexRef.current;
      const totalPages = pagesLenRef.current;
      const l2r = settings.direction === 'ltr';
      const atFirst = curIdx === 0;
      const atLast = curIdx >= totalPages - 1;
      const toPrev = l2r ? (deltaX > 0) : (deltaX < 0);
      const toNext = l2r ? (deltaX < 0) : (deltaX > 0);
      const isBoundary = (atFirst && toPrev) || (atLast && toNext);

      // Always record the raw delta so handlePointerUp can evaluate the real
      // distance and velocity — clamping the visual transform must not clip the
      // data that the up-handler uses for the flip decision.
      swipeRef.current.offset = deltaX;

      if (!swipeRAF.current) {
        swipeRAF.current = requestAnimationFrame(() => {
          const raw = swipeRef.current.offset;
          const clamped = isBoundary ? Math.max(-50, Math.min(50, raw)) : raw;
          const sctr = swipeContainerRef.current;
          const ldiv = leftDivRef.current;
          const rdiv = rightDivRef.current;
          if (sctr) sctr.style.transform = `translateX(${clamped}px)`;
          if (!isBoundary || !(atFirst && toPrev)) {
            if (ldiv) ldiv.style.transform = `translateX(calc(-100% + ${clamped}px))`;
          }
          if (!isBoundary || !(atLast && toNext)) {
            if (rdiv) rdiv.style.transform = `translateX(calc(100% + ${clamped}px))`;
          }
          swipeRAF.current = null;
        });
      }
    }
  }, [applyZoomAtPoint, viewMode]);

  // ===== Pointer up =====
  const handlePointerUp = useCallback(() => {
    if (isZoomingRef.current) {
      isZoomingRef.current = false;
      pinchStartRef.current.dist = 0;
      // Snap back from overshoot
      const s = zoomScaleRef.current;
      let target = s;
      if (s > 3.0) target = 3.0;
      else if (s > 2.95) target = 3.0;
      if (s < 1.0) target = 1.0;
      else if (s < 1.05) target = 1.0;
      if (target !== s) {
        applyZoomAtPoint(target, pinchStartRef.current.cx || window.innerWidth / 2, pinchStartRef.current.cy || window.innerHeight / 2);
      }
      return;
    }
    if (isPanningRef.current) {
      isPanningRef.current = false;
      const s = zoomScaleRef.current;
      const maxTx = Math.max(0, (s - 1) * window.innerWidth / 2);
      const maxTy = Math.max(0, (s - 1) * window.innerHeight / 2);
      panRef.current.x = Math.max(-maxTx, Math.min(maxTx, panRef.current.x));
      panRef.current.y = Math.max(-maxTy, Math.min(maxTy, panRef.current.y));
      setPanX(panRef.current.x);
      setPanY(panRef.current.y);
      return;
    }
    if (zoomScaleRef.current !== 1.0 || !isSwipingRef.current) return;
    isSwipingRef.current = false;

    if (swipeRAF.current) { cancelAnimationFrame(swipeRAF.current); swipeRAF.current = null; }

    const animOut = (off) => {
      const s = swipeContainerRef.current, l = leftDivRef.current, r = rightDivRef.current;
      [s, l, r].forEach(el => { if (el) el.style.transition = 'transform 150ms ease-out'; });
      if (s) s.style.transform = `translateX(${off}px)`;
      if (l) l.style.transform = `translateX(calc(-100% + ${off}px))`;
      if (r) r.style.transform = `translateX(calc(100% + ${off}px))`;
    };
    const animReset = (off) => {
      const s = swipeContainerRef.current, l = leftDivRef.current, r = rightDivRef.current;
      [s, l, r].forEach(el => { if (el) el.style.transition = 'transform 180ms ease-out'; });
      if (s) s.style.transform = `translateX(${off}px)`;
      if (l) l.style.transform = `translateX(calc(-100% + ${off}px))`;
      if (r) r.style.transform = `translateX(calc(100% + ${off}px))`;
    };
    const resetAll = () => {
      const s = swipeContainerRef.current, l = leftDivRef.current, r = rightDivRef.current;
      if (s) { s.style.transition = 'none'; s.style.transform = 'translateX(0px)'; }
      if (l) { l.style.transition = 'none'; l.style.transform = 'translateX(-100%)'; }
      if (r) { r.style.transition = 'none'; r.style.transform = 'translateX(100%)'; }
    };

    const deltaX = swipeRef.current.offset;
    const elapsed = Math.max(Date.now() - swipeStartTimeRef.current, 1);
    const velocity = Math.abs(deltaX) / elapsed;

    const imgEl = imgCurrRef.current;
    const imgWidth = imgEl ? imgEl.offsetWidth : window.innerWidth;
    const threshold = Math.max(imgWidth * 0.20, 55);

    const l2r = settings.direction === 'ltr';
    const curIdx = currentIndexRef.current;
    const totalPages = pagesLenRef.current;
    const atFirst = curIdx === 0;
    const atLast = curIdx >= totalPages - 1;
    const toPrev = l2r ? (deltaX > 0) : (deltaX < 0);
    const toNext = l2r ? (deltaX < 0) : (deltaX > 0);
    const nextIdx = toPrev ? Math.max(curIdx - 1, 0) : Math.min(curIdx + 1, totalPages - 1);

    const shouldFlip = Math.abs(deltaX) > threshold || velocity > 0.55;

    if (atFirst && toPrev) {
      animReset(0);
      setTimeout(resetAll, 180);
      return;
    }

    if (atLast && toNext) {
      if (shouldFlip && Math.abs(deltaX) > 8) {
        animOut((deltaX > 0 ? 1 : -1) * window.innerWidth);
        setTimeout(() => {
          flushSync(() => {
            setViewMode('normal');
          });
          resetAll();
        }, 150);
        return;
      } else {
        animReset(0);
        setTimeout(resetAll, 180);
        return;
      }
    }

    if (shouldFlip && Math.abs(deltaX) > 8) {
      const dir = deltaX > 0 ? 1 : -1;
      animOut(dir * window.innerWidth);
      setTimeout(() => {
        const previewImg = deltaX > 0 ? imgLeftRef.current : imgRightRef.current;
        const currImg = imgCurrRef.current;
        const previewSrc = previewImg?.currentSrc || previewImg?.src || '';
        const canPromotePreview = !!(
          currImg &&
          previewImg &&
          previewSrc &&
          previewImg.style.display !== 'none' &&
          previewImg.complete &&
          previewImg.naturalWidth > 0
        );
        const forwardTarget = deltaX > 0 ? curIdx - 1 : curIdx + 1;
        const backwardTarget = deltaX > 0 ? curIdx + 1 : curIdx - 1;
        const targetIndex = settings.direction === 'ltr' ? forwardTarget : backwardTarget;
        if (currImg) {
          if (canPromotePreview) {
            currImg.style.display = '';
            currImg.src = previewSrc;
          } else {
            // If target image is not ready yet, hide the previous page so it
            // doesn't flash back into view when the swipe container recenters.
            currImg.src = '';
            currImg.style.display = 'none';
          }
        }
        flushSync(() => {
          commitPageTargetRef.current?.(targetIndex, {
            showIndicator: true,
            assumeVisible: canPromotePreview,
            preserveSwipePosition: true,
          });
        });
        resetAll();
      }, 150);
      return;
    }

    animReset(0);
    setTimeout(resetAll, 180);
  }, [applyZoomAtPoint, settings.direction]);

  // ===== Click zones: left 45% / middle 10% / right 45% (top 12% excluded on mobile) =====
  const handleScreenClick = useCallback((e) => {
    if (viewMode !== 'immersive') return;
    if (skipNextClickRef.current) { skipNextClickRef.current = false; return; }
    if (swipeDidMoveRef.current) { swipeDidMoveRef.current = false; return; }
    if (zoomScaleRef.current !== 1.0) return;

    if (e.clientY < getImmersiveTopTriggerHeight()) {
      revealImmersiveHeader();
      return;
    }

    const x = e.clientX;
    const w = window.innerWidth;

    if (x < w * 0.45) {
      settings.direction === 'ltr' ? handlePrevRef.current() : handleNextRef.current();
    } else if (x > w * 0.55) {
      settings.direction === 'ltr' ? handleNextRef.current() : handlePrevRef.current();
    }
  }, [getImmersiveTopTriggerHeight, revealImmersiveHeader, viewMode, settings.direction]);

  // ===== Wheel zoom =====
  useEffect(() => {
    if (viewMode !== 'immersive') return;
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (e.cancelable) e.preventDefault();
      const delta = -e.deltaY * 0.002;
      let s = zoomScaleRef.current + delta;
      if (s < 1) s = 1;
      if (s > 5) s = 5;
      if (Math.abs(s - zoomScaleRef.current) > 0.01) {
        applyZoomAtPoint(s, e.clientX, e.clientY);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoomAtPoint, viewMode]);

  const commitPageTarget = useCallback((targetIndex, { resetZoom = true, showIndicator = false, assumeVisible = false, preserveSwipePosition = false } = {}) => {
    if (pages.length === 0) return;
    const bounded = Math.max(0, Math.min(targetIndex, pages.length - 1));
    void exitColdRestoreMode();
    setLoadingUiArmed(false);
    if (resetZoom) {
      zoomScaleRef.current = 1.0;
      setZoomScale(1.0);
    }
    if (showIndicator && viewMode === 'immersive') {
      showTransientPageIndicator();
    }
    if (assumeVisible) {
      setDisplayedIndex(bounded);
    }
    setCurrentIndex(bounded);
    setPageLoadPhase((prev) => ({
      status: assumeVisible || bounded === prev.visibleIndex ? 'ready' : 'loading',
      visibleIndex: assumeVisible ? bounded : prev.visibleIndex,
      targetIndex: bounded,
      progress: assumeVisible || bounded === prev.visibleIndex ? 1 : 0.12,
      shownAt: assumeVisible || bounded === prev.visibleIndex ? prev.shownAt : Date.now(),
    }));
    if (!preserveSwipePosition && swipeContainerRef.current) swipeContainerRef.current.style.transform = 'translateX(0px)';
  }, [exitColdRestoreMode, pages.length, showTransientPageIndicator, viewMode]);
  commitPageTargetRef.current = commitPageTarget;

  // ===== 3. Auto turn timer =====
  useEffect(() => {
    const pageReady = pageLoadPhase.status === 'ready' && pageLoadPhase.targetIndex === currentIndex;
    if (settings.autoTurnActive && viewMode === 'immersive' && pageReady) {
      if (progressBarRef.current) {
        progressBarRef.current.style.transition = 'none';
        progressBarRef.current.style.width = '0%';
        void progressBarRef.current.offsetWidth;
        progressBarRef.current.style.transition = `width ${settings.autoTurnInterval}s linear`;
        progressBarRef.current.style.width = '100%';
      }
      autoTurnTimerRef.current = setTimeout(() => handleNextRef.current(), settings.autoTurnInterval * 1000);
    } else {
      if (autoTurnTimerRef.current) clearTimeout(autoTurnTimerRef.current);
      if (progressBarRef.current) {
        progressBarRef.current.style.transition = 'none';
        progressBarRef.current.style.width = '0%';
      }
    }
    return () => { if (autoTurnTimerRef.current) clearTimeout(autoTurnTimerRef.current); };
  }, [settings.autoTurnActive, currentIndex, settings.autoTurnInterval, viewMode, pageLoadPhase.status, pageLoadPhase.targetIndex]);

  // ===== Page flip =====
  const handleNext = useCallback(() => {
    if (viewMode === 'immersive' && currentIndex >= pages.length - 1) {
      setViewMode('normal');
      return;
    }
    commitPageTarget(currentIndex + 1, { showIndicator: viewMode === 'immersive' });
  }, [commitPageTarget, currentIndex, pages.length, viewMode]);

  const handlePrev = useCallback(() => {
    commitPageTarget(currentIndex - 1, { showIndicator: viewMode === 'immersive' });
  }, [commitPageTarget, currentIndex, viewMode]);

  const handleNextRef = useRef(handleNext);
  const handlePrevRef = useRef(handlePrev);
  handleNextRef.current = handleNext;
  handlePrevRef.current = handlePrev;
  viewModeRef.current = viewMode;

  const handlePageVisualLoadStart = useCallback((pageIndex) => {
    if (typeof pageIndex !== 'number') return;
    setPageLoadPhase((prev) => (
      pageIndex !== prev.targetIndex
        ? prev
        : { ...prev, status: 'loading', progress: Math.max(prev.progress || 0, 0.28) }
    ));
  }, []);

  const handlePageVisualReady = useCallback((pageIndex) => {
    if (typeof pageIndex !== 'number') return;
    setDisplayedIndex(pageIndex);
    setLoadingUiArmed(false);
    setPageLoadPhase((prev) => (
      pageIndex !== prev.targetIndex
        ? prev
        : { status: 'ready', visibleIndex: pageIndex, targetIndex: pageIndex, progress: 1, shownAt: prev.shownAt }
    ));
  }, []);

  const handlePageVisualError = useCallback((pageIndex) => {
    if (typeof pageIndex !== 'number') return;
    setPageLoadPhase((prev) => (
      pageIndex !== prev.targetIndex
        ? prev
        : { ...prev, status: 'error', progress: 1 }
    ));
  }, []);

  useEffect(() => {
    if (pageLoadPhase.status !== 'loading') return undefined;
    const timer = setInterval(() => {
      setPageLoadPhase((prev) => {
        if (prev.status !== 'loading') return prev;
        const nextProgress = Math.min(0.9, (prev.progress || 0.12) + 0.08);
        if (nextProgress === prev.progress) return prev;
        return { ...prev, progress: nextProgress };
      });
    }, 180);
    return () => clearInterval(timer);
  }, [pageLoadPhase.status, pageLoadPhase.targetIndex]);

  useEffect(() => {
    if (
      pageLoadPhase.status !== 'loading' ||
      pageLoadPhase.targetIndex !== currentIndex ||
      currentIndex === displayedIndex
    ) {
      setLoadingUiArmed(false);
      return undefined;
    }
    const timer = setTimeout(() => setLoadingUiArmed(true), 180);
    return () => clearTimeout(timer);
  }, [currentIndex, displayedIndex, pageLoadPhase.status, pageLoadPhase.targetIndex]);

  const confirmRemoveHistory = useCallback(() => {
    if (!historyDeleteTarget?.id) return;
    removeHistoryItem(historyDeleteTarget.id).catch(() => {});
    setHistoryEntries(getHistory());
    setHistoryDeleteTarget(null);
  }, [historyDeleteTarget]);

  const handleRemoveWatchlist = useCallback((item) => {
    const id = item?.id || item?.arcid;
    if (!id) return;
    removeWatchlistItem(id).finally(() => setWatchlistEntries(getWatchlist()));
  }, []);

  const handleSetCover = useCallback(() => {
    if (!archiveId || pages.length === 0 || coverSetting) return;
    setCoverConfirmPage(currentIndex + 1);
  }, [archiveId, coverSetting, currentIndex, pages.length]);

  const confirmSetCover = useCallback(async () => {
    if (!archiveId || !coverConfirmPage || coverSetting) return;
    const page = coverConfirmPage;
    setCoverSetting(true);
    try {
      await lrrApi.setArchiveThumbnail(archiveId, page);
      clearImageCache();
      setCoverSetPage(page);
      setCoverConfirmPage(0);
      setTimeout(() => setCoverSetPage((prev) => (prev === page ? 0 : prev)), 1800);
    } catch (err) {
      alert(err.message || '设置封面失败');
    } finally {
      setCoverSetting(false);
    }
  }, [archiveId, coverConfirmPage, coverSetting]);

  // ===== Back handler: immersive → normal mode, not home =====
  const handleGoBack = useCallback(() => {
    if (viewMode === 'immersive') {
      setViewMode('normal');
    } else {
      if (archive && pages.length > 0) {
        saveHistory(archive, currentIndex + 1).then(() => flushHistorySync()).catch(() => {});
        setHistoryEntries(getHistory());
      }
      onBack();
    }
  }, [archive, currentIndex, onBack, pages.length, viewMode]);

  // ===== Preload indices =====
  const getPreloadIndices = () => {
    const indices = [];
    const forwardFirst = settings.direction === 'ltr' ? 1 : -1;
    for (let i = 1; i <= settings.preloadCount; i++) {
      const primary = currentIndex + (i * forwardFirst);
      const secondary = currentIndex - (i * forwardFirst);
      if (primary >= 0 && primary < pages.length) indices.push(primary);
      if (secondary >= 0 && secondary < pages.length) indices.push(secondary);
    }
    return indices;
  };

  const currentTags = archive?.tags?.split(',').map((t) => t.trim()).filter(Boolean) || [];
  const sourceTag = currentTags.find((t) => t.toLowerCase().startsWith('source:'));
  const rawSourceUrl = sourceTag ? sourceTag.replace(/source:\s*/i, '') : null;
  const sourceUrl = (() => {
    if (!rawSourceUrl) return null;
    try {
      const u = new URL(/^https?:\/\//i.test(rawSourceUrl) ? rawSourceUrl : 'https://' + rawSourceUrl);
      if (u.hostname === 'e-hentai.org' || u.hostname === 'exhentai.org') return rawSourceUrl;
    } catch {}
    return null;
  })();
  const groupedTags = useMemo(() => categorizeTags(currentTags), [archive?.tags]);

  const historyList = useMemo(() => {
    return hideRead ? historyEntries.filter(h => !(h.total > 0 && h.page >= h.total)) : historyEntries;
  }, [hideRead, historyEntries]);
  const archivePanel = getReaderArchivePanelModel(archivePanelType, {
    historyItems: historyList,
    watchlistItems: watchlistEntries,
    randomItems: randomEntries,
    historyEmptyMessage: hideRead && historyEntries.length > 0 ? '所有归档均已读完' : '暂无阅读历史',
    watchlistEmptyMessage: '暂无待看归档',
    randomEmptyMessage: randomEntriesLoading ? '正在获取随机归档…' : '暂无随机漫游结果',
    removeHistory: setHistoryDeleteTarget,
    removeWatchlist: handleRemoveWatchlist,
  });

  useEffect(() => {
    if (!showArchivePanel || archivePanelType !== 'random') return undefined;
    let active = true;
    setRandomEntriesLoading(true);
    lrrApi.getRandom(16)
      .then((response) => {
        if (active) setRandomEntries(Array.isArray(response?.data) ? response.data : []);
      })
      .catch(() => {
        if (active) setRandomEntries([]);
      })
      .finally(() => {
        if (active) setRandomEntriesLoading(false);
      });
    return () => { active = false; };
  }, [archivePanelType, showArchivePanel]);

  useEffect(() => {
    if (viewMode !== 'immersive') return;
    setShowSettingsPanel(false);
    setShowArchivePanel(false);
  }, [viewMode]);

  const drawerGridWidth = Math.max(0, drawerViewport.width || (isMobile ? 0 : 372));
  const drawerItemWidth = getDrawerItemWidth(drawerGridWidth);
  const drawerRowHeight = getDrawerRowHeight(drawerGridWidth);
  const drawerTotalRows = Math.ceil(pages.length / DRAWER_COLUMNS);
  const drawerVisibleStartRow = Math.max(0, Math.floor((drawerViewport.scrollTop / Math.max(drawerRowHeight, 1))) - DRAWER_OVERSCAN_ROWS);
  const drawerVisibleEndRow = Math.min(
    drawerTotalRows,
    Math.ceil(((drawerViewport.scrollTop + drawerViewport.height) / Math.max(drawerRowHeight, 1))) + DRAWER_OVERSCAN_ROWS,
  );
  const drawerSliceStart = drawerVisibleStartRow * DRAWER_COLUMNS;
  const drawerSliceEnd = Math.min(pages.length, Math.max(drawerSliceStart, drawerVisibleEndRow * DRAWER_COLUMNS));
  const drawerVisiblePages = pages.slice(drawerSliceStart, drawerSliceEnd);
  const drawerTopSpacer = drawerVisibleStartRow * drawerRowHeight;
  const drawerBottomSpacer = Math.max(0, (drawerTotalRows - drawerVisibleEndRow) * drawerRowHeight);

  useEffect(() => {
    if (archive && pages.length > 0) {
      setReaderReady(true);
    }
  }, [archive, pages.length]);

  useEffect(() => {
    if (!showDrawer || pages.length === 0) {
      setDrawerPrefetchSet(new Set());
      return undefined;
    }

    const firstWave = new Set();
    const preloadRadius = 6;
    for (let offset = -preloadRadius; offset <= preloadRadius; offset += 1) {
      const idx = currentIndex + offset;
      if (idx >= 0 && idx < pages.length) firstWave.add(idx);
    }
    const viewportStart = Math.max(0, drawerSliceStart - DRAWER_COLUMNS);
    const viewportEnd = Math.min(pages.length, drawerSliceEnd + DRAWER_COLUMNS);
    for (let idx = viewportStart; idx < viewportEnd; idx += 1) {
      firstWave.add(idx);
    }
    setDrawerPrefetchSet(firstWave);
    return undefined;
  }, [currentIndex, drawerSliceEnd, drawerSliceStart, pages.length, showDrawer]);

  useEffect(() => {
    if (!showDrawer || !archiveId || pages.length === 0 || assetCacheOnly) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      lrrApi.queueArchivePageThumbnails(archiveId).catch(() => {});
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [archiveId, assetCacheOnly, pages.length, showDrawer]);

  useEffect(() => {
    if (!showDrawer) {
      setDrawerViewport((prev) => (prev.height === 0 && prev.scrollTop === 0 && prev.width === 0
        ? prev
        : { height: 0, scrollTop: 0, width: 0 }));
      return undefined;
    }

    const el = drawerGridRef.current;
    if (!el) return undefined;

    const updateViewport = () => {
      const nextTop = el.scrollTop;
      const nextHeight = el.clientHeight;
      const nextWidth = Math.round(el.getBoundingClientRect().width);

      setDrawerViewport((prev) => {
        const prevRowHeight = getDrawerRowHeight(prev.width || nextWidth);
        const nextRowHeight = getDrawerRowHeight(nextWidth);
        const prevStartRow = Math.max(0, Math.floor((prev.scrollTop / Math.max(prevRowHeight, 1))) - DRAWER_OVERSCAN_ROWS);
        const prevEndRow = Math.min(
          Math.ceil(pages.length / DRAWER_COLUMNS),
          Math.ceil(((prev.scrollTop + prev.height) / Math.max(prevRowHeight, 1))) + DRAWER_OVERSCAN_ROWS,
        );
        const nextStartRow = Math.max(0, Math.floor((nextTop / Math.max(nextRowHeight, 1))) - DRAWER_OVERSCAN_ROWS);
        const nextEndRow = Math.min(
          Math.ceil(pages.length / DRAWER_COLUMNS),
          Math.ceil(((nextTop + nextHeight) / Math.max(nextRowHeight, 1))) + DRAWER_OVERSCAN_ROWS,
        );
        const next = {
          height: nextHeight,
          scrollTop: nextTop,
          width: nextWidth,
        };
        if (
          prev.height === next.height &&
          prev.width === next.width &&
          prevStartRow === nextStartRow &&
          prevEndRow === nextEndRow
        ) {
          return prev;
        }
        return next;
      });
    };

    updateViewport();
    el.addEventListener('scroll', updateViewport, { passive: true });
    window.addEventListener('resize', updateViewport);

    return () => {
      el.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, [showDrawer]);

  useEffect(() => {
    if (!showDrawer) return;
    const el = drawerGridRef.current;
    if (!el || drawerRowHeight <= 0) return;
    const targetRow = Math.max(0, Math.floor(currentIndex / DRAWER_COLUMNS) - 1);
    const targetTop = targetRow * drawerRowHeight;
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const nextTop = Math.max(0, Math.min(targetTop, maxTop));
    if (Math.abs(el.scrollTop - nextTop) > 8) {
      el.scrollTop = nextTop;
      const nextWidth = Math.round(el.getBoundingClientRect().width);
      setDrawerViewport((prev) => (
        prev.scrollTop === nextTop && prev.height === el.clientHeight && prev.width === nextWidth
          ? prev
          : { ...prev, scrollTop: nextTop, height: el.clientHeight, width: nextWidth }
      ));
    }
  }, [currentIndex, drawerRowHeight, showDrawer]);

  useEffect(() => {
    if (!readerReady) return undefined;
    const timer = setTimeout(() => {
      const hasVisiblePage = pages.length > 0;
      const hasSource = !!sourceUrl;
      if (hasVisiblePage && assetCacheOnly) {
        void exitColdRestoreMode();
      } else if (hasSource) {
        const recPanel = document.querySelector('[data-lrr-recommendations]');
        const commentPanel = document.querySelector('[data-lrr-eh-comments]');
        if (!recPanel || !commentPanel) {
          void exitColdRestoreMode();
        }
      }
    }, 1800);
    return () => clearTimeout(timer);
  }, [assetCacheOnly, exitColdRestoreMode, pages.length, readerReady, sourceUrl]);

  useEffect(() => {
    if (pages.length === 0) return;
    if (coldRestoreRef.current) return;
    const indices = [currentIndex, ...getPreloadIndices()];
    indices.slice(0, Math.max(2, settings.preloadCount + 1)).forEach((idx) => {
      const pageUrl = pages[idx];
      if (pageUrl) primePageImage(pageUrl).catch(() => {});
    });
  }, [currentIndex, pages, settings.preloadCount]);

  // ===== Outside-click to close panels =====
  useEffect(() => {
    if (!showSettingsPanel && !showArchivePanel) return;
    if (!readerReady) return undefined;
    const handler = (e) => {
      const t = e.target;
      if (t?.closest?.('[data-panel]') || t?.closest?.('[data-panel-toggle]') || t?.closest?.('[data-select-dropdown]') || t?.closest?.('[data-dialog-root]') || t?.closest?.('[data-dialog-overlay]')) return;
      setShowSettingsPanel(false);
      setShowArchivePanel(false);
    };
    window.addEventListener('mousedown', handler, { passive: true });
    return () => window.removeEventListener('mousedown', handler);
  }, [readerReady, showArchivePanel, showSettingsPanel]);

  if (loading) {
    return <ReaderStageSkeleton title={archive?.title || ''} hasMeta={false} hasPages={false} isMobile={isMobile} />;
  }

  if (loadingPages && pages.length === 0) {
    return <ReaderStageSkeleton title={archive?.title || ''} hasMeta={!!archive} hasPages={false} isMobile={isMobile} />;
  }

  const isLTR = settings.direction === 'ltr';
  const leftAction = isLTR ? handlePrev : handleNext;
  const rightAction = isLTR ? handleNext : handlePrev;
  const leftDisabled = isLTR ? currentIndex === 0 : currentIndex === pages.length - 1;
  const rightDisabled = isLTR ? currentIndex === pages.length - 1 : currentIndex === 0;

  const btnBase = getTopBarButtonStyle(toolbarCompact);

  const navBtnBase = getPageNavButtonStyle(isMobile);
  const normalReaderFrameStyle = getNormalReaderFrameStyle(isMobile);
  const webtoonActive = settings.readingLayout === 'webtoon' || (settings.readingLayout === 'auto' && autoWebtoon);
  const scaleStyle = settings.scaleMode === 'fit-width' ? { width: '100%', height: 'auto', objectFit: 'contain' }
    : settings.scaleMode === 'fit-height' ? { width: 'auto', height: '100%', objectFit: 'contain' }
      : settings.scaleMode === 'original' ? { width: 'auto', height: 'auto', maxWidth: 'none', maxHeight: 'none', objectFit: 'none' }
        : { width: '100%', height: '100%', objectFit: 'contain' };
  const transformStyle = settings.rotateWidePagesEnabled ? { transform: 'rotate(90deg) scale(.82)' } : {};
  const normalTargetIndex = Math.max(0, Math.min(currentIndex, Math.max(pages.length - 1, 0)));
  const targetPending = pages.length > 0 && currentIndex !== displayedIndex;
  const loadingUiVisible = targetPending && pageLoadPhase.status === 'loading' && loadingUiArmed;
  const normalPagePending = viewMode === 'normal' && loadingUiVisible;
  const pageLoadingProgress = Math.max(0, Math.min(1, pageLoadPhase.progress || 0));
  const immersiveManualPending = viewMode === 'immersive' && !settings.autoTurnActive && loadingUiVisible;
  const immersiveManualError = viewMode === 'immersive' && !settings.autoTurnActive && targetPending && pageLoadPhase.status === 'error';
  const normalDisplayIndex = normalTargetIndex;
  const pageIndicatorShouldRender = pageIndicatorVisibilityMode !== 'hidden';
  const pageIndicatorShouldShow = zoomScale === 1.0 && (
    pageIndicatorVisibilityMode === 'pinned' ||
    (pageIndicatorVisibilityMode === 'auto' && pageNumVisible)
  );
  // Keep swipe-related refs in sync (closure-free access for handlePointerMove/Up)
  currentIndexRef.current = currentIndex;
  pagesLenRef.current = pages.length;
  zoomScaleRef.current = zoomScale;

  return (
    <div
      ref={containerRef}
      className="reader-root"
      data-ios={isIosWebKit ? 'true' : 'false'}
      style={{
        minHeight: '100vh',
        background: viewMode === 'normal' ? 'transparent' : '#000',
        color: viewMode === 'immersive' ? '#fff' : 'var(--text-main)',
      }}
    >
      <div
        style={viewMode === 'normal'
          ? { display: 'flex', flexDirection: 'column', position: 'relative', touchAction: 'manipulation' }
          : { height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', touchAction: 'none' }}
      >
        {/* ===== Top Bar ===== */}
        <div
          ref={toolbarRef}
          className="reader-toolbar"
          data-reader-toolbar
          data-mobile={isMobile ? 'true' : 'false'}
          data-compact={toolbarCompact ? 'true' : 'false'}
          style={{
            padding: '14px 24px',
            background: 'var(--reader-toolbar-bg)',
            backdropFilter: 'blur(16px)',
            borderBottom: '1px solid var(--reader-control-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            position: viewMode === 'immersive' ? 'absolute' : 'relative',
            top: 0, left: 0, right: 0, zIndex: 100,
            transform: viewMode === 'immersive' && !showHeader ? 'translateY(-100%)' : 'translateY(0)',
            transition: 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
          }}
        >
          <div className="reader-toolbar-group reader-toolbar-group-left" style={{ display: 'flex', alignItems: 'center', gap: toolbarCompact ? '6px' : '16px', flex: '1 0 0', minWidth: 0 }}>
            <button className="reader-toolbar-button" style={btnBase} onClick={handleGoBack} title="返回" aria-label="返回">
              <ReaderToolbarButtonContent icon="back" label="返回" size={20} />
            </button>
            {viewMode !== 'immersive' && (
              <button
                className="reader-toolbar-button"
                disabled={!readerReady}
                style={{ ...btnBase, opacity: readerReady ? 1 : 0.45, cursor: readerReady ? 'pointer' : 'not-allowed' }}
                data-panel-toggle
                onClick={() => { if (readerReady) { setShowArchivePanel((visible) => !visible); setShowSettingsPanel(false); } }}
                title="快速跳转"
                aria-label="打开快速跳转"
              >
                <ReaderToolbarButtonContent icon="quickJump" label="快速跳转" />
              </button>
            )}
          </div>

          {!toolbarCompact && (
            <span
              className="reader-toolbar-title"
              style={{
                fontSize: '15px',
                fontWeight: 'bold',
                textAlign: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: '0 1 auto',
                maxWidth: '50vw',
                minWidth: 0,
              }}
            >
              {archive?.title}
            </span>
          )}
          {toolbarCompact && <span style={{ flex: '0 0 0', minWidth: 0 }} />}

          <div className="reader-toolbar-group reader-toolbar-group-right" style={{ display: 'flex', alignItems: 'center', gap: toolbarCompact ? '6px' : '8px', flex: '1 0 0', justifyContent: 'flex-end', minWidth: 0 }}>
            {viewMode === 'immersive' && (
              <button className="reader-toolbar-button" style={btnBase} onClick={() => updateSettings((s) => ({ ...s, autoTurnActive: !s.autoTurnActive }))} title={settings.autoTurnActive ? '停止翻页' : '自动翻页'} aria-label={settings.autoTurnActive ? '停止翻页' : '自动翻页'}>
                <ReaderToolbarButtonContent
                  icon={settings.autoTurnActive ? 'pause' : 'play'}
                  label={settings.autoTurnActive ? '停止翻页' : '自动翻页'}
                />
              </button>
            )}
            <button
              className="reader-toolbar-button"
              style={btnBase}
              onClick={() => { setViewMode(viewMode === 'normal' ? 'immersive' : 'normal'); }}
              title={viewMode === 'normal' ? '沉浸模式' : '退出沉浸'}
              aria-label={viewMode === 'normal' ? '沉浸模式' : '退出沉浸'}
            >
              <ReaderToolbarButtonContent
                icon={viewMode === 'normal' ? 'fullscreen' : 'fullscreenExit'}
                label={viewMode === 'normal' ? '沉浸模式' : '退出沉浸'}
              />
            </button>
            {viewMode !== 'immersive' && (
              <>
                <button
                  className="reader-toolbar-button"
                  disabled={!readerReady || pages.length === 0 || coverSetting}
                  style={{
                    ...btnBase,
                    opacity: (!readerReady || pages.length === 0 || coverSetting) ? 0.45 : 1,
                    cursor: (!readerReady || pages.length === 0 || coverSetting) ? 'not-allowed' : 'pointer',
                  }}
                  onClick={handleSetCover}
                  title={`将当前第 ${currentIndex + 1} 页设为封面`}
                  aria-label={`将当前第 ${currentIndex + 1} 页设为封面`}
                >
                  <ReaderToolbarButtonContent
                    icon="cover"
                    label={coverSetting ? '设置中...' : coverSetPage === currentIndex + 1 ? '已设为封面' : '设为封面'}
                  />
                </button>
                <button className="reader-toolbar-button" style={btnBase} data-panel-toggle onClick={() => { setShowSettingsPanel((v) => !v); setShowArchivePanel(false); }} title="阅读设定" aria-label="阅读设定">
                  <ReaderToolbarButtonContent icon="settings" label="阅读设定" />
                </button>
              </>
            )}
            <button className="reader-toolbar-button" style={btnBase} onClick={() => setShowDrawer(true)} title="缩略面板" aria-label="缩略面板">
              <ReaderToolbarButtonContent icon="grid" label="缩略面板" />
            </button>
          </div>
        </div>

        {/* ===== Settings Panel ===== */}
        {showSettingsPanel && (
          <div data-panel="settings"
            className="reader-panel-surface glass-panel dropdown-animate"
            style={{
              position: 'absolute',
              top: '62px',
              right: '20px',
              zIndex: 9999,
              padding: '22px',
              borderRadius: '14px',
              width: isMobile ? 'calc(100vw - 40px)' : '380px',
              maxHeight: '80vh',
              boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
              border: '1px solid var(--reader-control-border)',
              display: 'flex', flexDirection: 'column',
            }}
          >
            <div className="no-scrollbar" style={{ overflowY: 'auto', flex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: 600, marginBottom: '10px', borderBottom: '1px solid var(--reader-control-border)', paddingBottom: '6px' }}>翻页设定</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-sub)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <span style={{ flexShrink: 0 }}>翻页流向</span>
                    <div style={{ width: '135px', flexShrink: 0 }}>
                      <CustomSelect
                        value={settings.direction}
                        options={[{ label: '从左向右', value: 'ltr' }, { label: '从右向左', value: 'rtl' }]}
                        onChange={(v) => updateSettings((s) => ({ ...s, direction: v }))}
                        compact
                      />
                    </div>
                  </label>
                  <label style={{ fontSize: '12px', color: 'var(--text-sub)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <span>页码指示器</span>
                    <div style={{ width: '135px' }}><CustomSelect value={settings.pageIndicatorVisibilityMode} options={[{ label: '自动避让', value: 'auto' }, { label: '始终显示', value: 'pinned' }, { label: '隐藏', value: 'hidden' }]} onChange={(v) => updateSettings((s) => ({ ...s, pageIndicatorVisibilityMode: v }))} compact /></div>
                  </label>
                  <label style={{ fontSize: '12px', color: 'var(--text-sub)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <span>阅读布局</span>
                    <div style={{ width: '135px' }}><CustomSelect value={settings.readingLayout} options={[{ label: '单页', value: 'single' }, { label: '双页', value: 'double' }, { label: 'Webtoon', value: 'webtoon' }, { label: '自动检测', value: 'auto' }]} onChange={(v) => updateSettings((s) => ({ ...s, readingLayout: v }))} compact /></div>
                  </label>
                  <label style={{ fontSize: '12px', color: 'var(--text-sub)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <span>缩放模式</span>
                    <div style={{ width: '135px' }}><CustomSelect value={settings.scaleMode} options={[{ label: '适应屏幕', value: 'fit-screen' }, { label: '适应宽度', value: 'fit-width' }, { label: '适应高度', value: 'fit-height' }, { label: '原始尺寸', value: 'original' }]} onChange={(v) => updateSettings((s) => ({ ...s, scaleMode: v }))} compact /></div>
                  </label>
                  {[
                    ['cropBordersEnabled', '自动裁白边'],
                    ['splitWidePagesEnabled', '拆分宽页'], ['rotateWidePagesEnabled', '旋转宽页'],
                  ].map(([key, label]) => (
                    <label key={key} style={{ fontSize: '12px', color: 'var(--text-sub)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      {label}<ToggleSwitch label={label} checked={settings[key]} onChange={(checked) => updateSettings((s) => ({ ...s, [key]: checked }))} />
                    </label>
                  ))}
                  <label style={{ fontSize: '12px', color: 'var(--text-sub)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    预加载
                    <input type="text" inputMode="numeric" pattern="[0-9]*" className="input-glass no-spinner"
                      value={preloadInput}
                      onChange={(e) => { const raw = e.target.value; setPreloadInput(raw); const n = parseInt(raw, 10); if (!isNaN(n) && n >= 1 && n <= 10) { updateSettings((s) => ({ ...s, preloadCount: n })); } }}
                      onBlur={() => { const n = parseInt(preloadInput, 10); if (isNaN(n) || n < 1) { setPreloadInput('1'); updateSettings((s) => ({ ...s, preloadCount: 1 })); } else if (n > 10) { setPreloadInput('10'); updateSettings((s) => ({ ...s, preloadCount: 10 })); } }}
                      style={{ width: '56px', padding: '5px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--reader-control-border)', background: 'var(--comment-input-bg)', color: 'var(--text-main)', textAlign: 'center' }}
                    />
                  </label>
                  <label style={{ fontSize: '12px', color: 'var(--text-sub)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    翻页间隔(秒)
                    <input type="text" inputMode="numeric" pattern="[0-9]*" className="input-glass no-spinner"
                      value={autoTurnInput}
                      onChange={(e) => { const raw = e.target.value; setAutoTurnInput(raw); const n = parseInt(raw, 10); if (!isNaN(n) && n >= 1 && n <= 60) { updateSettings((s) => ({ ...s, autoTurnInterval: n })); } }}
                      onBlur={() => { const n = parseInt(autoTurnInput, 10); if (isNaN(n) || n < 1) { setAutoTurnInput('1'); updateSettings((s) => ({ ...s, autoTurnInterval: 1 })); } else if (n > 60) { setAutoTurnInput('60'); updateSettings((s) => ({ ...s, autoTurnInterval: 60 })); } }}
                      style={{ width: '56px', padding: '5px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--reader-control-border)', background: 'var(--comment-input-bg)', color: 'var(--text-main)', textAlign: 'center' }}
                    />
                  </label>
                </div>
              </div>

            </div>
            </div>
          </div>
        )}

        {viewMode !== 'immersive' && showArchivePanel && (
          <ReaderArchiveListPanel
            type={archivePanel.type}
            title={archivePanel.title}
            items={archivePanel.items}
            emptyMessage={archivePanel.emptyMessage}
            cacheOnly={assetCacheOnly}
            onDelete={archivePanel.onDelete}
            activeType={archivePanelType}
            onTypeChange={setArchivePanelType}
          />
        )}

        {/* ===== Mode Switch ===== */}
        {viewMode === 'normal' ? (
          <div style={normalReaderStageLayoutStyle}>
            <div
              className="reader-stage-frame"
              style={{ ...normalReaderFrameStyle, position: 'relative' }}
            >
              {webtoonActive ? <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: settings.webtoonGap, overflow: 'auto' }}>
                {pages.map((pageUrl, index) => <PageImage key={pageUrl} pageUrl={pageUrl} pageIndex={index} isImmersive={false} cacheOnly={assetCacheOnly} style={{ width: '100%', height: 'auto', maxWidth: '100%', objectFit: 'contain', borderRadius: 0 }} />)}
              </div> : <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', gap: settings.doublePageGap, overflow: settings.scaleMode === 'original' ? 'auto' : 'hidden' }}><PageImage
                pageUrl={pages[normalDisplayIndex]}
                pageIndex={normalDisplayIndex}
                isImmersive={false}
                cacheOnly={assetCacheOnly}
                style={{ ...scaleStyle, ...transformStyle, maxWidth: settings.scaleMode === 'original' ? 'none' : '100%', maxHeight: settings.scaleMode === 'original' ? 'none' : '100%', borderRadius: '8px' }} splitWide={settings.splitWidePagesEnabled} cropBorders={settings.cropBordersEnabled}
                loadingLabel={`正在切换到第 ${normalTargetIndex + 1} 页`}
                loadingHint={normalPagePending ? '正在请求并解码图像' : '正在准备图像'}
                errorLabel={`第 ${normalTargetIndex + 1} 页加载失败`}
                onLoadStart={handlePageVisualLoadStart}
                onReady={handlePageVisualReady}
                onError={handlePageVisualError}
              />{settings.doublePageEnabled && pages[normalDisplayIndex + 1] && <PageImage pageUrl={pages[normalDisplayIndex + 1]} pageIndex={normalDisplayIndex + 1} isImmersive={false} cacheOnly={assetCacheOnly} style={{ ...scaleStyle, maxWidth: '50%', maxHeight: '100%', borderRadius: 8 }} />}</div>}
              {normalPagePending && (
                <div
                  style={{
                    position: 'absolute',
                    left: isMobile ? '14px' : '18px',
                    right: isMobile ? '14px' : '18px',
                    bottom: isMobile ? '14px' : '18px',
                    padding: isMobile ? '8px 12px' : '10px 14px',
                    borderRadius: '12px',
                    background: 'var(--reader-panel-bg)',
                    border: '1px solid var(--reader-control-border)',
                    backdropFilter: 'blur(10px)',
                    boxShadow: '0 10px 24px rgba(0,0,0,0.24)',
                    pointerEvents: 'none',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>
                    {`第 ${normalTargetIndex + 1} 页正在加载`}
                  </div>
                  <div style={{ marginTop: '8px', width: '100%', height: '4px', borderRadius: '999px', background: 'var(--reader-skeleton-base)', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.round(pageLoadingProgress * 100)}%`,
                        height: '100%',
                        borderRadius: '999px',
                        background: 'linear-gradient(90deg, #65c8ff 0%, #9be7ff 100%)',
                        transition: 'width 0.18s ease',
                      }}
                    />
                  </div>
                </div>
              )}

            </div>

            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '24px', padding: '20px 8px', flexShrink: 0 }}>
              <button
                className="reader-page-nav-button"
                onClick={leftAction}
                disabled={leftDisabled}
                style={{ ...navBtnBase, opacity: leftDisabled ? 0.3 : 1 }}
              >
                ‹
              </button>
              <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-sub)', userSelect: 'none', minWidth: '60px', textAlign: 'center' }}>
                  {normalTargetIndex + 1} / {pages.length}
              </span>
              <button
                className="reader-page-nav-button"
                onClick={rightAction}
                disabled={rightDisabled}
                style={{ ...navBtnBase, opacity: rightDisabled ? 0.3 : 1 }}
              >
                ›
              </button>
            </div>
          </div>
        ) : (
          // ===== Immersive Mode =====
          <div
            data-reader-immersive-stage="true"
            style={{
              flex: 1,
              position: 'relative',
              width: '100%',
              height: '100%',
              overflow: zoomScale === 1.0 ? 'hidden' : 'visible',
              background: '#000',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              touchAction: zoomScale === 1.0 ? 'none' : 'none',
              cursor: 'default',
            }}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
            onClick={handleScreenClick}
          >
            {settings.autoTurnActive && (
              <div
                ref={progressBarRef}
                style={{ position: 'absolute', top: 0, left: 0, height: '3px', background: '#4caf50', width: '0%', zIndex: 120 }}
              />
            )}

            {immersiveManualPending && (
              <div
                style={{
                  position: 'absolute',
                  left: isMobile ? '12px' : '18px',
                  right: isMobile ? '12px' : '18px',
                  bottom: isMobile ? '18px' : '22px',
                  zIndex: 110,
                  pointerEvents: 'none',
                  padding: isMobile ? '8px 12px' : '10px 14px',
                  borderRadius: '14px',
                  background: 'rgba(8, 10, 14, 0.72)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  backdropFilter: 'blur(12px)',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#f2f6ff' }}>
                  {`第 ${currentIndex + 1} 页加载中`}
                </div>
                <div style={{ marginTop: '8px', width: '100%', height: '4px', borderRadius: '999px', background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.round(pageLoadingProgress * 100)}%`,
                      height: '100%',
                      borderRadius: '999px',
                      background: 'linear-gradient(90deg, #72d3ff 0%, #b7f0ff 100%)',
                      transition: 'width 0.18s ease',
                    }}
                  />
                </div>
              </div>
            )}

            <div
              ref={leftDivRef}
              style={{
                position: 'absolute', inset: 0,
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                background: '#000', zIndex: 1,
                transform: 'translateX(-100%)',
              }}
            >
              <img
                ref={imgLeftRef}
                alt=""
                style={{
                  width: '100%', height: '100%', maxWidth: '100vw', maxHeight: '100vh', objectFit: 'contain',
                  userSelect: 'none', WebkitUserSelect: 'none',
                  pointerEvents: 'none',
                }}
                draggable={false}
              />
            </div>

            <div
              ref={rightDivRef}
              style={{
                position: 'absolute', inset: 0,
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                background: '#000', zIndex: 1,
                transform: 'translateX(100%)',
              }}
            >
              {currentIndex >= pages.length - 1 ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px',
                  color: 'rgba(255,255,255,0.6)', userSelect: 'none', pointerEvents: 'none',
                }}>
                  <HomeSectionGlyph name="continue" size={48} color="rgba(255,255,255,0.6)" style={{ opacity: 0.7 }} />
                  <span style={{ fontSize: '16px', letterSpacing: '2px' }}>继续滑动退出沉浸模式</span>
                </div>
              ) : (
                <img
                  ref={imgRightRef}
                  alt=""
                  style={{
                    width: '100%', height: '100%', maxWidth: '100vw', maxHeight: '100vh', objectFit: 'contain',
                    userSelect: 'none', WebkitUserSelect: 'none',
                    pointerEvents: 'none',
                  }}
                  draggable={false}
                />
              )}
            </div>

            <div
              ref={(el) => {
                swipeContainerRef.current = el;
                if (el && !el.dataset.swipeInit) {
                  el.dataset.swipeInit = '1';
                  el.style.transform = 'translateX(0px)';
                }
              }}
              style={{
                position: 'absolute', inset: 0,
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                zIndex: 2,
                willChange: 'transform',
              }}
            >
              <div
                ref={zoomWrapperRef}
                style={{
                  width: '100%', height: '100%',
                  display: 'flex', justifyContent: 'center', alignItems: 'center',
                  transform: `translate(${panX}px, ${panY}px) scale(${zoomScale})`,
                  transformOrigin: 'center center',
                  transition: (isZoomingRef.current || isPanningRef.current) ? 'none' : 'transform 0.15s ease-out',
                }}
              >
                <img
                  ref={imgCurrRef}
                  alt=""
                  style={{
                    width: '100%', height: '100%', maxWidth: '100vw', maxHeight: '100vh', objectFit: 'contain',
                    userSelect: 'none', WebkitUserSelect: 'none',
                    pointerEvents: 'none',
                  }}
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                />
              </div>
            </div>

            {pageIndicatorShouldRender && (
              <div
                ref={indicatorRef}
                style={{
                  position: 'fixed',
                  bottom: pageIndicatorMode === 'lowered'
                    ? `calc(env(safe-area-inset-bottom, 0px) + ${isMobile ? '6px' : '4px'})`
                    : `calc(env(safe-area-inset-bottom, 0px) + ${isMobile ? '12px' : '8px'})`,
                  left: isMobile ? '50%' : 'auto',
                  right: isMobile ? 'auto' : '20px',
                  padding: '4px 10px',
                  borderRadius: '16px',
                  background: 'rgba(0,0,0,0.65)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  fontSize: '11px',
                  letterSpacing: '1px',
                  pointerEvents: 'none',
                  zIndex: 90,
                  opacity: pageIndicatorShouldShow ? 1 : 0,
                  transform: pageIndicatorShouldShow
                    ? (isMobile
                      ? `translateX(-50%) translateY(${pageIndicatorMode === 'lowered' ? '4px' : '0'}) scale(1)`
                      : `translateY(${pageIndicatorMode === 'lowered' ? '4px' : '0'}) scale(1)`)
                    : (isMobile ? 'translateX(-50%) translateY(12px) scale(0.92)' : 'translateY(12px) scale(0.92)'),
                  transition: 'opacity 0.28s ease, transform 0.32s cubic-bezier(0.22,1,0.36,1), bottom 0.28s cubic-bezier(0.22,1,0.36,1)',
                }}
              >
                {displayedIndex + 1} / {pages.length}
              </div>
            )}
          </div>
        )}
      </div>

      {viewMode === 'normal' && readerReady && archive && (
        <div style={{ maxWidth: '1300px', width: '100%', margin: '0 auto', padding: '0 16px 24px 16px' }}>
          <Recommendations currentArchive={archive} />
          {sourceUrl && (
            <EhComments
              sourceUrl={sourceUrl}
              ehEnabled={settings.ehEnabled}
              ehCookie={settings.ehCookie}
              ehWorker={getWorkerUrl()}
              ehToken={getSyncToken()}
              ehMinScore={settings.ehMinScore}
              ehMaxComments={settings.ehMaxComments}
              ehSortMethod={settings.ehSortMethod}
              ehSortOrder={settings.ehSortOrder}
            />
          )}
        </div>
      )}

      {/* ===== Thumbnail Drawer ===== */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          display: 'flex', justifyContent: 'flex-end',
          pointerEvents: showDrawer ? 'auto' : 'none',
          background: showDrawer ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0)',
          backdropFilter: showDrawer ? 'blur(4px)' : 'blur(0px)',
          WebkitBackdropFilter: showDrawer ? 'blur(4px)' : 'blur(0px)',
          transition: 'background 0.25s ease, backdrop-filter 0.25s ease, -webkit-backdrop-filter 0.25s ease',
        }}
        onClick={() => setShowDrawer(false)}
      >
        <div
          className="reader-panel-surface"
          style={{
            width: '100%', maxWidth: '420px', height: '100%', background: 'var(--reader-panel-bg)', padding: '24px',
            display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
            transform: showDrawer ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--reader-control-border)', paddingBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: '18px' }}>归档信息</h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button className="reader-drawer-icon-button" onClick={() => navigateToMetadata(archiveId)} title="编辑元数据" aria-label="编辑元数据">
                <ToolbarGlyph name="metadata" size={18} />
              </button>
              <button className="reader-drawer-icon-button" onClick={() => setShowDrawer(false)} aria-label="关闭缩略面板" title="关闭缩略面板" style={{ fontSize: '20px' }}>
                ✕
              </button>
            </div>
          </div>

          <div style={{ marginBottom: '20px', background: 'var(--surface-2)', borderRadius: '8px', display: 'flex', flexDirection: 'column', maxHeight: '35%', flexShrink: 0 }}>
            <div style={{ padding: '14px 14px 0 14px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '14px', lineHeight: 1.4, wordBreak: 'break-word' }}>
                {archive?.title}
              </div>
            </div>
            <div className="no-scrollbar" style={{ overflowY: 'auto', padding: '0 14px 14px 14px', flex: 1 }}>
            {(() => {
              const grouped = groupedTags;
              if (grouped.length === 0) return <div style={{ color: 'var(--text-sub)', fontSize: '12px' }}>无标签</div>;
              return grouped.map((group) => (
                <div key={group.ns} style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '3px', alignItems: 'baseline' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: group.color, textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: '5px', lineHeight: '20px', whiteSpace: 'nowrap' }}>
                      <NamespaceGlyph ns={group.ns} size={14} color={group.color} />
                      {stripDecoratedLabel(group.label)}
                    </span>
                    {group.tags.map(({ raw, value }) => (
                      <span
                        key={raw}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (group.ns === 'source') {
                            let url = raw.replace(/^source:\s*/i, '').trim();
                            if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
                            if (url) window.open(url, '_blank', 'noopener,noreferrer');
                          } else {
                            const query = `${raw.trim()}, `;
                            const filter = { query, sortBy: 'date_added', order: 'desc', active: true };
                            localStorage.setItem('lrr_filter', JSON.stringify(filter));
                            if (parseRouteFromLocation().kind === 'home') {
                              window.dispatchEvent(new CustomEvent('filter-arrival', { detail: { scrollToArchives: true } }));
                            } else {
                              navigateHome({ query, scrollToArchives: true });
                            }
                          }
                        }}
                        style={{
                          display: 'inline-block',
                          padding: '2px 6px',
                          borderRadius: '5px',
                          background: `${group.color}18`,
                          border: `1px solid ${group.color}40`,
                          color: 'var(--text-main)',
                          fontSize: '10px',
                          whiteSpace: 'nowrap',
                          lineHeight: '1.5',
                          cursor: 'pointer',
                          transition: 'background-color 0.15s ease, border-color 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = `${group.color}30`;
                          e.currentTarget.style.borderColor = group.color;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = `${group.color}18`;
                          e.currentTarget.style.borderColor = `${group.color}40`;
                        }}
                      >
                        {translateTag(group.ns, value)}
                      </span>
                    ))}
                  </div>
                </div>
              ));
            })()}
            </div>
          </div>

          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: 'var(--text-sub)' }}>
            页面总览 · 共{pages.length}页
          </h4>
          <div style={{ flex: 1, minHeight: 0 }}>
            <div
              ref={drawerGridRef}
              className="reader-drawer-scroll"
              style={{
                height: '100%',
                minHeight: 0,
                overflowY: 'auto',
                paddingRight: isMobile ? '14px' : '12px',
                WebkitOverflowScrolling: 'touch',
                overscrollBehavior: 'contain',
                touchAction: 'pan-y',
                scrollbarGutter: 'stable',
              }}
            >
              <div style={{ height: drawerTopSpacer, pointerEvents: 'none' }} />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${DRAWER_COLUMNS}, 1fr)`,
                  gap: `${DRAWER_GAP}px`,
                }}
              >
                {drawerVisiblePages.map((url, offset) => {
                  const idx = drawerSliceStart + offset;
                  return (
                    <div
                      key={url}
                      onClick={() => { commitPageTarget(idx, { showIndicator: viewMode === 'immersive' }); setShowDrawer(false); }}
                      style={{
                        position: 'relative',
                        borderRadius: '6px',
                        overflow: 'hidden',
                        cursor: 'pointer',
                        border: currentIndex === idx ? '2px solid var(--accent)' : '1px solid var(--reader-control-border)',
                        background: 'var(--cover-bg)',
                        paddingBottom: '130%',
                        height: 0,
                      }}
                    >
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        <DrawerThumb archiveId={archiveId} pageIndex={idx} active={showDrawer} cacheOnly={assetCacheOnly} eager={drawerPrefetchSet.has(idx)} />
                      </div>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '11px', textAlign: 'center', padding: '2px 0' }}>
                        P. {idx + 1}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ height: drawerBottomSpacer, pointerEvents: 'none' }} />
            </div>
          </div>
          </div>
        </div>
      <ConfirmDialog
        open={!!historyDeleteTarget}
        title="确认删除阅读历史"
        message={historyDeleteTarget ? `将“${historyDeleteTarget.title}”从阅读历史中移除。再次阅读该归档时会重新加入历史记录。` : ''}
        confirmLabel="确认删除"
        cancelLabel="取消"
        onConfirm={confirmRemoveHistory}
        onCancel={() => setHistoryDeleteTarget(null)}
      />
      <ConfirmDialog
        open={!!coverConfirmPage}
        title="设为封面"
        message={coverConfirmPage ? `将当前第 ${coverConfirmPage} 页设置为“${archive?.title || archiveId}”的封面？` : ''}
        confirmLabel={coverSetting ? '设置中...' : '确认设置'}
        cancelLabel="取消"
        destructive={false}
        confirmDisabled={coverSetting}
        onConfirm={confirmSetCover}
        onCancel={() => { if (!coverSetting) setCoverConfirmPage(0); }}
      />

    </div>
  );
}



