import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { lrrApi } from '../lib/api';
import { getHistory, getHideRead, setHideRead, getCropCover, setCropCover, removeHistoryItem, loadHistoryState, hasRemoteHistory } from '../lib/history';
import { addWatchlistItem, getWatchlist, hasRemoteWatchlist, loadWatchlistState, removeWatchlistItem, removeWatchlistItems } from '../lib/watchlist';
import { loadTagDB, startTagDBUpdateTimer, stopTagDBUpdateTimer } from '../lib/tags';
import { getWorkerUrl, setWorkerUrl, getSyncToken, setSyncToken, exportConfig, importConfig } from '../lib/worker-config';
import { runHistoryExistenceCheck } from '../lib/historyMaintenance';
import { getEhCookie, getEhFavoriteDeleteSync, hasValidEhCookie, setEhFavoriteDeleteSync } from '../lib/ehFavoriteSync';
import { deleteArchiveWithFavoriteSync } from '../lib/archiveDeletion';
import ArchiveCard from '../components/ArchiveCard';
import ArchiveContextMenu from '../components/ArchiveContextMenu';
import ConfirmDialog from '../components/ConfirmDialog';
import CustomSelect from '../components/CustomSelect';
import TagSuggest from '../components/TagSuggest';
import CacheSettings from '../components/CacheSettings';
import EhFavoriteDeleteSwitch from '../components/EhFavoriteDeleteSwitch';
import ToggleSwitch from '../components/ToggleSwitch';
import AppVersion from '../components/AppVersion';
import { HomeSectionGlyph, ThemeModeGlyph, getSectionGlyphColor } from '../components/AppGlyphs';
import { getStoredCategories, loadCategories, startCategoriesUpdateTimer, stopCategoriesUpdateTimer } from '../lib/categories';
import { clearImageCache } from '../lib/imageCache';
import { claimColdRestoreRoute, consumeHomeNavigationSnapshot, getBootState, loadHomeSnapshot, markBackground, saveHomeNavigationSnapshot, saveHomeSnapshot } from '../lib/sessionState';
import { getStoredServerInfo, loadServerInfo } from '../lib/serverInfoCache';
import { useHorizontalScroller } from '../lib/horizontalScroller';
import { navigateDeduplicate, navigateHistory, navigateHome, navigateToMetadata, navigateUpload, navigateWatchlist } from '../lib/navigation';

const FILTER_KEY = 'lrr_filter';
const PRESETS_KEY = 'lrr_filter_presets';
const RANDOMS_RECENT_KEY = 'lrr_random_recent_v1';
const RANDOMS_BATCH_SIZE = 8;
const RANDOMS_DEFAULT_BATCHES = 2;
const RANDOMS_FILL_MAX_ITEMS = 24;
const RANDOMS_FETCH_ATTEMPTS = 3;
const RANDOMS_RECENT_LIMIT = 48;
const RANDOMS_REQUEST_TIMEOUT_MS = 6500;
const RANDOMS_RETRY_DELAY_MS = 350;
const ARCHIVES_SCROLL_KEY = 'lrr_scroll_archives_on_arrival';
const RANDOMS_REVALIDATE_STALE_MS = 10 * 60 * 1000;
const RANDOMS_RESTORE_GRACE_MS = 90 * 1000;
const ARCHIVES_AUTO_REFRESH_MS = 60 * 1000;
const ARCHIVES_FOCUS_REFRESH_MS = 30 * 1000;
const RESUME_REFRESH_SUPPRESS_MS = 10 * 1000;
const FILTER_INPUT_MIN_WIDTH = 400;
const FILTER_ACTIONS_MIN_WIDTH = 320;
const FILTER_LAYOUT_GAP = 12;
const FILTER_STACK_BREAKPOINT = FILTER_INPUT_MIN_WIDTH + FILTER_ACTIONS_MIN_WIDTH + FILTER_LAYOUT_GAP;

function readFilter() {
  try {
    return JSON.parse(localStorage.getItem(FILTER_KEY));
  } catch { return null; }
}

function readRouteFilterQuery(routeQuery) {
  const query = routeQuery || '';
  if (!query) return '';
  const stored = readFilter();
  const storedQuery = typeof stored?.query === 'string' ? stored.query : '';
  const normalize = (value) => (value || '').trim().replace(/,\s*$/, '').trim();
  return normalize(storedQuery) === normalize(query) ? storedQuery : query;
}

function writeFilter(f) {
  localStorage.setItem(FILTER_KEY, JSON.stringify(f));
}

function tokenizeFilterQuery(query = '') {
  return query
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatFilterTokens(tokens, { trailingComma = false } = {}) {
  const text = tokens.map((token) => token.trim()).filter(Boolean).join(', ');
  if (!text) return '';
  return trailingComma ? `${text}, ` : text;
}

function appendFilterToken(query, token) {
  const trimmedToken = (token || '').trim();
  if (!trimmedToken) return query || '';
  const tokens = tokenizeFilterQuery(query);
  if (!tokens.includes(trimmedToken)) tokens.push(trimmedToken);
  return formatFilterTokens(tokens, { trailingComma: true });
}

function removeFilterToken(query, token) {
  const trimmedToken = (token || '').trim();
  const tokens = tokenizeFilterQuery(query).filter((part) => part !== trimmedToken);
  return formatFilterTokens(tokens);
}

function replaceCurrentFilterToken(query, token) {
  const trimmedToken = (token || '').trim();
  if (!trimmedToken) return query || '';
  const raw = query || '';
  const commaIndex = raw.lastIndexOf(',');
  const prefix = commaIndex >= 0 ? raw.slice(0, commaIndex) : '';
  const tokens = tokenizeFilterQuery(prefix);
  tokens.push(trimmedToken);
  return formatFilterTokens(tokens, { trailingComma: true });
}

function readPresets() {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY)) || [];
  } catch { return []; }
}
function writePresets(p) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(p));
}

function readRecentRandomIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RANDOMS_RECENT_KEY));
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeRecentRandomIds(ids) {
  try {
    localStorage.setItem(RANDOMS_RECENT_KEY, JSON.stringify(ids.slice(0, RANDOMS_RECENT_LIMIT)));
  } catch {}
}

function getRandomBatchIds(items) {
  return (items || []).map((item) => item?.arcid || item?.id).filter(Boolean);
}

function scoreRandomBatch(items, currentIds, recentIds) {
  const ids = getRandomBatchIds(items);
  if (ids.length === 0) return Number.NEGATIVE_INFINITY;

  let score = 0;
  ids.forEach((id) => {
    if (!currentIds.has(id)) score += 4;
    if (!recentIds.has(id)) score += 2;
  });

  const uniqueCount = new Set(ids).size;
  score += uniqueCount * 0.1;
  if (ids.every((id) => currentIds.has(id))) score -= 100;
  return score;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForPaint() {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function withAbortTimeout(task, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function consumeArchivesScrollFlag() {
  try {
    if (sessionStorage.getItem(ARCHIVES_SCROLL_KEY) !== '1') return false;
    sessionStorage.removeItem(ARCHIVES_SCROLL_KEY);
    return true;
  } catch {
    return false;
  }
}

function shouldRevalidateHydratedRandoms(snapshot, boot) {
  if (!snapshot || !Array.isArray(snapshot.randoms) || snapshot.randoms.length === 0) return false;
  if (snapshot.reason === 'home-navigation') return false;

  const randomsUpdatedAt = typeof snapshot.randomsUpdatedAt === 'number'
    ? snapshot.randomsUpdatedAt
    : snapshot.ts;
  const age = typeof randomsUpdatedAt === 'number' ? Date.now() - randomsUpdatedAt : Number.POSITIVE_INFINITY;

  if (boot.navigationType === 'reload') return true;
  if (age >= RANDOMS_REVALIDATE_STALE_MS) return true;

  const resumeTs = boot.resumeCandidate?.ts;
  if (typeof resumeTs === 'number' && Date.now() - resumeTs > RANDOMS_RESTORE_GRACE_MS) {
    return true;
  }

  return false;
}

const DEFAULT_FILTER = { query: '', sortBy: 'date_added', order: 'desc', active: false };
const bootState = getBootState();

function getSearchTotal(res, dataLength, previousTotal = null) {
  const candidates = [
    res?.recordsFiltered,
    res?.recordsTotal,
    res?.total,
    res?.filtered,
    res?.count,
  ];
  const found = candidates.find((value) => Number.isFinite(Number(value)));
  if (found !== undefined) return Number(found);
  if (dataLength === 0) return 0;
  return Number.isFinite(Number(previousTotal)) ? Number(previousTotal) : null;
}

function SkeletonCard({ showProgress = false }) {
  return (
    <div style={{
      flexShrink: 0, minWidth: '150px', width: '150px',
      background: 'var(--surface-1)',
      borderRadius: '14px',
      border: '1px solid rgba(255,255,255,0.08)',
      display: 'flex', flexDirection: 'column', padding: '12px',
      overflow: 'hidden',
    }}>
      <div style={{
        width: '100%', height: '210px',
        borderRadius: '8px',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div className="shimmer-strip" style={{ position: 'absolute', inset: 0 }} />
      </div>
      {showProgress && (
        <div style={{ width: '48px', height: '4px', borderRadius: '999px', background: 'rgba(74,159,240,0.22)', marginTop: '8px' }} />
      )}
      <div style={{
        height: '12px', borderRadius: '4px',
        background: 'rgba(255,255,255,0.05)',
        width: '84%', marginTop: showProgress ? '10px' : '12px',
      }} />
      <div style={{
        height: '12px', borderRadius: '4px',
        background: 'rgba(255,255,255,0.04)',
        width: '66%', marginTop: '8px',
      }} />
      <div style={{
        display: 'flex', justifyContent: 'space-between', marginTop: '10px',
      }}>
        <div style={{
          height: '8px', borderRadius: '4px',
          background: 'rgba(255,255,255,0.04)',
          width: '36%',
        }} />
        <div style={{
          height: '8px', borderRadius: '4px',
          background: 'rgba(255,255,255,0.04)',
          width: '30%',
        }} />
      </div>
    </div>
  );
}

function SectionHeading({ glyph, children, onClick, title, style }) {
  const content = (
    <>
      <HomeSectionGlyph name={glyph} size={21} color={getSectionGlyphColor(glyph)} />
      <span>{children}</span>
    </>
  );

  return (
    <h2 style={{ fontSize: '18px', lineHeight: 1.2, margin: 0, display: 'flex', alignItems: 'center', gap: '10px', ...style }}>
      {onClick ? (
        <button
          type="button"
          className="section-heading-link"
          onClick={onClick}
          title={title}
        >
          {content}
        </button>
      ) : content}
    </h2>
  );
}

function CollapseButton({ collapsed, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-sub)', opacity: 0.8, padding: '4px', borderRadius: '4px', display: 'flex' }}
    >
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" style={{ transition: 'transform 0.3s', transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}>
        <path d="M6 15l6-6 6 6z" />
      </svg>
    </button>
  );
}

const THEME_MODE_LABELS = {
  auto: '自适应',
  dark: '深色',
  light: '浅色',
};
const READER_SETTINGS_KEY = 'lrr_reader_settings';
const DEFAULT_READER_EH_SETTINGS = {
  ehEnabled: false,
  ehCookie: '',
  ehMinScore: 0,
  ehMaxComments: 45,
  ehSortMethod: 'score',
  ehSortOrder: 'desc',
};

function readReaderSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(READER_SETTINGS_KEY) || '{}');
    const standaloneCookie = (localStorage.getItem('lrr_eh_cookie') || '').trim();
    const settings = saved && typeof saved === 'object' ? saved : {};
    return {
      ...DEFAULT_READER_EH_SETTINGS,
      ...settings,
      ehCookie: typeof settings.ehCookie === 'string' && settings.ehCookie.trim()
        ? settings.ehCookie
        : standaloneCookie,
    };
  } catch {
    return { ...DEFAULT_READER_EH_SETTINGS };
  }
}

function writeReaderSettings(settings) {
  localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(settings));
  const cookie = String(settings?.ehCookie || '').trim();
  if (cookie) localStorage.setItem('lrr_eh_cookie', cookie);
  else localStorage.removeItem('lrr_eh_cookie');
}

