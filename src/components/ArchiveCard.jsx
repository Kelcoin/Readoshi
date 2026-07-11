import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { translateTag, categorizeTags, NAMESPACE_COLORS_MAP } from '../lib/tags';
import { getCachedImage, getImage } from '../lib/imageCache';
import { navigateHome, parseRouteFromLocation } from '../lib/navigation';
import { NamespaceGlyph, stripDecoratedLabel } from './AppGlyphs';

const NAMESPACE_COLORS = NAMESPACE_COLORS_MAP;

function calculatePanelPosition(cardRect, panelHeight, pointerY = null) {
  const panelWidth = 320;
  const panelMaxHeight = 440;
  const effectivePanelHeight = Math.min(
    panelMaxHeight,
    Math.max(1, Math.ceil(panelHeight || panelMaxHeight)),
  );
  const belowGap = 10;
  const aboveGap = 20;
  const sideGap = 10;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const centeredLeft = Math.min(
    Math.max(sideGap, cardRect.left + (cardRect.width - panelWidth) / 2),
    Math.max(sideGap, vw - panelWidth - sideGap),
  );

  const belowTop = cardRect.bottom + belowGap;
  if (belowTop + effectivePanelHeight <= vh - sideGap) {
    return { top: belowTop, left: centeredLeft };
  }

  const aboveTop = cardRect.top - effectivePanelHeight - aboveGap;
  if (aboveTop >= sideGap) {
    return { top: aboveTop, left: centeredLeft };
  }

  const centeredSideTop = cardRect.top + (cardRect.height - effectivePanelHeight) / 2;
  const pointerSafeTop = pointerY == null
    ? centeredSideTop
    : (pointerY + 18 + effectivePanelHeight <= vh - sideGap
      ? pointerY + 18
      : pointerY - effectivePanelHeight - 18);
  const sideTop = Math.min(Math.max(sideGap, pointerSafeTop), Math.max(sideGap, vh - effectivePanelHeight - sideGap));

  const rightLeft = cardRect.right + sideGap;
  if (rightLeft + panelWidth <= vw - sideGap) {
    return { top: sideTop, left: rightLeft };
  }

  const leftLeft = cardRect.left - panelWidth - sideGap;
  if (leftLeft >= sideGap) {
    return { top: sideTop, left: leftLeft };
  }

  return {
    top: sideTop,
    left: Math.min(Math.max(sideGap, centeredLeft), Math.max(sideGap, vw - panelWidth - sideGap)),
  };
}

async function readImageAspectRatio(src) {
  if (!src) return null;
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  try {
    if (!img.complete) {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
    }
    if (typeof img.decode === 'function') {
      try { await img.decode(); } catch {}
    }
    return img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : null;
  } catch {
    return null;
  }
}

export default function ArchiveCard({ archive, onClick, onLongPress, onArchiveContextMenu, longPressTitle = '', currentPage, progress, showProgressBar, noCrop, cacheOnly = false, wrapStyle, className, overlay, selectionMode = false, selected = false, onSelectToggle }) {
  const [hovered, setHovered] = useState(false);
  const [closing, setClosing] = useState(false);
  const [thumbSrc, setThumbSrc] = useState(null);
  const [thumbState, setThumbState] = useState('loading');
  const [retryKey, setRetryKey] = useState(0);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const [isMobile, setIsMobile] = useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(null);
  const cardRef = useRef(null);
  const panelRef = useRef(null);
  const imgRef = useRef(null);
  const metaRef = useRef(null);
  const leaveTimerRef = useRef(null);
  const thumbObjectUrlRef = useRef(null);
  const [shouldLoadThumb, setShouldLoadThumb] = useState(cacheOnly);
  const [allowNetworkFallback, setAllowNetworkFallback] = useState(!cacheOnly);
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const pointerStartRef = useRef(null);
  const hoverPointerYRef = useRef(null);
  const id = archive.arcid || archive.id;

  useEffect(() => {
    if (!cacheOnly) {
      setAllowNetworkFallback(true);
    }
  }, [cacheOnly]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (cacheOnly || allowNetworkFallback) {
      setShouldLoadThumb(true);
      return undefined;
    }
    const el = cardRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setShouldLoadThumb(true);
        io.disconnect();
      }
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [allowNetworkFallback, cacheOnly, id]);

  const tags = archive.tags?.split(',').map((tag) => tag.trim()).filter(Boolean) || [];
  const categorizedTags = categorizeTags(tags);

  const totalPages = archive.pagecount || archive.total || 0;
  const current = currentPage || archive.progress || archive.page || 0;
  const pageInfo = current > 0 ? `${current}/${totalPages}页` : (totalPages > 0 ? `${totalPages}页` : '');

  const dateAddedStr = (() => {
    // 1) 优先从 tags 字符串中提取 date_added tag (LANraragi API 的标准数据来源)
    const tagsStr = (archive.tags || '').trim();
    if (tagsStr) {
      const m = tagsStr.match(/(?:^|,\s*)date_added:(\d+)/);
      if (m) {
        const sec = parseInt(m[1], 10);
        if (sec > 0) {
          const d = new Date(sec * 1000);
          if (!isNaN(d.getTime())) {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          }
        }
      }
    }

    // 2) 回退：直接字段 date_added 或阅读历史中的 archive.time
    const direct = archive.date_added;
    const fallback = archive.time;
    if (!direct && !fallback) return '';

    try {
      const raw = direct || fallback;
      let d;
      if (typeof raw === 'number') {
        d = new Date(raw > 1e12 ? raw : raw * 1000);
      } else {
        const str = String(raw).trim();
        d = new Date(str);
        if (isNaN(d.getTime())) {
          const n = parseInt(str, 10);
          if (!isNaN(n) && n > 0) d = new Date(n > 1e12 ? n : n * 1000);
        }
      }
      if (!isNaN(d.getTime())) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    } catch {}

    return '';
  })();

  const progressPct = progress != null ? progress : (totalPages > 0 && current > 0 ? Math.round((current / totalPages) * 100) : 0);
  const showProgress = showProgressBar && ((current > 0 && totalPages > 0) || progress != null);

  const isWide = noCrop && aspectRatio != null && aspectRatio > 1.0;
  const baseMetaFontSize = isMobile ? 10.5 : 11;
  const [metaFontSize, setMetaFontSize] = useState(baseMetaFontSize);

  const updateAspectRatio = useCallback((img) => {
    const nw = img?.naturalWidth;
    const nh = img?.naturalHeight;
    if (nw && nh) {
      setAspectRatio((prev) => {
        const next = nw / nh;
        return prev != null && Math.abs(prev - next) < 0.001 ? prev : next;
      });
    }
  }, []);

  const handleImageLoad = useCallback((e) => {
    updateAspectRatio(e.target);
  }, [updateAspectRatio]);

  useEffect(() => {
    setAspectRatio(null);
  }, [id]);

  useEffect(() => {
    if (thumbState !== 'ready' || !thumbSrc) return;
    updateAspectRatio(imgRef.current);
  }, [thumbSrc, thumbState, updateAspectRatio]);

  useEffect(() => {
    if (aspectRatio == null) return undefined;
    const frame = requestAnimationFrame(() => {
      const el = cardRef.current;
      const parent = el?.parentElement;
      if (!el) return;
      // Wide covers change their CSS grid span after thumbnail decode; forcing
      // a layout read prevents Chromium from delaying the repaint until scroll.
      void el.offsetWidth;
      if (parent) void parent.offsetHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [aspectRatio, isWide, noCrop]);

  useLayoutEffect(() => {
    const el = metaRef.current;
    if (!el) return undefined;

    const update = () => {
      const width = el.clientWidth;
      if (!width) return;
      const previousFontSize = el.style.fontSize;
      el.style.fontSize = `${baseMetaFontSize}px`;
      const naturalWidth = el.scrollWidth;
      el.style.fontSize = previousFontSize;
      const nextSize = naturalWidth <= width
        ? baseMetaFontSize
        : Math.max(5, Math.floor((baseMetaFontSize * width / naturalWidth) * 10) / 10);
      setMetaFontSize((prev) => (Math.abs(prev - nextSize) < 0.05 ? prev : nextSize));
    };

    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => {
        window.removeEventListener('resize', update);
      };
    }

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [baseMetaFontSize, dateAddedStr, pageInfo]);

  // ===== Lazy thumbnail: only load near viewport (biggest memory win) =====
  useEffect(() => {
    let isMounted = true;
    if (!shouldLoadThumb) return undefined;

    const loadThumbnail = async () => {
      if (!id) { setThumbState('error'); return; }
      const hadVisibleThumb = !!thumbObjectUrlRef.current;
      if (!hadVisibleThumb) setThumbState('loading');

      try {
        const cacheKey = `thumb:${id}`;
        const src = cacheOnly && !allowNetworkFallback
          ? await getCachedImage(cacheKey)
          : await getImage(cacheKey, async () => {
              const base = (localStorage.getItem('lrr_server_url') || '').replace(/\/$/, '');
              const key = localStorage.getItem('lrr_api_key') || '';
              const headers = {};
              if (key) headers['Authorization'] = `Bearer ${btoa(key)}`;
              const res = await fetch(`${base}/api/archives/${id}/thumbnail`, { headers });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return res.blob();
            });
        if (!isMounted) return;
        if (src) {
          const ratio = noCrop ? await readImageAspectRatio(src) : null;
          if (!isMounted) return;
          if (ratio) setAspectRatio(ratio);
          thumbObjectUrlRef.current = src;
          setThumbSrc(src);
          setThumbState('ready');
        } else {
          if (cacheOnly && !allowNetworkFallback) {
            setAllowNetworkFallback(true);
            return;
          }
          if (!hadVisibleThumb) setThumbState('error');
        }
      } catch (e) {
        if (!isMounted) return;
        if (cacheOnly && !allowNetworkFallback) {
          setAllowNetworkFallback(true);
          return;
        }
        if (!hadVisibleThumb) setThumbState('error');
      }
    };

    loadThumbnail();

    return () => {
      isMounted = false;
    };
  }, [allowNetworkFallback, cacheOnly, id, noCrop, retryKey, shouldLoadThumb]);

  const translateDisplayTag = useCallback((rawTag) => {
    if (!rawTag) return rawTag;
    if (rawTag.includes(':')) {
      const [namespace, ...rest] = rawTag.split(':');
      const value = rest.join(':').trim();
      return translateTag(namespace.toLowerCase(), value) || value;
    }
    return translateTag('general', rawTag) || rawTag;
  }, []);

  const handleTagClick = (event, tag) => {
    event.stopPropagation();
    if (!tag) return;
    if (tag.toLowerCase().startsWith('source:')) {
      let url = tag.slice(7).trim();
      if (url && !/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
      }
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    const query = `${tag.trim()}, `;
    const filter = { query, sortBy: 'date_added', order: 'desc', active: true };
    localStorage.setItem('lrr_filter', JSON.stringify(filter));
    if (parseRouteFromLocation().kind === 'home') {
      window.dispatchEvent(new CustomEvent('filter-arrival', { detail: { scrollToArchives: true } }));
    } else {
      navigateHome({ query, scrollToArchives: true });
    }
  };

  const updatePanelPosition = useCallback((pointerY = hoverPointerYRef.current) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const panelHeight = panelRef.current?.getBoundingClientRect().height;
    const nextPos = calculatePanelPosition(rect, panelHeight, pointerY);
    setPanelPos((prev) => (
      Math.abs(prev.top - nextPos.top) < 0.5 && Math.abs(prev.left - nextPos.left) < 0.5
        ? prev
        : nextPos
    ));
  }, []);

  // ===== Fix 1: 200ms 延迟消失，鼠标可从卡片滑入面板 =====
  const showPanel = (event) => {
    if (cardRef.current?.closest?.('[data-scroll-block]')) return;
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    hoverPointerYRef.current = event?.clientY ?? null;
    updatePanelPosition(hoverPointerYRef.current);
    setHovered(true);
  };

  const hidePanelWithDelay = () => {
    leaveTimerRef.current = setTimeout(() => {
      setClosing(true);
      setTimeout(() => {
        setHovered(false);
        setClosing(false);
      }, 100);
    }, 200);
  };

  const keepPanel = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setClosing(false);
    setHovered(true);
  };

  const hidePanelImmediately = () => {
    setClosing(true);
    setTimeout(() => {
      setHovered(false);
      setClosing(false);
    }, 100);
  };

  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  const isPanelVisible = hovered || (isMobile && mobilePanelOpen);

  useLayoutEffect(() => {
    if (!isPanelVisible || categorizedTags.length === 0) return;
    updatePanelPosition();
  }, [categorizedTags.length, isPanelVisible, updatePanelPosition]);

  useEffect(() => {
    if (!isPanelVisible) return;
    const handleScroll = () => {
      if (!cardRef.current) return;
      const rect = cardRef.current.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setHovered(false);
        setMobilePanelOpen(false);
        return;
      }
      const panelHeight = panelRef.current?.getBoundingClientRect().height;
      setPanelPos(calculatePanelPosition(rect, panelHeight, hoverPointerYRef.current));
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isPanelVisible]);

  useEffect(() => {
    if (!isPanelVisible) return;
    const el = panelRef.current;
    if (!el) return;
    const handler = (e) => {
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
        e.preventDefault();
        return;
      }
      e.stopPropagation();
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [isPanelVisible]);

  useEffect(() => {
    if (!isMobile || !mobilePanelOpen) return;
    const handler = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (cardRef.current && cardRef.current.contains(e.target)) return;
      setMobilePanelOpen(false);
      setHovered(false);
    };
    document.addEventListener('touchstart', handler, { passive: true });
    return () => document.removeEventListener('touchstart', handler);
  }, [isMobile, mobilePanelOpen]);

  const handleCoverClick = (e) => {
    e.stopPropagation();
    if (selectionMode && onSelectToggle) {
      onSelectToggle(archive, e);
      return;
    }
    onClick(e);
  };

  const handleTitleClick = (e) => {
    if (!isMobile) return;
    e.stopPropagation();
    updatePanelPosition();
    setMobilePanelOpen((v) => !v);
  };

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerStartRef.current = null;
  }, []);

  const startLongPress = useCallback((event) => {
    if (!onLongPress && !onArchiveContextMenu) return;
    if (event.button != null && event.button !== 0) return;
    const point = 'touches' in event ? event.touches?.[0] : event;
    pointerStartRef.current = point ? { x: point.clientX, y: point.clientY } : null;
    longPressTriggeredRef.current = false;
    clearLongPress();
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      const menuPoint = pointerStartRef.current || (cardRef.current ? {
        x: cardRef.current.getBoundingClientRect().left + 16,
        y: cardRef.current.getBoundingClientRect().top + 16,
      } : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      if (onArchiveContextMenu) onArchiveContextMenu(archive, menuPoint, event);
      else onLongPress();
    }, 520);
  }, [archive, clearLongPress, onArchiveContextMenu, onLongPress]);

  const cancelLongPress = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  const handlePointerMoveCancel = useCallback((event) => {
    const start = pointerStartRef.current;
    if (!start) {
      cancelLongPress();
      return;
    }
    const point = 'touches' in event ? event.touches?.[0] : event;
    if (!point) {
      cancelLongPress();
      return;
    }
    if (Math.abs(point.clientX - start.x) > 8 || Math.abs(point.clientY - start.y) > 8) {
      cancelLongPress();
    }
  }, [cancelLongPress]);

  const suppressClickAfterLongPress = useCallback((event) => {
    if (!longPressTriggeredRef.current) return false;
    longPressTriggeredRef.current = false;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    return true;
  }, []);

  return (
    <div
      ref={cardRef}
      className={className}
      style={{
        position: 'relative',
        display: 'inline-block',
        gridColumn: isWide ? 'span 2' : undefined,
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        ...wrapStyle,
      }}
    >
      {overlay}
      {/* ===== 卡片本体 ===== */}
      <div
        className="glass-panel archive-card-shell"
        title={undefined}
        style={{
          minWidth: isWide ? '316px' : '150px',
          width: isWide ? '316px' : '150px',
          padding: '12px',
          cursor: 'pointer',
          transition: 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.22s ease, border-color 0.22s ease',
          display: 'flex',
          flexDirection: 'column',
          transform: isPanelVisible ? 'translateY(-6px) translateZ(0)' : 'translateY(0) translateZ(0)',
          boxShadow: selected
            ? '0 0 0 2px rgba(74,159,240,0.92), 0 12px 34px rgba(74,159,240,0.20)'
            : (isPanelVisible ? '0 12px 40px 0 rgba(0, 0, 0, 0.5)' : 'var(--shadow)'),
          transformOrigin: 'center top',
          touchAction: 'pan-x pan-y pinch-zoom',
          WebkitTouchCallout: (selectionMode || onLongPress || onArchiveContextMenu) ? 'none' : undefined,
          WebkitUserSelect: 'none',
          userSelect: 'none',
        }}
        onClick={(e) => {
          if (suppressClickAfterLongPress(e)) return;
          if (selectionMode && onSelectToggle) {
            onSelectToggle(archive, e);
            return;
          }
          if (!isMobile) onClick(e);
        }}
        onMouseEnter={!isMobile ? showPanel : undefined}
        onMouseDown={startLongPress}
        onMouseUp={cancelLongPress}
        onMouseMove={handlePointerMoveCancel}
        onMouseLeave={(e) => {
          cancelLongPress();
          if (!isMobile) hidePanelWithDelay(e);
        }}
        onTouchStart={startLongPress}
        onTouchEnd={cancelLongPress}
        onTouchCancel={cancelLongPress}
        onTouchMove={handlePointerMoveCancel}
        onContextMenu={(e) => {
          if (!onLongPress && !onArchiveContextMenu) return;
          e.preventDefault();
          e.stopPropagation();
          if (onArchiveContextMenu) onArchiveContextMenu(archive, { x: e.clientX, y: e.clientY }, e);
        }}
      >
        <div
          onClick={(e) => {
            if (suppressClickAfterLongPress(e)) return;
            handleCoverClick(e);
          }}
          style={{
            width: '100%',
            height: '210px',
            borderRadius: '8px',
            overflow: 'hidden',
            backgroundColor: 'var(--cover-bg)',
            position: 'relative',
          }}
          className="archive-cover-frame"
        >
          {thumbState === 'loading' && !thumbSrc && (
            <div
              className="reader-skeleton-fade"
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                overflow: 'hidden',
                zIndex: 1,
              }}
            >
              <div className="shimmer-strip" style={{ position: 'absolute', inset: 0 }} />
            </div>
          )}

          {thumbState === 'loading' && !thumbSrc && (
            <div
              style={{
                position: 'absolute',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                color: 'var(--text-sub)',
                fontSize: '12px',
              }}
            >
              加载封面...
            </div>
          )}

          {thumbState === 'ready' && thumbSrc && (
            <img
              ref={imgRef}
              className="reader-content-fade-in"
              src={thumbSrc}
              alt="cover"
              draggable={false}
              onLoad={handleImageLoad}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                width: '100%', height: '100%',
                objectFit: 'cover',
                display: 'block',
                opacity: 1,
                transform: 'translateZ(0)',
                backfaceVisibility: 'hidden',
                WebkitTouchCallout: 'none',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
              onError={() => {
                // Blob URL may have been revoked by pagehide cleanup — re-fetch
                if (thumbObjectUrlRef.current) {
                  URL.revokeObjectURL(thumbObjectUrlRef.current);
                  thumbObjectUrlRef.current = null;
                }
                setThumbSrc(null);
                setThumbState('loading');
                setRetryKey(k => k + 1);
              }}
            />
          )}

          {thumbState === 'error' && !thumbSrc && (
            <div
              style={{
                position: 'absolute',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                color: 'var(--text-sub)',
                fontSize: '12px',
                textAlign: 'center',
              }}
            >
              封面不可用
            </div>
          )}
        </div>
        {showProgress && (
          <div style={{ width: '100%', height: '3px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', marginTop: '4px' }}>
            <div style={{ width: `${Math.min(progressPct, 100)}%`, height: '100%', background: 'var(--accent)', borderRadius: '2px', transition: 'width 0.3s ease' }} />
          </div>
        )}
        {/* 标题 */}
        <div
          onClick={(e) => {
            if (suppressClickAfterLongPress(e)) return;
            handleTitleClick(e);
          }}
          style={{
            fontSize: '13px', marginTop: '12px',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            lineHeight: '1.4', minHeight: '36.4px',
            ...(isMobile ? { cursor: 'pointer', color: 'var(--accent)' } : {}),
          }}
          className="archive-title"
        >
          {archive.title}
        </div>

        {(pageInfo || dateAddedStr) && (
          <div
            ref={metaRef}
            style={{
              fontSize: `${metaFontSize}px`,
              color: 'var(--text-sub)',
              marginTop: isMobile ? '4px' : '6px',
              display: 'flex',
              justifyContent: 'space-between',
              gap: '6px',
              alignItems: 'center',
              lineHeight: 1.35,
              maxWidth: '100%',
              whiteSpace: 'nowrap',
            }}
          >
            {pageInfo && (
              <span
                style={{
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
                title={pageInfo}
              >
                {pageInfo}
              </span>
            )}
            {dateAddedStr && (
              <span
                style={{
                  flexShrink: 0,
                  marginLeft: pageInfo ? 'auto' : 0,
                  textAlign: 'right',
                  whiteSpace: 'nowrap',
                }}
                title={dateAddedStr}
              >
                {dateAddedStr}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 悬浮标签面板 —— Portal 至 body，彻底避开 overflow 裁剪和滚动捕获 */}
      {isPanelVisible && categorizedTags.length > 0 && ReactDOM.createPortal(
        <div
          ref={panelRef}
          className="no-scrollbar"
          onMouseEnter={keepPanel}
          onMouseLeave={hidePanelImmediately}
          style={{
            position: 'fixed',
            top: `${panelPos.top}px`,
            left: `${panelPos.left}px`,
            zIndex: 9999,
            background: 'var(--dropdown-bg)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(140, 160, 190, 0.25)',
            borderRadius: '14px',
            padding: '16px 18px',
            minWidth: '260px',
            maxWidth: '320px',
            maxHeight: '440px',
            overflowY: 'auto',
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.6)',
            pointerEvents: 'auto',
            animation: closing ? 'fadeOut 0.1s ease-out forwards' : 'slideDown 0.15s ease-out forwards',
          }}
        >
          <div className="no-scrollbar">
            <div
              style={{
                fontSize: '14px', fontWeight: 700, lineHeight: 1.3,
                marginBottom: '14px', color: 'var(--text-main)',
                wordBreak: 'break-word',
              }}
            >
              {archive.title}
            </div>

            {categorizedTags.map((group) => (
              <div key={group.ns} style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '3px', alignItems: 'baseline' }}>
                  <span
                    className="archive-tag-namespace"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      '--tag-ns-color': group.color,
                      color: 'var(--tag-ns-color)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginRight: '5px',
                      lineHeight: '20px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <NamespaceGlyph ns={group.ns} size={14} color="currentColor" />
                    {stripDecoratedLabel(group.label)}
                  </span>
                  {group.tags.map(({ raw }) => (
                    <button
                      key={raw}
                      type="button"
                      onClick={(e) => handleTagClick(e, raw)}
                      style={{
                        border: `1px solid ${group.color}44`,
                        borderRadius: '5px',
                        padding: '2px 6px',
                        background: `${group.color}15`,
                        color: 'var(--text-main)',
                        fontSize: '11px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s ease',
                        lineHeight: '1.4',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = `${group.color}35`;
                        e.currentTarget.style.borderColor = group.color;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = `${group.color}15`;
                        e.currentTarget.style.borderColor = `${group.color}44`;
                      }}
                    >
                      {translateDisplayTag(raw)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}