export default function Home({ onSelectArchive, onLogout, themeMode = 'auto', onThemeModeChange }) {
  const [navSnapshot] = useState(() => consumeHomeNavigationSnapshot());
  const [coldRestoreBoot] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('q')) return false;
    if (navSnapshot) return false;
    if (claimColdRestoreRoute('home')) return true;
    const boot = getBootState();
    return !!(!boot.isPwaUpdateReload && (boot.wasDiscarded || boot.navigationType === 'reload') && loadHomeSnapshot());
  });
  const [filter, setFilter] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) {
      const f = { ...DEFAULT_FILTER, query: readRouteFilterQuery(q), active: true };
      writeFilter(f);
      return f;
    }
    if (navSnapshot?.filter && typeof navSnapshot.filter === 'object') {
      const f = { ...DEFAULT_FILTER, ...navSnapshot.filter };
      writeFilter(f);
      return f;
    }
    const stored = readFilter();
    if (stored && typeof stored === 'object') return { ...DEFAULT_FILTER, ...stored };
    return { ...DEFAULT_FILTER };
  });
  const snapshotFilterKey = `${filter.query}|${filter.sortBy}|${filter.order}|${filter.active}`;
  const homeSnapshot = (() => {
    const snapshot = navSnapshot || (coldRestoreBoot ? loadHomeSnapshot() : null);
    if (!snapshot) return null;
    const cachedKey = `${snapshot.filter?.query || ''}|${snapshot.filter?.sortBy || DEFAULT_FILTER.sortBy}|${snapshot.filter?.order || DEFAULT_FILTER.order}|${!!snapshot.filter?.active}`;
    return cachedKey === snapshotFilterKey ? snapshot : null;
  })();
  const [history, setHistory] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [hideRead, setHideReadState] = useState(getHideRead);
  const [cropCover, setCropCoverState] = useState(getCropCover);
  const [showConfig, setShowConfig] = useState(false);
  const [historyDeleteTarget, setHistoryDeleteTarget] = useState(null);
  const [archiveMenu, setArchiveMenu] = useState(null);
  const [archiveDeleteTarget, setArchiveDeleteTarget] = useState(null);
  const [archiveDeleteSyncConfirmed, setArchiveDeleteSyncConfirmed] = useState(true);
  const [archiveSelectionMode, setArchiveSelectionMode] = useState(false);
  const [selectedArchiveIds, setSelectedArchiveIds] = useState(() => new Set());
  const [bulkDeletePending, setBulkDeletePending] = useState(false);
  const [bulkDeleteSyncConfirmed, setBulkDeleteSyncConfirmed] = useState(true);
  const [archiveDeleting, setArchiveDeleting] = useState(false);
  const [ehFavoriteDeleteSync, setEhFavoriteDeleteSyncState] = useState(getEhFavoriteDeleteSync);
  const [historySyncing, setHistorySyncing] = useState(false);
  const [watchlistChecking, setWatchlistChecking] = useState(false);

  const [cfgWorkerUrl, setCfgWorkerUrl] = useState(getWorkerUrl());
  const [cfgSyncToken, setCfgSyncToken] = useState(getSyncToken());
  const [readerSettings, setReaderSettings] = useState(readReaderSettings);
  const [randoms, setRandoms] = useState(() => {
    if (homeSnapshot && Array.isArray(homeSnapshot.randoms) && homeSnapshot.randoms.length > 0) {
      return homeSnapshot.randoms;
    }
    return [];
  });
  const [randomsUpdatedAt, setRandomsUpdatedAt] = useState(() => {
    const ps = homeSnapshot;
    if (!ps) return 0;
    return typeof ps.randomsUpdatedAt === 'number' ? ps.randomsUpdatedAt : (ps.ts || 0);
  });
  const [historyCollapsed, setHistoryCollapsed] = useState(() => !!homeSnapshot?.historyCollapsed);
  const [watchlistCollapsed, setWatchlistCollapsed] = useState(() => !!homeSnapshot?.watchlistCollapsed);
  const [randomCollapsed, setRandomCollapsed] = useState(() => !!homeSnapshot?.randomCollapsed);
  const [archives, setArchives] = useState(() => {
    if (homeSnapshot && Array.isArray(homeSnapshot.archives) && homeSnapshot.archives.length > 0) {
      return homeSnapshot.archives;
    }
    return [];
  });
  const [startOffset, setStartOffset] = useState(() => {
    const ps = homeSnapshot;
    return (ps && typeof ps.startOffset === 'number') ? ps.startOffset : 0;
  });
  const [hasMore, setHasMore] = useState(() => {
    const ps = homeSnapshot;
    return (ps && typeof ps.hasMore === 'boolean') ? ps.hasMore : true;
  });
  const [archiveTotal, setArchiveTotal] = useState(() => {
    const ps = homeSnapshot;
    return Number.isFinite(Number(ps?.archiveTotal)) ? Number(ps.archiveTotal) : null;
  });
  const [loading, setLoading] = useState(false);
  const [archivesRefreshing, setArchivesRefreshing] = useState(false);
  const [presets, setPresets] = useState(readPresets);
  const [showPresets, setShowPresets] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [categories, setCategories] = useState([]);
  const [columnsPerRow, setColumnsPerRow] = useState(5);
  const [stackFilterControls, setStackFilterControls] = useState(window.innerWidth < FILTER_STACK_BREAKPOINT);
  const didFetchArchivesRef = useRef(false);
  const didApplyUrlFilterRef = useRef(false);
  const archivesSectionRef = useRef(null);
  const gridRef = useRef(null);
  const sentinelRef = useRef(null);
  const pendingArchivesScrollRef = useRef(false);
  const archivesRef = useRef([]);
  const randomsRef = useRef([]);
  const randomsAutoFillBlockedRef = useRef(false);
  const randomsAutoFillInFlightRef = useRef(false);
  useEffect(() => { archivesRef.current = archives; }, [archives]);
  useEffect(() => { randomsRef.current = randoms; }, [randoms]);
  const archivesLenRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const lastFetchedRef = useRef(0);
  const lastFetchedFilterRef = useRef('');
  const archiveFetchSeqRef = useRef(0);
  const [isNarrow, setIsNarrow] = useState(window.innerWidth < 600);
  const [serverOnline, setServerOnline] = useState(null);
  const [serverProbeRunning, setServerProbeRunning] = useState(false);
  const [pageReady, setPageReady] = useState(() => !!homeSnapshot || coldRestoreBoot || !bootState.isFreshRuntime);
  const [randomsLoading, setRandomsLoading] = useState(() => {
    const ps = homeSnapshot;
    return !(ps && Array.isArray(ps.randoms) && ps.randoms.length > 0);
  });
  const [randomsRefreshing, setRandomsRefreshing] = useState(false);
  const [watchlistOverflow, setWatchlistOverflow] = useState(false);
  const coldRestoreRef = useRef(coldRestoreBoot);
  const navigationRestoreRef = useRef(!!navSnapshot && !!homeSnapshot);
  const wasBackgroundedRef = useRef(false);
  const resumeRefreshSuppressedUntilRef = useRef(0);
  const serverProbePromiseRef = useRef(null);
  const serverProbeLastAtRef = useRef(0);

  const skipResumeTriggeredRefresh = useCallback(() => {
    const now = Date.now();
    if (!wasBackgroundedRef.current && now >= resumeRefreshSuppressedUntilRef.current) return false;
    wasBackgroundedRef.current = false;
    resumeRefreshSuppressedUntilRef.current = now + RESUME_REFRESH_SUPPRESS_MS;
    lastFetchedRef.current = now;
    return true;
  }, []);

  useEffect(() => {
    const check = () => setIsNarrow(window.innerWidth < 600);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  const suggestActiveRef = useRef(false);
  const filterInputRef = useRef(null);
  const filterControlsRef = useRef(null);
  const historyScroller = useHorizontalScroller();
  const watchlistScroller = useHorizontalScroller();
  const randomScroller = useHorizontalScroller();
  const getHistoryScrollerNode = historyScroller.getNode;
  const getWatchlistScrollerNode = watchlistScroller.getNode;
  const getRandomScrollerNode = randomScroller.getNode;

  const buildHomeStateSnapshot = useCallback((overrides = {}) => ({
    archives: archivesRef.current,
    randoms: randomsRef.current,
    randomsUpdatedAt,
    startOffset,
    hasMore,
    archiveTotal,
    filter,
    historyCollapsed,
    watchlistCollapsed,
    randomCollapsed,
    scrollY: window.scrollY || window.pageYOffset || 0,
    historyScrollLeft: getHistoryScrollerNode?.()?.scrollLeft || 0,
    watchlistScrollLeft: getWatchlistScrollerNode?.()?.scrollLeft || 0,
    randomScrollLeft: getRandomScrollerNode?.()?.scrollLeft || 0,
    ...overrides,
  }), [archiveTotal, filter, getHistoryScrollerNode, getRandomScrollerNode, getWatchlistScrollerNode, hasMore, historyCollapsed, randomCollapsed, randomsUpdatedAt, startOffset, watchlistCollapsed]);

  const saveCurrentHomeForNavigation = useCallback(() => {
    const snapshot = buildHomeStateSnapshot();
    saveHomeNavigationSnapshot(snapshot);
    saveHomeSnapshot(snapshot);
  }, [buildHomeStateSnapshot]);

  const handleSelectArchive = useCallback((archiveId) => {
    saveCurrentHomeForNavigation();
    onSelectArchive(archiveId);
  }, [onSelectArchive, saveCurrentHomeForNavigation]);

  const handleNavigateHistory = useCallback(() => {
    saveCurrentHomeForNavigation();
    navigateHistory();
  }, [saveCurrentHomeForNavigation]);

  const handleNavigateWatchlist = useCallback(() => {
    saveCurrentHomeForNavigation();
    navigateWatchlist();
  }, [saveCurrentHomeForNavigation]);

  const handleNavigateDeduplicate = useCallback(() => {
    saveCurrentHomeForNavigation();
    setShowConfig(false);
    navigateDeduplicate();
  }, [saveCurrentHomeForNavigation]);

  const handleNavigateUpload = useCallback(() => {
    saveCurrentHomeForNavigation();
    setShowConfig(false);
    navigateUpload();
  }, [saveCurrentHomeForNavigation]);

  const updateReaderSettings = useCallback((updater) => {
    setReaderSettings((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      writeReaderSettings(next);
      return next;
    });
  }, []);

  const watchlistIds = useMemo(() => new Set(watchlist.map((item) => item.id || item.arcid).filter(Boolean)), [watchlist]);

  const handleOpenArchiveMenu = useCallback((archive, point, event, options = {}) => {
    if (archiveSelectionMode) return;
    const archiveId = archive?.arcid || archive?.id;
    const showRemoveWatchlist = options.showRemoveWatchlist ?? (archiveId ? watchlistIds.has(archiveId) : false);
    setArchiveMenu({ archive, x: point.x, y: point.y, ...options, showRemoveWatchlist });
  }, [archiveSelectionMode, watchlistIds]);

  const handleArchiveDownload = useCallback(async (archive) => {
    const archiveId = archive?.arcid || archive?.id;
    if (!archiveId) return;
    try {
      const { blob, filename } = await lrrApi.downloadArchive(archiveId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || `${archiveId}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert(err.message || '下载失败');
    }
  }, []);

  const handleArchiveCopyLink = useCallback(async (archive) => {
    const archiveId = archive?.arcid || archive?.id;
    if (!archiveId) return;
    const url = `${window.location.origin}/?id=${encodeURIComponent(archiveId)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      prompt('复制归档链接:', url);
    }
  }, []);

  const removeDeletedArchiveIds = useCallback((ids) => {
    const idSet = ids instanceof Set ? ids : new Set(ids);
    if (idSet.size === 0) return;
    setArchives((prev) => prev.filter((arc) => !idSet.has(arc.arcid || arc.id)));
    setRandoms((prev) => prev.filter((arc) => !idSet.has(arc.arcid || arc.id)));
    setHistory((prev) => prev.filter((item) => !idSet.has(item.id)));
    setWatchlist((prev) => prev.filter((item) => !idSet.has(item.id || item.arcid)));
    setSelectedArchiveIds((prev) => {
      const next = new Set(prev);
      idSet.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const deleteArchiveWithSync = useCallback(async (archive, confirmationEnabled) => {
    return deleteArchiveWithFavoriteSync(archive, { syncEnabled: ehFavoriteDeleteSync, confirmationEnabled });
  }, [ehFavoriteDeleteSync]);

  const handleArchiveDelete = useCallback(async () => {
    if (!archiveDeleteTarget) return;
    setArchiveDeleting(true);
    try {
      const archiveId = await deleteArchiveWithSync(archiveDeleteTarget, archiveDeleteSyncConfirmed);
      removeWatchlistItem(archiveId).catch(() => {});
      removeDeletedArchiveIds([archiveId]);
      setArchiveDeleteTarget(null);
    } catch (err) {
      alert(err.message || '删除失败');
    } finally {
      setArchiveDeleting(false);
    }
  }, [archiveDeleteSyncConfirmed, archiveDeleteTarget, deleteArchiveWithSync, removeDeletedArchiveIds, removeWatchlistItem]);

  useEffect(() => {
    if (archives.length === 0 && randoms.length === 0) return;
    saveHomeSnapshot(buildHomeStateSnapshot({
      archives,
      randoms,
    }));
  }, [archives, buildHomeStateSnapshot, randoms, archiveTotal, filter, hasMore, historyCollapsed, randomCollapsed, randomsUpdatedAt, startOffset, watchlistCollapsed]);

  const scrollToArchives = useCallback(() => {
    const run = () => {
      const target = archivesSectionRef.current || gridRef.current;
      target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('q') && consumeArchivesScrollFlag()) {
      pendingArchivesScrollRef.current = true;
      scrollToArchives();
    }
  }, [scrollToArchives]);

  useEffect(() => {
    if (!navigationRestoreRef.current || !homeSnapshot) return undefined;
    let cancelled = false;
    const restoreScroll = () => {
      if (cancelled) return;
      if (typeof homeSnapshot.historyScrollLeft === 'number') {
        const el = getHistoryScrollerNode?.();
        if (el) el.scrollLeft = homeSnapshot.historyScrollLeft;
      }
      if (typeof homeSnapshot.watchlistScrollLeft === 'number') {
        const el = getWatchlistScrollerNode?.();
        if (el) el.scrollLeft = homeSnapshot.watchlistScrollLeft;
      }
      if (typeof homeSnapshot.randomScrollLeft === 'number') {
        const el = getRandomScrollerNode?.();
        if (el) el.scrollLeft = homeSnapshot.randomScrollLeft;
      }
      if (typeof homeSnapshot.scrollY === 'number') {
        window.scrollTo({ top: homeSnapshot.scrollY, left: 0, behavior: 'auto' });
      }
    };
    const frame = requestAnimationFrame(() => requestAnimationFrame(restoreScroll));
    const timers = [60, 180, 420].map((delayMs) => setTimeout(restoreScroll, delayMs));
    const releaseTimer = setTimeout(() => {
      navigationRestoreRef.current = false;
    }, 520);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
      clearTimeout(releaseTimer);
    };
  }, [getHistoryScrollerNode, getRandomScrollerNode, getWatchlistScrollerNode, homeSnapshot]);

  useEffect(() => {
    const el = filterControlsRef.current;
    if (!el) return undefined;
    const update = () => {
      const width = el.clientWidth || window.innerWidth;
      setStackFilterControls(width < FILTER_STACK_BREAKPOINT);
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const probeServerStatus = useCallback(async ({ silent = false, force = false } = {}) => {
    if (!force && serverProbePromiseRef.current) return serverProbePromiseRef.current;
    if (!force && Date.now() - serverProbeLastAtRef.current < 2500) {
      return serverProbePromiseRef.current || serverOnline;
    }

    const task = (async () => {
      serverProbeLastAtRef.current = Date.now();
      if (!silent) setServerProbeRunning(true);
      try {
        await loadServerInfo({ forceRefresh: true });
        setServerOnline(true);
        return true;
      } catch {
        setServerOnline(false);
        return false;
      } finally {
        if (!silent) setServerProbeRunning(false);
        serverProbePromiseRef.current = null;
      }
    })();

    serverProbePromiseRef.current = task;
    return task;
  }, [serverOnline]);

  const exitColdRestoreMode = useCallback(() => {
    if (!coldRestoreRef.current) return;
    coldRestoreRef.current = false;
    setServerOnline(null);
    probeServerStatus({ force: true });
    loadCategories().then(data => { if (Array.isArray(data)) setCategories(data); });
    startTagDBUpdateTimer();
    startCategoriesUpdateTimer();
    loadTagDB();
  }, [probeServerStatus]);

  const handleTagSelect = useCallback((tag) => {
    suggestActiveRef.current = false;
    setFilter(prev => {
      const newQuery = replaceCurrentFilterToken(prev.query, tag);
      return { ...prev, query: newQuery, active: true };
    });
    setTimeout(() => filterInputRef.current?.focus(), 50);
  }, []);

  // Load tag translation DB for search suggestions
  useEffect(() => {
    if (coldRestoreRef.current) return;
    loadTagDB();
  }, []);

  // Server health check
  useEffect(() => {
    if (coldRestoreRef.current) return;
    const cached = getStoredServerInfo();
    if (cached) setServerOnline(true);
    probeServerStatus({ silent: !!cached, force: true });
  }, [probeServerStatus]);

  // Load categories and start periodic update timers
  useEffect(() => {
    const cachedCategories = getStoredCategories();
    if (Array.isArray(cachedCategories) && cachedCategories.length > 0) {
      setCategories(cachedCategories);
    }

    if (coldRestoreRef.current) return undefined;

    loadCategories().then(data => { if (Array.isArray(data)) setCategories(data); });
    startTagDBUpdateTimer();
    startCategoriesUpdateTimer();
    return () => { stopTagDBUpdateTimer(); stopCategoriesUpdateTimer(); };
  }, []);

  // Sync filter to localStorage whenever it changes
  useEffect(() => {
    writeFilter(filter);
  }, [filter]);

  // On mount: load history from Worker when configured, otherwise local storage.
  useEffect(() => {
    (async () => {
      setHistory(getHistory());
      if (hasRemoteHistory() && !coldRestoreRef.current) {
        loadHistoryState().then((state) => {
          setHistory(state.histories);
          setHideReadState(state.hideRead);
        }).catch(() => {
          setHistory(getHistory());
          setHideReadState(getHideRead());
        });
      }
    })();
  }, []);

  useEffect(() => {
    const refreshHistory = () => {
      setHistory(getHistory());
      setHideReadState(getHideRead());
    };
    window.addEventListener('lrr:history-changed', refreshHistory);
    return () => window.removeEventListener('lrr:history-changed', refreshHistory);
  }, []);

  useEffect(() => {
    setWatchlist(getWatchlist());
    if (hasRemoteWatchlist() && !coldRestoreRef.current) {
      loadWatchlistState().then((state) => setWatchlist(state.items)).catch(() => setWatchlist(getWatchlist()));
    }
  }, []);

  useEffect(() => {
    const refreshWatchlist = () => setWatchlist(getWatchlist());
    window.addEventListener('lrr:watchlist-changed', refreshWatchlist);
    return () => window.removeEventListener('lrr:watchlist-changed', refreshWatchlist);
  }, []);

  // Fetch randoms — but only if not already hydrated from page-state cache
  useEffect(() => {
    const ps = homeSnapshot;
    if (ps && Array.isArray(ps.randoms) && ps.randoms.length > 0) {
      // Already have randoms from cache — skip fetch, just mark ready
      setPageReady(true);
      if (!shouldRevalidateHydratedRandoms(ps, bootState)) return undefined;
      const timer = setTimeout(() => {
        fetchRandoms({ background: true, preferFresh: true });
      }, 450);
      return () => clearTimeout(timer);
    }
    if (coldRestoreRef.current) {
      setPageReady(true);
      setRandomsLoading(false);
      return undefined;
    }
    fetchRandoms();
    setPageReady(true);
    return undefined;
  }, []);

  // bfcache / visibility / keep-alive guard:
  // - Bump timestamps on restore to avoid spurious re-fetches.
  // - Pause resource-heavy operations when hidden to reduce memory pressure
  //   (makes iOS more likely to suspend via bfcache instead of killing).
  useEffect(() => {
    const persistBackgroundSnapshot = () => {
      markBackground({ kind: 'home' });
      saveHomeSnapshot(buildHomeStateSnapshot());
    };
    const bump = () => { lastFetchedRef.current = Date.now(); };
    const suppressResumeRefresh = () => {
      skipResumeTriggeredRefresh();
    };
    const handlePageShow = (e) => {
      if (e.persisted) suppressResumeRefresh();
    };
    let restartTimer = null;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (wasBackgroundedRef.current) suppressResumeRefresh();
        else bump();
        probeServerStatus({ silent: true });
        // Delay timer restarts by 5s — the wake-up window is when iOS
        // decides whether to keep or kill the process.  Avoid adding
        // network/CPU load during this critical period.
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          startTagDBUpdateTimer();
          startCategoriesUpdateTimer();
        }, 5000);
      } else {
        wasBackgroundedRef.current = true;
        clearTimeout(restartTimer);
        stopTagDBUpdateTimer();
        stopCategoriesUpdateTimer();
        persistBackgroundSnapshot();
      }
    };
    const handlePageHide = () => {
      wasBackgroundedRef.current = true;
      clearTimeout(restartTimer);
      stopTagDBUpdateTimer();
      stopCategoriesUpdateTimer();
      persistBackgroundSnapshot();
      // Release image blob memory before iOS evaluates process for suspension
      try { clearImageCache(); } catch {}
    };
    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        probeServerStatus({ silent: true });
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [buildHomeStateSnapshot, probeServerStatus, skipResumeTriggeredRefresh]);

  // Lock body scroll when config modal is open
  useEffect(() => {
    if (showConfig) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [showConfig]);

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth - 32;
      const cols = Math.max(1, Math.floor((w + 16) / (150 + 16)));
      setColumnsPerRow(cols);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const doFetch = useCallback(async (isReset, options = {}) => {
    const { background = false, force = false, clearSearchCache = false, filterOverride = null } = options;
    const effectiveFilter = filterOverride || filter;
    exitColdRestoreMode();
    const now = Date.now();
    const filterKey = `${effectiveFilter.query}|${effectiveFilter.sortBy}|${effectiveFilter.order}|${effectiveFilter.active}`;
    if (isReset && !force && lastFetchedFilterRef.current === filterKey && now - lastFetchedRef.current < 2500) return;

    lastFetchedFilterRef.current = filterKey;
    lastFetchedRef.current = now;
    const fetchSeq = ++archiveFetchSeqRef.current;
    if (background) setArchivesRefreshing(true);
    else setLoading(true);
    try {
      if (clearSearchCache) {
        try { await lrrApi.clearSearchCache(); } catch (e) { console.warn('清理搜索缓存失败，继续刷新归档列表', e); }
      }
      const query = effectiveFilter.active ? (effectiveFilter.query || '').trim() : '';
      const start = isReset ? 0 : startOffset;
      const res = await lrrApi.search(query, start, effectiveFilter.sortBy, effectiveFilter.order);
      const data = res.data || [];
      if (fetchSeq !== archiveFetchSeqRef.current) return;
      const total = getSearchTotal(res, data.length, isReset ? null : archiveTotal);
      setArchiveTotal(total);
      if (isReset) {
        setArchives(data);
        setStartOffset(data.length);
        setHasMore(data.length > 0 && data.length >= 50);
      } else {
        setArchives(prev => [...prev, ...data]);
        setStartOffset(start + data.length);
        setHasMore(data.length > 0 && data.length >= 50);
      }
    } catch (e) {
      console.error('获取归档列表失败', e);
    } finally {
      if (background) setArchivesRefreshing(false);
      else setLoading(false);
      if (isReset && pendingArchivesScrollRef.current) {
        pendingArchivesScrollRef.current = false;
        setTimeout(scrollToArchives, 80);
      }
    }
  }, [archiveTotal, exitColdRestoreMode, filter, scrollToArchives, startOffset]);

  // Sync state to refs for IntersectionObserver (avoids stale closures)
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  // Infinite scroll: IntersectionObserver on bottom sentinel
  // Re-create observer whenever archives length or filter changes (doFetch gets fresh closure)
  useEffect(() => { archivesLenRef.current = archives.length; }, [archives.length]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && archivesLenRef.current > 0 && hasMoreRef.current && !loadingRef.current) {
          doFetch(false);
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [archives.length, filter.query, filter.sortBy, filter.order, filter.active]);

  // Watch for new filter arrivals from tag clicks (poll localStorage briefly)
  useEffect(() => {
    const checkStoredFilter = () => {
      const stored = readFilter();
      if (stored && stored.active) {
        setFilter(prev => {
          if (prev.query !== stored.query || prev.sortBy !== stored.sortBy || prev.order !== stored.order || prev.active !== stored.active) {
            return { ...DEFAULT_FILTER, ...stored };
          }
          return prev;
        });
      }
    };
    checkStoredFilter();
    const handleFilterArrival = (event) => {
      if (event.detail?.scrollToArchives) {
        pendingArchivesScrollRef.current = true;
        scrollToArchives();
      }
      checkStoredFilter();
    };
    window.addEventListener('filter-arrival', handleFilterArrival);
    return () => window.removeEventListener('filter-arrival', handleFilterArrival);
  }, [scrollToArchives]);

  // Fetch archives when filter changes
  useEffect(() => {
    if (coldRestoreRef.current) return;
    if (navigationRestoreRef.current) {
      didFetchArchivesRef.current = true;
      lastFetchedRef.current = Date.now();
      return;
    }
    if ((filter.query || '').trim() && !filter.active) return;
    const firstFetch = !didFetchArchivesRef.current;
    didFetchArchivesRef.current = true;
    doFetch(true, { force: firstFetch });
  }, [filter.query, filter.sortBy, filter.order, filter.active]);

  // Handle popstate (browser back/forward)
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('q');
      if (q) {
        setFilter(prev => {
          const next = { ...prev, query: readRouteFilterQuery(q), active: true };
          writeFilter(next);
          return next;
        });
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const fetchRandoms = useCallback(async ({ background = false, preferFresh = true, append = false, silent = false } = {}) => {
    exitColdRestoreMode();
    if (!append) randomsAutoFillBlockedRef.current = false;
    if (background && !silent) setRandomsRefreshing(true);
    else if (!background) setRandomsLoading(true);
    const currentIds = new Set(getRandomBatchIds(randomsRef.current));
    const recentIds = new Set(readRecentRandomIds());
    try {
      let bestBatch = [];
      let bestScore = Number.NEGATIVE_INFINITY;
      const requestCount = append ? RANDOMS_BATCH_SIZE : RANDOMS_BATCH_SIZE * RANDOMS_DEFAULT_BATCHES;

      for (let attempt = 0; attempt < RANDOMS_FETCH_ATTEMPTS; attempt += 1) {
        let batch = [];
        try {
          const res = await withAbortTimeout(
            (signal) => lrrApi.getRandom(requestCount, { signal }),
            RANDOMS_REQUEST_TIMEOUT_MS,
          );
          batch = Array.isArray(res?.data) ? res.data : [];
        } catch (e) {
          if (attempt >= RANDOMS_FETCH_ATTEMPTS - 1) throw e;
          await delay(RANDOMS_RETRY_DELAY_MS);
          continue;
        }
        const score = preferFresh ? scoreRandomBatch(batch, currentIds, recentIds) : attempt;

        if (score > bestScore) {
          bestBatch = batch;
          bestScore = score;
        }

        if (!preferFresh || score >= requestCount * 5) break;
      }

      const plannedAdditions = [];
      if (append) {
        const seen = new Set(currentIds);
        bestBatch.forEach((item) => {
          const id = item?.arcid || item?.id;
          if (!id || seen.has(id)) return;
          seen.add(id);
          plannedAdditions.push(item);
        });
      }

      setRandoms((prev) => {
        if (!append) return bestBatch;
        const seen = new Set(getRandomBatchIds(prev));
        const additions = bestBatch.filter((item) => {
          const id = item?.arcid || item?.id;
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        if (additions.length === 0) return prev;
        return [...prev, ...additions].slice(0, RANDOMS_FILL_MAX_ITEMS);
      });
      setRandomsUpdatedAt(Date.now());

      const nextIds = getRandomBatchIds(bestBatch);
      const mergedRecentIds = [
        ...nextIds,
        ...readRecentRandomIds().filter((id) => !nextIds.includes(id)),
      ];
      writeRecentRandomIds(mergedRecentIds);
      return append ? plannedAdditions.length : bestBatch.length;
    } catch (e) {
      console.error('随机推荐获取失败', e);
      if (randomsRef.current.length > 0) setRandoms(randomsRef.current);
      return 0;
    } finally {
      if (background && !silent) setRandomsRefreshing(false);
      else if (!background) setRandomsLoading(false);
    }
  }, [exitColdRestoreMode]);

  useEffect(() => {
    if (
      randomCollapsed ||
      randomsLoading ||
      randomsRefreshing ||
      randoms.length === 0 ||
      randoms.length >= RANDOMS_FILL_MAX_ITEMS ||
      randomsAutoFillBlockedRef.current
    ) return undefined;

    let disposed = false;
    const frames = [];
    const timers = [];
    const needsFill = () => {
      const el = getRandomScrollerNode?.();
      return !!el && el.scrollWidth <= el.clientWidth + 8;
    };
    const fillUntilOverflow = async () => {
      if (disposed || randomsAutoFillInFlightRef.current || !needsFill()) return;
      randomsAutoFillInFlightRef.current = true;
      let emptyRuns = 0;
      try {
        while (!disposed && needsFill() && randomsRef.current.length < RANDOMS_FILL_MAX_ITEMS) {
          const before = randomsRef.current.length;
          const added = await fetchRandoms({ background: true, preferFresh: true, append: true, silent: true });
          await waitForPaint();
          const after = randomsRef.current.length;
          const grew = Math.max(Number(added) || 0, after - before);
          if (grew <= 0) {
            emptyRuns += 1;
            if (emptyRuns >= 2) {
              randomsAutoFillBlockedRef.current = true;
              break;
            }
            await delay(120);
          } else {
            emptyRuns = 0;
          }
        }
      } finally {
        randomsAutoFillInFlightRef.current = false;
      }
    };
    const scheduleCheck = (delayMs = 0) => {
      const timer = setTimeout(() => {
        const frame = requestAnimationFrame(fillUntilOverflow);
        frames.push(frame);
      }, delayMs);
      timers.push(timer);
    };

    [0, 80, 220, 520, 920, 1400].forEach(scheduleCheck);

    const el = getRandomScrollerNode?.();
    let observer = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => scheduleCheck(40));
      observer.observe(el);
    }

    return () => {
      disposed = true;
      observer?.disconnect();
      timers.forEach(clearTimeout);
      frames.forEach(cancelAnimationFrame);
    };
  }, [fetchRandoms, getRandomScrollerNode, randomCollapsed, randoms.length, randomsLoading, randomsRefreshing]);

  useEffect(() => {
    if (watchlistCollapsed || watchlist.length === 0) {
      setWatchlistOverflow(false);
      return undefined;
    }

    let disposed = false;
    const frames = [];
    const timers = [];
    const updateOverflow = () => {
      if (disposed) return;
      const el = getWatchlistScrollerNode?.();
      if (!el) return;
      setWatchlistOverflow(el.scrollWidth > el.clientWidth + 8);
    };
    const scheduleCheck = (delayMs = 0) => {
      const timer = setTimeout(() => {
        const frame = requestAnimationFrame(updateOverflow);
        frames.push(frame);
      }, delayMs);
      timers.push(timer);
    };

    [0, 80, 220, 520].forEach(scheduleCheck);
    const el = getWatchlistScrollerNode?.();
    let observer = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => scheduleCheck(40));
      observer.observe(el);
    }
    window.addEventListener('resize', updateOverflow);

    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener('resize', updateOverflow);
      timers.forEach(clearTimeout);
      frames.forEach(cancelAnimationFrame);
    };
  }, [getWatchlistScrollerNode, watchlist.length, watchlistCollapsed]);

  const displayArchives = useMemo(() => {
    if (!cropCover) return archives;
    const cpr = Math.max(1, columnsPerRow);
    const len = archives.length;
    if (len <= cpr) return archives;
    const rem = len % cpr;
    if (rem === 0) return archives;
    return archives.slice(0, len - rem);
  }, [archives, columnsPerRow, cropCover]);

  const visibleArchiveIds = useMemo(() => (
    displayArchives.map((arc) => arc.arcid || arc.id).filter(Boolean)
  ), [displayArchives]);

  const selectedArchiveList = useMemo(() => {
    if (selectedArchiveIds.size === 0) return [];
    const idSet = selectedArchiveIds;
    return archives.filter((arc) => idSet.has(arc.arcid || arc.id));
  }, [archives, selectedArchiveIds]);

  const allVisibleSelected = visibleArchiveIds.length > 0 && visibleArchiveIds.every((id) => selectedArchiveIds.has(id));

  useEffect(() => {
    if (selectedArchiveIds.size === 0) return;
    const archiveIds = new Set(archives.map((arc) => arc.arcid || arc.id).filter(Boolean));
    setSelectedArchiveIds((prev) => {
      let changed = false;
      const next = new Set();
      prev.forEach((id) => {
        if (archiveIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [archives, selectedArchiveIds.size]);

  const toggleArchiveSelectionMode = useCallback(() => {
    setArchiveMenu(null);
    setArchiveSelectionMode((prev) => {
      if (prev) setSelectedArchiveIds(new Set());
      return !prev;
    });
  }, []);

  const toggleArchiveSelection = useCallback((archive) => {
    const archiveId = archive?.arcid || archive?.id;
    if (!archiveId) return;
    setSelectedArchiveIds((prev) => {
      const next = new Set(prev);
      if (next.has(archiveId)) next.delete(archiveId);
      else next.add(archiveId);
      return next;
    });
  }, []);

  const requestArchiveDelete = useCallback((archive) => {
    setArchiveDeleteSyncConfirmed(true);
    setArchiveDeleteTarget(archive);
  }, []);

  const requestBulkArchiveDelete = useCallback(() => {
    setBulkDeleteSyncConfirmed(true);
    setBulkDeletePending(true);
  }, []);

  const toggleSelectAllVisibleArchives = useCallback(() => {
    setSelectedArchiveIds((prev) => {
      const next = new Set(prev);
      if (visibleArchiveIds.length === 0) return next;
      const allSelected = visibleArchiveIds.every((id) => next.has(id));
      visibleArchiveIds.forEach((id) => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  }, [visibleArchiveIds]);

  const handleBulkArchiveDelete = useCallback(async () => {
    if (selectedArchiveList.length === 0) return;
    setArchiveDeleting(true);
    const deletedIds = [];
    const failures = [];
    for (const archive of selectedArchiveList) {
      const archiveId = archive?.arcid || archive?.id;
      try {
        const deletedId = await deleteArchiveWithSync(archive, bulkDeleteSyncConfirmed);
        deletedIds.push(deletedId);
      } catch (err) {
        failures.push({ id: archiveId, title: archive?.title || archiveId, message: err.message || '删除失败' });
      }
    }
    if (deletedIds.length > 0) {
      removeWatchlistItems(deletedIds).catch(() => {});
      removeDeletedArchiveIds(deletedIds);
    }
    setBulkDeletePending(false);
    setArchiveDeleting(false);
    if (failures.length === 0) {
      setArchiveSelectionMode(false);
      setSelectedArchiveIds(new Set());
      return;
    }
    const preview = failures.slice(0, 5).map((item) => '- ' + item.title + ': ' + item.message).join('\n');
    alert('已删除 ' + deletedIds.length + ' 个，' + failures.length + ' 个失败：\n' + preview + (failures.length > 5 ? '\n...' : ''));
  }, [bulkDeleteSyncConfirmed, deleteArchiveWithSync, removeDeletedArchiveIds, removeWatchlistItems, selectedArchiveList]);

  const archiveCountLabel = useMemo(() => {
    if (loading && archives.length === 0) return '正在获取结果...';
    if (Number.isFinite(Number(archiveTotal))) {
      return filter.active
        ? `筛选结果 ${Number(archiveTotal).toLocaleString()} 个`
        : `共 ${Number(archiveTotal).toLocaleString()} 个档案`;
    }
    if (archives.length > 0) {
      return hasMore
        ? `已加载 ${archives.length.toLocaleString()}+ 个`
        : `共 ${archives.length.toLocaleString()} 个档案`;
    }
    return filter.active ? '筛选结果 0 个' : '共 0 个档案';
  }, [archiveTotal, archives.length, filter.active, hasMore, loading]);

  const handleManualRefreshArchives = useCallback(() => {
    setShowPresets(false);
    doFetch(true, { force: true, clearSearchCache: true });
  }, [doFetch]);

  useEffect(() => {
    if (didApplyUrlFilterRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (!q) return;
    didApplyUrlFilterRef.current = true;
    const next = { ...DEFAULT_FILTER, query: readRouteFilterQuery(q), active: true };
    writeFilter(next);
    setFilter(prev => (
      prev.query === next.query &&
      prev.sortBy === next.sortBy &&
      prev.order === next.order &&
      prev.active === next.active
        ? prev
        : next
    ));
    if (coldRestoreRef.current || !didFetchArchivesRef.current) {
      doFetch(true, { force: true, filterOverride: next });
    }
  }, []);

  useEffect(() => {
    if (coldRestoreRef.current) return undefined;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || loadingRef.current) return;
      if (skipResumeTriggeredRefresh()) return;
      doFetch(true, { background: true, force: true, clearSearchCache: true });
    };
    const timer = setInterval(refresh, ARCHIVES_AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [doFetch, skipResumeTriggeredRefresh]);

  useEffect(() => {
    const handleFocusRefresh = () => {
      if (coldRestoreRef.current || document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (skipResumeTriggeredRefresh()) return;
      if (now - lastFetchedRef.current < ARCHIVES_FOCUS_REFRESH_MS) return;
      doFetch(true, { background: true, force: true, clearSearchCache: true });
    };
    window.addEventListener('focus', handleFocusRefresh);
    document.addEventListener('visibilitychange', handleFocusRefresh);
    return () => {
      window.removeEventListener('focus', handleFocusRefresh);
      document.removeEventListener('visibilitychange', handleFocusRefresh);
    };
  }, [doFetch, skipResumeTriggeredRefresh]);

  const handleCategoryClick = useCallback((cat) => {
    const tag = cat.search || `category:${cat.name}$`;
    if (selectedCategory?.id === cat.id) {
      setSelectedCategory(null);
      const newQuery = removeFilterToken(filter.query, tag);
      applyFilter(newQuery, filter.sortBy, filter.order);
    } else {
      const newQuery = appendFilterToken(filter.query, tag);
      setSelectedCategory(cat);
      applyFilter(newQuery, filter.sortBy, filter.order);
    }
  }, [filter.query, filter.sortBy, filter.order, selectedCategory]);

  const clearFilter = () => {
    const cleared = { ...DEFAULT_FILTER };
    writeFilter(cleared);
    setFilter(cleared);
    setSelectedCategory(null);
    setArchiveTotal(null);
    navigateHome({ replace: true });
    doFetch(true, { force: true, filterOverride: cleared });
  };

  const applyFilter = (q, s, o) => {
    const query = q || '';
    const trimmedQuery = query.trim();
    const next = { query, sortBy: s, order: o, active: !!trimmedQuery };
    writeFilter(next);
    setFilter(next);
    setArchiveTotal(null);
    navigateHome({ query: trimmedQuery, replace: true });
    doFetch(true, { force: true, filterOverride: next });
  };

  const handleSearch = () => {
    applyFilter(filter.query, filter.sortBy, filter.order);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (suggestActiveRef.current) return;
      handleSearch();
    }
  };

  const savePreset = () => {
    const name = prompt('为当前筛选方案命名:');
    if (!name || !name.trim()) return;
    const newPresets = [...presets.filter(p => p.name !== name.trim()), { name: name.trim(), query: filter.query, sortBy: filter.sortBy, order: filter.order }];
    setPresets(newPresets);
    writePresets(newPresets);
  };

  const deletePreset = (name) => {
    const newPresets = presets.filter(p => p.name !== name);
    setPresets(newPresets);
    writePresets(newPresets);
  };

  const loadPreset = (p) => {
    applyFilter(p.query, p.sortBy, p.order);
    setShowPresets(false);
  };

  const filteredHistory = useMemo(() => {
    if (!hideRead) return history;
    return history.filter(h => !(h.total > 0 && h.page >= h.total));
  }, [history, hideRead]);

  const handleToggleHideRead = useCallback(() => {
    setHideReadState(v => {
      const next = !v;
      setHideRead(next).catch(() => {});
      return next;
    });
  }, []);

  const handleToggleCropCover = useCallback(() => {
    setCropCoverState(v => {
      const next = !v;
      setCropCover(next);
      return next;
    });
  }, []);

  const ehFavoriteCookieValid = hasValidEhCookie(readerSettings.ehCookie || getEhCookie());
  const ehFavoriteSyncReady = ehFavoriteCookieValid && !!getWorkerUrl() && !!getSyncToken();

  useEffect(() => {
    if (!ehFavoriteSyncReady && ehFavoriteDeleteSync) {
      setEhFavoriteDeleteSync(false);
      setEhFavoriteDeleteSyncState(false);
    }
  }, [ehFavoriteSyncReady, ehFavoriteDeleteSync]);

  const handleToggleEhFavoriteDeleteSync = useCallback(() => {
    if (!ehFavoriteSyncReady) {
      setEhFavoriteDeleteSync(false);
      setEhFavoriteDeleteSyncState(false);
      return;
    }
    setEhFavoriteDeleteSyncState(v => {
      const next = !v;
      setEhFavoriteDeleteSync(next);
      return next;
    });
  }, [ehFavoriteSyncReady]);

  const handleSyncHistory = useCallback(async () => {
    if (!getWorkerUrl() || !getSyncToken() || historySyncing) return;
    setHistorySyncing(true);
    try {
      const state = await loadHistoryState();
      setHistory(state.histories);
      setHideReadState(state.hideRead);
    } finally {
      setHistorySyncing(false);
    }
  }, [historySyncing]);

  const handleCheckWatchlist = useCallback(async () => {
    if (watchlistChecking) return;
    setWatchlistChecking(true);
    try {
      await runHistoryExistenceCheck({ force: true });
      setHistory(getHistory());
      setWatchlist(getWatchlist());
    } finally {
      setWatchlistChecking(false);
    }
  }, [watchlistChecking]);

  const requestRemoveHistory = useCallback((archive) => {
    setHistoryDeleteTarget(archive);
  }, []);

  const removeHistoryArchive = useCallback((archive) => {
    const archiveId = archive?.id || archive?.arcid;
    if (!archiveId) return;
    removeHistoryItem(archiveId).catch(() => {});
    setHistory((prev) => prev.filter((item) => item.id !== archiveId));
    setHistoryDeleteTarget(null);
  }, []);

  const addWatchlistArchive = useCallback((archive) => {
    if (!archive?.arcid && !archive?.id) return;
    addWatchlistItem(archive).catch(() => {});
    setWatchlist(getWatchlist());
  }, []);

  const removeWatchlistArchive = useCallback((archive) => {
    const archiveId = archive?.id || archive?.arcid;
    if (!archiveId) return;
    removeWatchlistItem(archiveId).catch(() => {});
    setWatchlist((prev) => prev.filter((item) => (item.id || item.arcid) !== archiveId));
  }, []);

  const handleRemoveHistory = useCallback(() => {
    removeHistoryArchive(historyDeleteTarget);
  }, [historyDeleteTarget, removeHistoryArchive]);

  return (
    <>
    <style>{`
      @keyframes serverProbeRipple {
        0% { transform: scale(0.9); opacity: 0; }
        20% { opacity: 0.5; }
        100% { transform: scale(1.95); opacity: 0; }
      }
      .history-view-all-arrow {
        color: rgba(255,255,255,0.34);
        transform: translateY(0);
        transition: color 0.18s ease, transform 0.18s ease;
      }
      .history-view-all-btn:hover .history-view-all-arrow {
        color: var(--accent);
        transform: translateX(4px);
      }
      .section-heading-link {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
        transform-origin: left center;
        transition: transform 0.16s ease;
      }
      .section-heading-link:hover {
        transform: scale(1.04);
      }
      .section-heading-link:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 4px;
        border-radius: 4px;
      }
    `}</style>
    <div style={{ padding: isNarrow ? '16px 10px' : '24px 20px', maxWidth: '1680px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '18px', marginBottom: '32px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontWeight: 600, margin: '0 0 8px 0', fontSize: '28px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            LRR 阅读器
            {serverOnline !== null && (
              <button
                type="button"
                onClick={() => probeServerStatus({ force: true })}
                aria-label="探测 LRR 服务器状态"
                title={serverProbeRunning ? '正在探测 LRR 服务器' : '点击重新探测 LRR 服务器'}
                style={{
                  position: 'relative',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '18px',
                  height: '18px',
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  cursor: serverProbeRunning ? 'wait' : 'pointer',
                  flexShrink: 0,
                }}
              >
                {serverProbeRunning && (
                  <>
                    <span style={{
                      position: 'absolute',
                      inset: '1px',
                      borderRadius: '50%',
                      border: `1px solid ${serverOnline ? 'rgba(76,175,80,0.30)' : 'rgba(244,67,54,0.30)'}`,
                      animation: 'serverProbeRipple 1.4s ease-out infinite',
                    }} />
                    <span style={{
                      position: 'absolute',
                      inset: '1px',
                      borderRadius: '50%',
                      border: `1px solid ${serverOnline ? 'rgba(76,175,80,0.22)' : 'rgba(244,67,54,0.22)'}`,
                      animation: 'serverProbeRipple 1.4s ease-out 0.42s infinite',
                    }} />
                  </>
                )}
                <span style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: serverOnline ? '#4caf50' : '#f44336',
                  boxShadow: serverOnline
                    ? '0 0 8px rgba(76,175,80,0.72)'
                    : '0 0 8px rgba(244,67,54,0.72)',
                  transition: 'background 0.3s ease, box-shadow 0.3s ease, transform 0.2s ease',
                  transform: serverProbeRunning ? 'scale(1.08)' : 'scale(1)',
                }} />
              </button>
            )}
          </h1>
          <div style={{ color: 'var(--text-sub)', fontSize: '14px' }}>欢迎回来，继续你的探索之旅</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            className="btn theme-mode-btn"
            type="button"
            onClick={onThemeModeChange}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            title={`切换主题，当前为${THEME_MODE_LABELS[themeMode] || THEME_MODE_LABELS.auto}`}
            aria-label={`当前主题：${THEME_MODE_LABELS[themeMode] || THEME_MODE_LABELS.auto}`}
          >
            <ThemeModeGlyph mode={themeMode} size={18} />
          </button>
          <button className="btn" onClick={() => {
            setCfgWorkerUrl(getWorkerUrl());
            setCfgSyncToken(getSyncToken());
            setReaderSettings(readReaderSettings());
            setShowConfig(true);
          }} style={{ fontSize: '13px' }}>设置</button>
          <button className="btn" onClick={onLogout} style={{ fontSize: '13px' }}>退出</button>
        </div>
      </div>

      {history.length > 0 && (
        <section className="glass-panel section-reveal section-reveal-delay-1" style={{ marginBottom: '32px', padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 12px', position: 'relative', zIndex: 0 }}>
            <SectionHeading glyph="continue" onClick={handleNavigateHistory} title="查看全部历史记录">继续阅读</SectionHeading>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="btn"
                onClick={handleSyncHistory}
                disabled={!getWorkerUrl() || !getSyncToken() || historySyncing}
                style={{ padding: '6px 12px', fontSize: '12px', opacity: !getWorkerUrl() || !getSyncToken() ? 0.5 : 1 }}
                title={!getWorkerUrl() || !getSyncToken() ? '配置 Worker 后可从远端读取历史记录' : '从 Worker 刷新阅读历史'}
              >
                {historySyncing ? '刷新中' : '刷新'}
              </button>
              <CollapseButton
                collapsed={historyCollapsed}
                onClick={() => setHistoryCollapsed(v => !v)}
                title={historyCollapsed ? '展开继续阅读' : '收起继续阅读'}
              />
            </div>
          </div>
          <div style={{ overflow: 'hidden', transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)', maxHeight: historyCollapsed ? '0px' : '368px' }}>
            <div ref={historyScroller.ref} onWheelCapture={historyScroller.onWheelCapture} onScroll={historyScroller.onScroll} onMouseDown={historyScroller.onMouseDown} onClickCapture={historyScroller.onClickCapture} onDragStart={historyScroller.onDragStart} style={{ display: 'flex', gap: isNarrow ? '10px' : '16px', overflowX: 'auto', overflowY: 'hidden', padding: isNarrow ? '8px 14px 16px' : '8px 20px 16px', position: 'relative', zIndex: 1, ...historyScroller.getTouchScrollStyle(), ...historyScroller.getMouseScrollStyle() }} className="no-scrollbar">
              {filteredHistory.length > 0 ? (
                <>
                  {filteredHistory.slice(0, 10).map(h => (
                    <ArchiveCard key={`hist-${h.id}`} className={watchlistIds.has(h.id) ? 'watchlist-card' : undefined} archive={h} onClick={() => handleSelectArchive(h.id)} onArchiveContextMenu={(archive, point, event) => handleOpenArchiveMenu(archive, point, event, { showRemoveHistory: true })} longPressTitle="打开菜单" currentPage={h.page} showProgressBar noCrop={!cropCover} cacheOnly={coldRestoreRef.current} />
                  ))}
                  {filteredHistory.length > 10 && (
                    <button
                      type="button"
                      onClick={handleNavigateHistory}
                      className="history-view-all-btn"
                      style={{
                        flexShrink: 0,
                        width: isNarrow ? '54px' : '68px',
                        minWidth: isNarrow ? '54px' : '68px',
                        height: '286px',
                        alignSelf: 'stretch',
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        boxShadow: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                      title="查看全部阅读历史"
                      aria-label="查看全部阅读历史"
                    >
                      <span className="history-view-all-arrow" aria-hidden="true" style={{ display: 'flex', alignItems: 'center' }}>
                        <svg viewBox="0 0 36 48" width="36" height="48" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 8l14 16L8 40" />
                          <path d="M18 8l14 16-14 16" />
                        </svg>
                      </span>
                    </button>
                  )}
                </>
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--text-sub)', padding: '4px 0', whiteSpace: 'nowrap' }}>所有归档均已读完</div>
              )}
            </div>
          </div>
        </section>
      )}

      {!pageReady && history.length === 0 && (
        <section className="glass-panel section-reveal section-reveal-delay-1" style={{ marginBottom: '32px', padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 20px 12px', position: 'relative', zIndex: 0 }}>
            <SectionHeading glyph="continue">继续阅读</SectionHeading>
          </div>
          <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', overflowY: 'hidden', overscrollBehaviorX: 'contain', overscrollBehaviorY: 'contain', padding: isNarrow ? '8px 14px 16px' : '8px 20px 16px', position: 'relative', zIndex: 1 }} className="no-scrollbar">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={`hsk-${i}`} showProgress />
            ))}
          </div>
        </section>
      )}

      {watchlist.length > 0 && (
        <section className="glass-panel section-reveal section-reveal-delay-1" style={{ marginBottom: '32px', padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 12px', position: 'relative', zIndex: 0 }}>
            <SectionHeading glyph="watchlist" onClick={handleNavigateWatchlist} title="查看全部待看归档">待看归档</SectionHeading>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="btn"
                onClick={handleCheckWatchlist}
                disabled={watchlistChecking}
                style={{ padding: '6px 12px', fontSize: '12px', opacity: watchlistChecking ? 0.72 : 1 }}
                title="检查待看归档是否仍存在于 LANraragi"
              >
                {watchlistChecking ? '检查中' : '刷新'}
              </button>
              <CollapseButton
                collapsed={watchlistCollapsed}
                onClick={() => setWatchlistCollapsed(v => !v)}
                title={watchlistCollapsed ? '展开待看归档' : '收起待看归档'}
              />
            </div>
          </div>
          <div style={{ overflow: 'hidden', transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)', maxHeight: watchlistCollapsed ? '0px' : '368px' }}>
            <div ref={watchlistScroller.ref} onWheelCapture={watchlistScroller.onWheelCapture} onScroll={watchlistScroller.onScroll} onMouseDown={watchlistScroller.onMouseDown} onClickCapture={watchlistScroller.onClickCapture} onDragStart={watchlistScroller.onDragStart} style={{ display: 'flex', gap: isNarrow ? '10px' : '16px', overflowX: 'auto', overflowY: 'hidden', padding: isNarrow ? '8px 14px 16px' : '8px 20px 16px', position: 'relative', zIndex: 1, ...watchlistScroller.getTouchScrollStyle(), ...watchlistScroller.getMouseScrollStyle() }} className="no-scrollbar">
              {watchlist.map(item => (
                <ArchiveCard key={`watch-${item.id || item.arcid}`} archive={item} onClick={() => handleSelectArchive(item.id || item.arcid)} onArchiveContextMenu={(archive, point, event) => handleOpenArchiveMenu(archive, point, event, { showRemoveWatchlist: true })} longPressTitle="打开菜单" noCrop={!cropCover} cacheOnly={coldRestoreRef.current} />
              ))}
              {watchlistOverflow && (
                <button
                  type="button"
                  onClick={handleNavigateWatchlist}
                  className="history-view-all-btn"
                  style={{
                    flexShrink: 0,
                    width: isNarrow ? '54px' : '68px',
                    minWidth: isNarrow ? '54px' : '68px',
                    height: '286px',
                    alignSelf: 'stretch',
                    padding: 0,
                    border: 'none',
                    background: 'transparent',
                    boxShadow: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                  title="查看全部待看归档"
                  aria-label="查看全部待看归档"
                >
                  <span className="history-view-all-arrow" aria-hidden="true" style={{ display: 'flex', alignItems: 'center' }}>
                    <svg viewBox="0 0 36 48" width="36" height="48" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 8l14 16L8 40" />
                      <path d="M18 8l14 16-14 16" />
                    </svg>
                  </span>
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {randomsLoading ? (
        <section className="glass-panel section-reveal section-reveal-delay-2" style={{ marginBottom: '40px', padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: isNarrow ? '12px 14px' : '12px 20px', height: '50px', minHeight: '50px', boxSizing: 'border-box', position: 'relative', zIndex: 0 }}>
            <SectionHeading glyph="random">随机漫游</SectionHeading>
            <button className="btn" onClick={() => fetchRandoms({ preferFresh: true })} disabled={randomsRefreshing} style={{ padding: '6px 14px', fontSize: '12px', opacity: randomsRefreshing ? 0.72 : 1 }}>刷新</button>
          </div>
          <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', overflowY: 'hidden', overscrollBehaviorX: 'contain', overscrollBehaviorY: 'contain', padding: isNarrow ? '8px 14px 16px' : '8px 20px 16px', position: 'relative', zIndex: 1 }} className="no-scrollbar">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCard key={`rsk-${i}`} />
            ))}
          </div>
        </section>
      ) : randoms.length > 0 ? (
        <section className="glass-panel section-reveal section-reveal-delay-2" style={{ marginBottom: '40px', padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: isNarrow ? '12px 14px' : '12px 20px', height: '50px', minHeight: '50px', boxSizing: 'border-box', position: 'relative', zIndex: 0 }}>
            <SectionHeading glyph="random">随机漫游</SectionHeading>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button className="btn" onClick={() => fetchRandoms({ preferFresh: true })} disabled={randomsRefreshing} style={{ padding: '6px 14px', fontSize: '12px', opacity: randomsRefreshing ? 0.72 : 1 }}>刷新</button>
              <CollapseButton
                collapsed={randomCollapsed}
                onClick={() => setRandomCollapsed(v => !v)}
                title={randomCollapsed ? '展开随机漫游' : '收起随机漫游'}
              />
            </div>
          </div>
          <div style={{ overflow: 'hidden', transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)', maxHeight: randomCollapsed ? '0px' : '368px' }}>
            <div ref={randomScroller.ref} onWheelCapture={randomScroller.onWheelCapture} onScroll={randomScroller.onScroll} onMouseDown={randomScroller.onMouseDown} onClickCapture={randomScroller.onClickCapture} onDragStart={randomScroller.onDragStart} style={{ display: 'flex', gap: isNarrow ? '10px' : '16px', overflowX: 'auto', overflowY: 'hidden', padding: isNarrow ? '8px 14px 16px' : '8px 20px 16px', position: 'relative', zIndex: 1, ...randomScroller.getTouchScrollStyle(), ...randomScroller.getMouseScrollStyle() }} className="no-scrollbar">
              {randoms.map(arc => (
                <ArchiveCard key={`rnd-${arc.arcid}`} className={watchlistIds.has(arc.arcid || arc.id) ? 'watchlist-card' : undefined} archive={arc} onClick={() => handleSelectArchive(arc.arcid)} onArchiveContextMenu={handleOpenArchiveMenu} noCrop={!cropCover} cacheOnly={coldRestoreRef.current} />
              ))}
            </div>
          </div>
        </section>
      ) : (
        <section className="glass-panel section-reveal section-reveal-delay-2" style={{ marginBottom: '40px', padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: isNarrow ? '12px 14px' : '12px 20px', height: '50px', minHeight: '50px', boxSizing: 'border-box', position: 'relative', zIndex: 0 }}>
            <SectionHeading glyph="random">随机漫游</SectionHeading>
            <button className="btn" onClick={() => fetchRandoms({ preferFresh: true })} disabled={randomsRefreshing} style={{ padding: '6px 14px', fontSize: '12px', opacity: randomsRefreshing ? 0.72 : 1 }}>{randomsRefreshing ? '刷新中' : '刷新'}</button>
          </div>
          <div style={{ padding: isNarrow ? '10px 14px 18px' : '10px 20px 20px', color: 'var(--text-sub)', fontSize: '13px' }}>
            暂无随机漫游结果
          </div>
        </section>
      )}

      <section ref={archivesSectionRef} className="glass-panel section-reveal section-reveal-delay-3" style={{ padding: isNarrow ? '20px 14px' : '24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', minWidth: 0, flexWrap: 'wrap' }}>
              <SectionHeading glyph="archives" style={{ lineHeight: 1 }}>全部档案</SectionHeading>
              <span style={{ color: 'var(--text-sub)', fontSize: '12px', lineHeight: 1, paddingBottom: '1px' }}>
                {archiveCountLabel}
              </span>
            </div>
            <div style={{ display: 'flex', gap: isNarrow ? '4px' : '8px', flexShrink: 0, alignItems: 'center', justifyContent: 'flex-end' }}>
              <button
                className="btn"
                style={{ padding: '6px 12px', fontSize: '12px' }}
                onClick={toggleArchiveSelectionMode}
                disabled={archiveDeleting}
              >
                {archiveSelectionMode ? '取消多选' : '多选'}
              </button>
              <button
                className="btn"
                style={{ padding: '6px 12px', fontSize: '12px', opacity: archivesRefreshing ? 0.72 : 1 }}
                onClick={handleManualRefreshArchives}
                disabled={loading || archivesRefreshing || archiveDeleting}
                title="清理 LANraragi 搜索缓存并重新获取归档列表"
              >
                {archivesRefreshing ? '刷新中' : '刷新'}
              </button>
            </div>
          </div>

          <div
            style={{
              maxHeight: archiveSelectionMode ? '48px' : '0px',
              opacity: archiveSelectionMode ? 1 : 0,
              overflow: 'hidden',
              transform: archiveSelectionMode ? 'translateY(0)' : 'translateY(-6px)',
              transition: 'max-height 0.26s cubic-bezier(0.4,0,0.2,1), opacity 0.2s ease, transform 0.26s cubic-bezier(0.4,0,0.2,1)',
            }}
          >
            <div style={{ display: 'flex', gap: isNarrow ? '6px' : '8px', alignItems: 'center', flexWrap: 'wrap', paddingTop: '2px' }}>
              <span style={{ color: 'var(--text-sub)', fontSize: '12px', whiteSpace: 'nowrap' }}>
                已选 {selectedArchiveIds.size} 个
              </span>
              <button
                className="btn"
                style={{ padding: '6px 12px', fontSize: '12px' }}
                onClick={toggleSelectAllVisibleArchives}
                disabled={visibleArchiveIds.length === 0 || archiveDeleting}
              >
                {allVisibleSelected ? '取消全选' : '全选当前'}
              </button>
              <button
                className="btn"
                style={{ padding: '6px 12px', fontSize: '12px', background: 'rgba(244,67,54,0.16)', borderColor: 'rgba(244,67,54,0.32)', color: '#ffd2d0', opacity: selectedArchiveIds.size === 0 || archiveDeleting ? 0.55 : 1 }}
                onClick={requestBulkArchiveDelete}
                disabled={selectedArchiveIds.size === 0 || archiveDeleting}
              >
                {archiveDeleting ? '删除中' : '删除所选'}
              </button>
            </div>
          </div>

          <div
            ref={filterControlsRef}
            style={{
              display: 'flex',
              gap: `${FILTER_LAYOUT_GAP}px`,
              flexDirection: stackFilterControls ? 'column' : 'row',
              flexWrap: 'nowrap',
              alignItems: stackFilterControls ? 'stretch' : 'center',
            }}
          >
            <div style={{ flex: stackFilterControls || isNarrow ? '1 1 100%' : `1 1 ${FILTER_INPUT_MIN_WIDTH}px`, minWidth: stackFilterControls || isNarrow ? '100%' : `${FILTER_INPUT_MIN_WIDTH}px`, maxWidth: '100%', position: 'relative' }}>
              <input
                ref={filterInputRef}
                type="text"
                className="input-glass"
                style={{ width: '100%', boxSizing: 'border-box', paddingRight: filter.query ? '66px' : '38px' }}
                placeholder={filter.active ? `筛选: ${filter.query}` : '搜索标签或标题... 按回车筛选'}
                value={filter.query}
                onChange={(e) => {
                  if (showPresets) setShowPresets(false);
                  const val = e.target.value;
                  if (val === '' && filter.active) {
                    clearFilter();
                  } else {
                    setFilter(prev => ({ ...prev, query: val, active: false }));
                  }
                }}
                onKeyDown={handleKeyDown}
              />
              {filter.query && (
                <button
                  className="input-clear-btn"
                  onClick={() => clearFilter()}
                  style={{
                    position: 'absolute', right: '36px', top: '0', bottom: '0',
                    display: 'flex', alignItems: 'center',
                  }}
                  title="清除筛选"
                >✕</button>
              )}
              <button
                type="button"
                className="input-clear-btn"
                onClick={() => {
                  suggestActiveRef.current = false;
                  setShowPresets(v => !v);
                }}
                style={{
                  position: 'absolute', right: '8px', top: '0', bottom: '0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '24px',
                }}
                title={showPresets ? '关闭筛选预设' : '打开筛选预设'}
                aria-label="筛选预设"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style={{ transition: 'transform 0.2s ease', transform: showPresets ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                  <path d="M6 9l6 6 6-6z" />
                </svg>
              </button>
              {!showPresets && (
                <TagSuggest
                  inputValue={filter.query}
                  onSelectTag={handleTagSelect}
                  containerRef={filterInputRef}
                  onSetActive={(v) => { suggestActiveRef.current = v; }}
                />
              )}
              {showPresets && (
                <div className="dropdown-animate" style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 'calc(100% + 8px)',
                  zIndex: 50,
                  background: 'var(--dropdown-bg)',
                  backdropFilter: 'blur(18px)',
                  WebkitBackdropFilter: 'blur(18px)',
                  borderRadius: '10px',
                  padding: '14px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  boxShadow: '0 14px 42px rgba(0,0,0,0.42)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-sub)' }}>已保存的筛选方案</span>
                    <button className="btn" style={{ padding: '5px 10px', fontSize: '11px' }} onClick={savePreset}>
                      + 保存当前筛选
                    </button>
                  </div>
                  {presets.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-sub)', padding: '8px 0' }}>
                      暂无预设。设置筛选条件后点击「保存当前筛选」。
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {presets.map(p => (
                        <div key={p.name} style={{
                          display: 'flex', alignItems: 'center', gap: '4px',
                          background: 'rgba(255,255,255,0.06)', borderRadius: '8px',
                          padding: '6px 10px', border: '1px solid rgba(255,255,255,0.1)'
                        }}>
                          <button
                            className="btn"
                            style={{ padding: '4px 10px', fontSize: '12px', border: 'none', background: 'transparent' }}
                            onClick={() => loadPreset(p)}
                            title={`${p.query} / ${p.sortBy} / ${p.order}`}
                          >
                            {p.name}
                          </button>
                          <button
                            onClick={() => deletePreset(p.name)}
                            style={{
                              background: 'transparent', border: 'none', color: '#888',
                              cursor: 'pointer', fontSize: '14px', padding: '0 4px', lineHeight: 1
                            }}
                            title="删除此预设"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '12px', flex: stackFilterControls ? '1 1 100%' : `0 1 ${FILTER_ACTIONS_MIN_WIDTH}px`, minWidth: stackFilterControls ? '100%' : `${FILTER_ACTIONS_MIN_WIDTH}px`, width: stackFilterControls ? '100%' : 'auto' }}>
              <CustomSelect
                compact
                style={{ flex: 1 }}
                value={filter.sortBy}
                onChange={(v) => setFilter(prev => ({ ...prev, sortBy: v }))}
                options={[{ label: '按添加时间', value: 'date_added' }, { label: '按标题', value: 'title' }]}
              />
              <CustomSelect
                compact
                style={{ flex: 1 }}
                value={filter.order}
                onChange={(v) => setFilter(prev => ({ ...prev, order: v }))}
                options={[{ label: '倒序', value: 'desc' }, { label: '正序', value: 'asc' }]}
              />
              <button className="btn" style={{ padding: '8px 18px', fontSize: '13px', whiteSpace: 'nowrap', flexShrink: 0 }} onClick={handleSearch}>
                筛选
              </button>
            </div>
          </div>
        </div>

        {categories.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px', alignItems: 'center', justifyContent: 'center' }}>
            {categories.map(cat => {
              const isActive = selectedCategory?.id === cat.id;
              const label = cat.name || cat.id;
              return (
                <button
                  key={cat.id}
                  className="btn"
                  onClick={() => handleCategoryClick(cat)}
                  style={{
                    padding: '4px 12px',
                    fontSize: '12px',
                    fontWeight: isActive ? 600 : 400,
                    borderRadius: '18px',
                    ...(isActive ? {
                      background: 'var(--accent)',
                      borderColor: 'var(--accent)',
                      color: 'white',
                      transform: 'translateY(-2px)',
                    } : {}),
                  }}
                  title={label}
                >
                  {label.length > 12 ? label.slice(0, 12) + '...' : label}
                </button>
              );
            })}
          </div>
        )}

        <div ref={gridRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gridAutoFlow: 'dense', gap: isNarrow ? '10px' : '16px', justifyItems: 'center' }}>
          {archives.length === 0 && loading ? (
            Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={`gsk-${i}`} />)
          ) : (
            displayArchives.map((arc, index) => (
              <ArchiveCard key={`${arc.arcid}-${index}`} className={watchlistIds.has(arc.arcid || arc.id) ? 'watchlist-card' : undefined} archive={arc} onClick={() => handleSelectArchive(arc.arcid)} onArchiveContextMenu={handleOpenArchiveMenu} noCrop={!cropCover} cacheOnly={coldRestoreRef.current} selectionMode={archiveSelectionMode} selected={selectedArchiveIds.has(arc.arcid || arc.id)} onSelectToggle={toggleArchiveSelection} />
            ))
          )}
        </div>

        {archives.length === 0 && !loading && (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-sub)', fontSize: '14px' }}>
            {filter.active ? '没有匹配的归档，请尝试其他筛选条件' : '仓库为空，请先在 LANraragi 中添加归档'}
          </div>
        )}

        <div ref={sentinelRef} style={{ height: '1px' }} />

        <div style={{ textAlign: 'center', marginTop: '36px', paddingBottom: '12px' }}>
          {hasMore ? (
            <button className="btn" style={{ padding: '10px 40px' }} onClick={() => doFetch(false)} disabled={loading}>
              {loading ? '加载中...' : '加载更多'}
            </button>
          ) : (archives.length > 0 && (
            <div style={{ color: 'var(--text-sub)' }}>— 已经到底啦 —</div>
          ))}
        </div>
      </section>
    </div>
    {showConfig && createPortal(
      <div onClick={() => setShowConfig(false)} style={{
        position: 'fixed', inset: 0, zIndex: 100000,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}>
        <form className="glass-panel" onClick={e => e.stopPropagation()} onSubmit={(e) => {
          e.preventDefault();
          setWorkerUrl(cfgWorkerUrl);
          setSyncToken(cfgSyncToken);
          setShowConfig(false);
        }} style={{
          padding: 0, display: 'flex', flexDirection: 'column', gap: 0,
          width: '100%', maxWidth: '640px',
          maxHeight: 'calc(100dvh - 32px)', overflow: 'hidden',
        }}>
          <div style={{ textAlign: 'center', padding: '28px 28px 12px' }}>
            <h2 className="settings-title">设置</h2>
          </div>

          <div className="settings-panel-scroll" style={{ display: 'flex', flexDirection: 'column', gap: '18px', padding: '0 28px 18px', overflowY: 'auto', minHeight: 0 }}>

          <CacheSettings />

          <div className="settings-row" title="让横版或方形封面按竖向卡片比例显示，书库网格会更整齐。">
            <span className="settings-row-title">裁剪封面</span>
            <ToggleSwitch checked={cropCover} onChange={handleToggleCropCover} label="裁剪封面" />
          </div>

          <div className="settings-row" title="阅读历史中不显示已经读到最后一页的归档，继续阅读列表会更短。">
            <span className="settings-row-title">隐藏已读完</span>
            <ToggleSwitch checked={hideRead} onChange={handleToggleHideRead} label="隐藏已读完" />
          </div>

          <div className="settings-section">
            <div className="settings-section-title">EH 评论区</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label className="settings-row" title="在阅读器里加载来源画廊的评论，需要可访问 EH/EX 的 Cookie。">
                <span className="settings-row-title">启用 EH 评论区</span>
                <ToggleSwitch checked={readerSettings.ehEnabled} onChange={() => updateReaderSettings((s) => ({ ...s, ehEnabled: !s.ehEnabled }))} label="启用 EH 评论区" />
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label className="settings-field-label" title="至少需要能访问目标画廊的 Cookie；同步删除收藏夹还需要 ipb_member_id 与 ipb_pass_hash。">EH Cookie</label>
                <input type="text" className="input-glass"
                  value={readerSettings.ehCookie || ''}
                  onChange={(e) => updateReaderSettings((s) => ({ ...s, ehCookie: e.target.value }))}
                  placeholder="igneous=...; ipb_member_id=...; ipb_pass_hash=..."
                  style={{ padding: '8px 10px', fontSize: '12px', width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              {readerSettings.ehEnabled && (
                <>
                  <label className="settings-row" title="低于这个分数的评论会被隐藏，填 0 表示不过滤。">
                    <span className="settings-row-title">最低展示分数</span>
                    <input type="text" inputMode="numeric" pattern="-?[0-9]*" className="input-glass no-spinner"
                      value={String(readerSettings.ehMinScore)}
                      onChange={(e) => { const v = e.target.value; const n = parseInt(v, 10); if (!isNaN(n) && n >= -999) updateReaderSettings((s) => ({ ...s, ehMinScore: n })); else if (v === '' || v === '-') updateReaderSettings((s) => ({ ...s, ehMinScore: 0 })); }}
                      onBlur={() => { const n = parseInt(readerSettings.ehMinScore, 10); if (isNaN(n)) updateReaderSettings((s) => ({ ...s, ehMinScore: 0 })); }}
                      style={{ width: '52px', padding: '5px 6px', fontSize: '12px', textAlign: 'center' }}
                    />
                  </label>
                  <label className="settings-row" title="单个归档最多显示的评论数量，范围 1 到 200。">
                    <span className="settings-row-title">最多展示数量</span>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" className="input-glass no-spinner"
                      value={String(readerSettings.ehMaxComments)}
                      onChange={(e) => { const v = e.target.value; const n = parseInt(v, 10); if (!isNaN(n) && n >= 1 && n <= 200) updateReaderSettings((s) => ({ ...s, ehMaxComments: n })); }}
                      onBlur={() => { const n = parseInt(readerSettings.ehMaxComments, 10); if (isNaN(n) || n < 1) updateReaderSettings((s) => ({ ...s, ehMaxComments: 45 })); else if (n > 200) updateReaderSettings((s) => ({ ...s, ehMaxComments: 200 })); }}
                      style={{ width: '52px', padding: '5px 6px', fontSize: '12px', textAlign: 'center' }}
                    />
                  </label>
                  <label className="settings-row" title="按评论分数或发布时间排序。">
                    <span className="settings-row-title">排序方式</span>
                    <div style={{ width: '110px', flexShrink: 0 }}>
                      <CustomSelect
                        value={readerSettings.ehSortMethod}
                        options={[{ label: '分数', value: 'score' }, { label: '时间', value: 'time' }]}
                        onChange={(v) => updateReaderSettings((s) => ({ ...s, ehSortMethod: v }))}
                        compact
                      />
                    </div>
                  </label>
                  <label className="settings-row" title="倒序优先显示最高分或最新评论，正序则相反。">
                    <span className="settings-row-title">排序方向</span>
                    <div style={{ width: '110px', flexShrink: 0 }}>
                      <CustomSelect
                        value={readerSettings.ehSortOrder}
                        options={[{ label: '倒序', value: 'desc' }, { label: '正序', value: 'asc' }]}
                        onChange={(v) => updateReaderSettings((s) => ({ ...s, ehSortOrder: v }))}
                        compact
                      />
                    </div>
                  </label>
                </>
              )}
            </div>
          </div>

          <div className="settings-row" title={ehFavoriteSyncReady ? '删除归档时同步移除 source 指向的 EH/EX 收藏；删除弹窗里仍可单次取消。' : '需要先配置 Worker、访问 Token，以及包含 ipb_member_id / ipb_pass_hash 的 EH Cookie。'}>
            <span className="settings-row-title">同步删除 E 站收藏夹</span>
            <ToggleSwitch checked={ehFavoriteDeleteSync && ehFavoriteSyncReady} onChange={handleToggleEhFavoriteDeleteSync} disabled={!ehFavoriteSyncReady} label="同步删除 E 站收藏夹" />
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Worker 设置</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label className="settings-field-label" title="用于多设备同步阅读历史、待看和删除收藏夹等 Worker 功能。">
                  Cloudflare Worker 端点
                </label>
                <input type="text" className="input-glass"
                  value={cfgWorkerUrl}
                  onChange={(e) => setCfgWorkerUrl(e.target.value)}
                  placeholder="https://lrr-sync.xxx.workers.dev"
                  style={{ padding: '8px 12px', fontSize: '13px' }}
                />
              </div>

              <div>
                <label className="settings-field-label" title="同一 Token 下的设备会共享同步数据；Token 需要预先写入 Worker KV 的 tokens 字段。">
                  访问 Token
                </label>
                <input type="password" className="input-glass"
                  value={cfgSyncToken}
                  onChange={(e) => setCfgSyncToken(e.target.value)}
                  placeholder="需与 KV 空间 tokens 字段中的 Token 保持一致"
                  style={{ padding: '8px 12px', fontSize: '13px' }}
                />
              </div>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">工具</div>
            <div className="settings-tool-grid">
              <button type="button" className="btn" onClick={handleNavigateUpload} style={{ width: '100%', padding: '10px', fontSize: '13px' }}>上传归档</button>
              <button type="button" className="btn" onClick={handleNavigateDeduplicate} style={{ width: '100%', padding: '10px', fontSize: '13px' }}>重复归档检测</button>
            </div>
            <div style={{ borderTop: '1px solid var(--glass-border)', marginTop: '14px' }} />
          </div>

          <AppVersion compact />

          </div>

          <div style={{ display: 'flex', gap: '10px', padding: '16px 28px 0', borderTop: '1px solid var(--glass-border)' }}>
            <button type="button" className="btn"
              onClick={() => {
                const encoded = exportConfig();
                navigator.clipboard.writeText(encoded).then(() => alert('配置已复制到剪贴板。在其他设备粘贴导入即可。')).catch(() => {
                  prompt('复制以下文本到其他设备导入:', encoded);
                });
              }}
              style={{ flex: 1, padding: '9px', fontSize: '12px' }}>
              导出配置
            </button>
            <button type="button" className="btn"
              onClick={async () => {
                let encoded = '';
                try { encoded = await navigator.clipboard.readText(); } catch {}
                if (!encoded) encoded = prompt('粘贴从其他设备导出的配置文本:') || '';
                if (!encoded) return;
                try {
                  const count = importConfig(encoded);
                  setCfgWorkerUrl(getWorkerUrl());
                  setCfgSyncToken(getSyncToken());
                  setReaderSettings(readReaderSettings());
                  setEhFavoriteDeleteSyncState(getEhFavoriteDeleteSync());
                  alert(`已导入 ${count} 项配置`);
                } catch (e) {
                  alert(e.message || '导入失败');
                }
              }}
              style={{ flex: 1, padding: '9px', fontSize: '12px' }}>
              导入配置
            </button>
          </div>

          <div style={{ display: 'flex', gap: '10px', padding: '10px 28px 24px' }}>
            <button type="button" className="btn" onClick={() => setShowConfig(false)}
              style={{ flex: 1, padding: '10px' }}>
              取消
            </button>
            <button type="submit" className="btn"
              style={{ flex: 1, padding: '10px' }}>
              保存
            </button>
          </div>
        </form>
      </div>,
      document.body
    )}
    <ArchiveContextMenu
      menu={archiveMenu}
      onClose={() => setArchiveMenu(null)}
      onRead={(archive) => handleSelectArchive(archive.arcid || archive.id)}
      onEditMetadata={(archive) => navigateToMetadata(archive.arcid || archive.id)}
      onDownload={handleArchiveDownload}
      onCopyLink={handleArchiveCopyLink}
      onDelete={requestArchiveDelete}
      onRemoveHistory={removeHistoryArchive}
      onAddWatchlist={addWatchlistArchive}
      onRemoveWatchlist={removeWatchlistArchive}
    />
    <ConfirmDialog
      open={!!archiveDeleteTarget}
      title="确认删除归档"
      message={archiveDeleteTarget ? `将从 LANraragi 中删除“${archiveDeleteTarget.title || archiveDeleteTarget.arcid || archiveDeleteTarget.id}”。此操作不可撤销。` : ''}
      confirmLabel={archiveDeleting ? '删除中...' : '确认删除'}
      cancelLabel="取消"
      onConfirm={handleArchiveDelete}
      onCancel={() => { if (!archiveDeleting) setArchiveDeleteTarget(null); }}
      confirmDisabled={archiveDeleting}
    >
      {ehFavoriteDeleteSync && (
        <EhFavoriteDeleteSwitch checked={archiveDeleteSyncConfirmed} onChange={setArchiveDeleteSyncConfirmed} disabled={archiveDeleting} />
      )}
    </ConfirmDialog>
    <ConfirmDialog
      open={bulkDeletePending}
      title="确认批量删除归档"
      message={`将从 LANraragi 中删除选中的 ${selectedArchiveIds.size} 个归档。此操作不可撤销。`}
      confirmLabel={archiveDeleting ? '删除中...' : '确认删除'}
      cancelLabel="取消"
      onConfirm={handleBulkArchiveDelete}
      onCancel={() => { if (!archiveDeleting) setBulkDeletePending(false); }}
      confirmDisabled={archiveDeleting}
    >
      {ehFavoriteDeleteSync && (
        <EhFavoriteDeleteSwitch checked={bulkDeleteSyncConfirmed} onChange={setBulkDeleteSyncConfirmed} disabled={archiveDeleting} />
      )}
    </ConfirmDialog>
    <ConfirmDialog
      open={!!historyDeleteTarget}
      title="确认删除阅读记录"
      message={historyDeleteTarget ? `将“${historyDeleteTarget.title}”从继续阅读中移除。再次阅读该归档时会重新加入历史记录。` : ''}
      confirmLabel="确认删除"
      cancelLabel="取消"
      onConfirm={handleRemoveHistory}
      onCancel={() => setHistoryDeleteTarget(null)}
    />
    </>
  );
}
