import React, { useCallback, useMemo, useState } from 'react';
import ArchiveCard from '../components/ArchiveCard';
import ConfirmDialog from '../components/ConfirmDialog';
import { lrrApi } from '../lib/api';
import {
  buildDuplicateGroups,
  createCoverSignature,
  DEDUPE_DEFAULT_START_DATE,
  filterArchivesByDateRange,
  filterDuplicateGroupsForSavedState,
  findDuplicatePairsAsync,
  getTodayDateString,
  normalizeDedupeDateRange,
  selectDuplicateDeletionIds,
  toPairKey,
} from '../lib/deduplicate';
import { extractEhGalleryUrl, getEhCookie, getEhFavoriteDeleteSync, removeEhFavorite, shouldSyncEhFavorite } from '../lib/ehFavoriteSync';
import { getNonDuplicatePairKeys, markNonDuplicatePairs } from '../lib/worker-kv';
import { getSyncToken, getWorkerUrl } from '../lib/worker-config';

const BATCH_SIZE = 50;
const THUMBNAIL_CONCURRENCY = 4;
const MINION_POLL_MS = 1000;
const DEDUPE_SAVED_RESULT_KEY = 'lrr_dedupe_saved_result_v1';

function getSearchTotal(res, dataLength, previousTotal = null) {
  const found = [res?.recordsFiltered, res?.recordsTotal, res?.total, res?.filtered, res?.count]
    .find((value) => Number.isFinite(Number(value)));
  if (found !== undefined) return Number(found);
  if (dataLength === 0) return 0;
  return Number.isFinite(Number(previousTotal)) ? Number(previousTotal) : null;
}

function archiveId(archive) {
  return String(archive?.arcid || archive?.id || '');
}

function formatBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = n;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : '0';
}

function pairKeysForGroup(group) {
  const ids = group.map(archiveId).filter(Boolean);
  const pairs = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      pairs.push(toPairKey(ids[i], ids[j]));
    }
  }
  return pairs;
}

function groupKey(group) {
  return group.map(archiveId).filter(Boolean).sort().join('|');
}

function groupIds(group) {
  return group.map(archiveId).filter(Boolean);
}

function groupsToIdGroups(groups) {
  return groups.map((group) => groupIds(group)).filter((ids) => ids.length > 1);
}

function filterGroupsByProcessedState(groups, deletedIds, nonDuplicatePairKeys) {
  const keepKeys = new Set(filterDuplicateGroupsForSavedState(
    groupsToIdGroups(groups),
    deletedIds,
    nonDuplicatePairKeys,
  ).map((ids) => ids.sort().join('|')));
  return groups.filter((group) => keepKeys.has(groupKey(group)));
}

function hasSavedDedupeResult() {
  try {
    return !!localStorage.getItem(DEDUPE_SAVED_RESULT_KEY);
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMinionJob(job, onProgress) {
  const jobId = job?.job;
  if (!jobId) return;
  while (true) {
    await delay(MINION_POLL_MS);
    const status = await lrrApi.getMinionStatus(jobId);
    const state = String(status?.state || '').toLowerCase();
    onProgress?.(status);
    if (!state || state === 'finished') return;
    if (state === 'failed' || state === 'error') throw new Error('缩略图生成任务失败');
  }
}

async function loadDeduplicatorThumbnailBlob(id, { delayMs = 25 } = {}) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    if (attempt > 1) await delay(delayMs * attempt);
    const thumb = await lrrApi.getArchiveThumbnail(id);
    if (thumb?.blob) return thumb.blob;
    if (thumb?.status === 202 && thumb.job) {
      await waitForMinionJob(thumb.job);
      continue;
    }
  }
  return null;
}

async function mapWithConcurrency(items, limit, task, onProgress) {
  const results = new Array(items.length);
  let index = 0;
  let done = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      try {
        results[current] = await task(items[current], current);
      } catch {
        results[current] = null;
      } finally {
        done += 1;
        onProgress?.(done, items.length);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function ProgressPanel({ progress, running }) {
  if (!progress) return null;
  const total = Number(progress.total);
  const current = Number(progress.current);
  const hasTotal = Number.isFinite(total) && total > 0;
  const percent = hasTotal ? Math.max(0, Math.min(100, current / total * 100)) : (running ? 42 : 100);
  const showPercent = hasTotal && progress.label !== '检测失败';
  const statusText = progress.label === '检测失败' ? '失败' : (running ? '处理中' : '已完成');
  return (
    <div className="glass-panel" style={{ padding: '18px', marginBottom: '16px', borderRadius: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '18px', alignItems: 'flex-start', marginBottom: '14px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 850, fontSize: '16px', lineHeight: 1.35 }}>{progress.label}</div>
          {progress.detail && (
            <div style={{ marginTop: '5px', color: 'var(--text-sub)', fontSize: '13px', lineHeight: 1.55 }}>
              {progress.detail}
            </div>
          )}
        </div>
        <div style={{
          minWidth: '88px',
          padding: '7px 10px',
          borderRadius: '10px',
          border: '1px solid var(--glass-border)',
          background: 'rgba(255,255,255,0.035)',
          color: 'var(--text-main)',
          fontSize: '13px',
          fontWeight: 750,
          textAlign: 'center',
        }}>
          {showPercent ? `${Math.floor(percent)}%` : statusText}
        </div>
      </div>
      <div style={{
        height: '12px',
        borderRadius: '999px',
        background: 'rgba(148,163,184,0.16)',
        overflow: 'hidden',
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.28)',
      }}>
        <div
          className={hasTotal ? undefined : 'shimmer-strip'}
          style={{
            width: `${percent}%`,
            minWidth: running ? '36px' : 0,
            height: '100%',
            borderRadius: '999px',
            background: hasTotal ? 'linear-gradient(90deg, var(--accent), var(--accent-strong))' : undefined,
            transition: 'width 160ms ease',
          }}
        />
      </div>
    </div>
  );
}

function StatsPanel({ stats, ignoredCount }) {
  if (!stats) return null;
  const items = [
    ['全部归档', stats.totalArchiveCount ?? stats.archiveCount],
    ['范围内', stats.archiveCount],
    ['范围外', stats.outOfRange ?? 0],
    ['有效封面', stats.signatureCount],
    ['已排除', stats.missing],
    ['疑似重复', stats.pairCount],
    ['已忽略组合', ignoredCount],
  ];
  return (
    <div className="glass-panel" style={{ padding: '14px 16px', marginBottom: '16px', borderRadius: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: '14px' }}>本次扫描</div>
        {stats.missing > 0 && (
          <div style={{ color: 'var(--text-sub)', fontSize: '12px' }}>
            缺失封面的归档已排除，不参与相似度计算
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: '10px' }}>
        {items.map(([label, value]) => (
          <div
            key={label}
            style={{
              padding: '10px 12px',
              borderRadius: '10px',
              border: '1px solid var(--glass-border)',
              background: 'rgba(255,255,255,0.035)',
              minWidth: 0,
            }}
          >
            <div style={{ color: 'var(--text-sub)', fontSize: '12px', lineHeight: 1.3 }}>{label}</div>
            <div style={{ marginTop: '4px', color: 'var(--text-main)', fontWeight: 850, fontSize: '18px', lineHeight: 1.2 }}>
              {formatCount(value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DateRangePanel({ range, running, onChange, onReset }) {
  return (
    <div className="glass-panel" style={{ padding: '14px 16px', marginBottom: '16px', borderRadius: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: '14px' }}>检测时间范围</div>
          <div style={{ marginTop: '4px', color: 'var(--text-sub)', fontSize: '12px', lineHeight: 1.45 }}>
            按归档入库日期筛选，默认范围包含全部归档
          </div>
        </div>
        <button type="button" className="btn" onClick={onReset} disabled={running} style={{ padding: '7px 12px', fontSize: '12px' }}>
          重置为全部
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: '6px', color: 'var(--text-sub)', fontSize: '12px' }}>
          开始日期
          <input
            className="dedupe-date-input"
            type="date"
            value={range.start}
            disabled={running}
            onChange={(event) => onChange({ ...range, start: event.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gap: '6px', color: 'var(--text-sub)', fontSize: '12px' }}>
          结束日期
          <input
            className="dedupe-date-input"
            type="date"
            value={range.end}
            disabled={running}
            onChange={(event) => onChange({ ...range, end: event.target.value })}
          />
        </label>
      </div>
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="glass-panel" style={{
      maxWidth: '620px',
      margin: '44px auto 0',
      padding: '24px',
      borderRadius: '12px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '16px', fontWeight: 850, lineHeight: 1.45 }}>{title}</div>
      {detail && (
        <div style={{ marginTop: '8px', color: 'var(--text-sub)', fontSize: '13px', lineHeight: 1.65 }}>
          {detail}
        </div>
      )}
    </div>
  );
}

export default function DeduplicatePage({ onBack }) {
  const [status, setStatus] = useState('准备检测');
  const [running, setRunning] = useState(false);
  const [archives, setArchives] = useState([]);
  const [groups, setGroups] = useState([]);
  const [ignoredPairs, setIgnoredPairs] = useState(new Set());
  const [selectedArchiveIds, setSelectedArchiveIds] = useState(new Set());
  const [selectedGroupKeys, setSelectedGroupKeys] = useState(new Set());
  const [processedDeletedArchiveIds, setProcessedDeletedArchiveIds] = useState(new Set());
  const [processedNonDuplicatePairKeys, setProcessedNonDuplicatePairKeys] = useState(new Set());
  const [savedResultAvailable, setSavedResultAvailable] = useState(hasSavedDedupeResult);
  const [lastScanStats, setLastScanStats] = useState(null);
  const [workerWarning, setWorkerWarning] = useState('');
  const [progress, setProgress] = useState(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteSyncConfirmed, setDeleteSyncConfirmed] = useState(true);
  const [dateRange, setDateRange] = useState(() => ({
    start: DEDUPE_DEFAULT_START_DATE,
    end: getTodayDateString(),
  }));

  const archiveMap = useMemo(() => new Map(archives.map((archive) => [archiveId(archive), archive])), [archives]);
  const selectedArchives = useMemo(() => (
    Array.from(selectedArchiveIds).map((id) => archiveMap.get(id)).filter(Boolean)
  ), [archiveMap, selectedArchiveIds]);
  const ehFavoriteDeleteSync = getEhFavoriteDeleteSync();

  const loadAllArchives = useCallback(async () => {
    const all = [];
    let start = 0;
    let total = null;
    while (true) {
      setStatus('正在获取归档列表');
      setProgress({
        label: '获取归档列表',
        current: all.length,
        total: Number.isFinite(total) ? total : null,
        detail: Number.isFinite(total) ? `${all.length} / ${total}` : `已获取 ${all.length}`,
      });
      const res = await lrrApi.search('', start, 'date_added', 'desc');
      const data = Array.isArray(res?.data) ? res.data : [];
      all.push(...data);
      total = getSearchTotal(res, data.length, total);
      start += data.length;
      if (data.length < BATCH_SIZE) break;
      if (Number.isFinite(total) && all.length >= total) break;
    }
    return all;
  }, []);

  const resetDateRange = useCallback(() => {
    setDateRange({ start: DEDUPE_DEFAULT_START_DATE, end: getTodayDateString() });
  }, []);

  const runDetection = useCallback(async () => {
    setRunning(true);
    setWorkerWarning('');
    setSelectedArchiveIds(new Set());
    setSelectedGroupKeys(new Set());
    setProcessedDeletedArchiveIds(new Set());
    setProcessedNonDuplicatePairKeys(new Set());
    setGroups([]);
    setLastScanStats(null);

    try {
      let ignored = [];
      let delayedWorkerWarning = '';
      try {
        setStatus('正在读取非重复记录');
        setProgress({ label: '读取非重复记录', current: 0, total: 1, detail: '从 Worker KV 读取已忽略组合' });
        ignored = await getNonDuplicatePairKeys();
      } catch (err) {
        delayedWorkerWarning = '无法读取 Worker 中的非重复记录，本次检测未排除已标记项目。请确认 Worker 已部署新版 /dedupe/non-duplicates 接口。';
      }
      const ignoredSet = new Set(ignored);
      setIgnoredPairs(ignoredSet);

      setStatus('正在生成缩略图');
      setProgress({
        label: '生成缩略图',
        current: 0,
        total: null,
        detail: '调用 LANraragi /api/regen_thumbs，等待后台任务完成',
      });
      const thumbJob = await lrrApi.regenerateThumbnails(false);
      if (!thumbJob?.job) throw new Error('无法启动 LANraragi 缩略图生成任务');
      await waitForMinionJob(thumbJob, (jobStatus) => {
        setProgress({
          label: '生成缩略图',
          current: 0,
          total: null,
          detail: `后台任务 #${thumbJob?.job || ''}：${jobStatus?.state || 'running'}`,
        });
      });

      const allArchives = await loadAllArchives();
      const scanRange = normalizeDedupeDateRange(dateRange.start, dateRange.end, getTodayDateString());
      const scopedArchives = filterArchivesByDateRange(allArchives, scanRange.start, scanRange.end);
      const allArchiveMap = new Map(scopedArchives.map((archive) => [archiveId(archive), archive]));
      const baseStats = {
        archiveCount: scopedArchives.length,
        totalArchiveCount: allArchives.length,
        outOfRange: Math.max(0, allArchives.length - scopedArchives.length),
        dateRange: scanRange,
      };
      setArchives(scopedArchives);
      setDateRange(scanRange);
      setStatus(`正在读取封面 0 / ${scopedArchives.length}`);
      const signatures = new Map();
      let missing = 0;

      await mapWithConcurrency(scopedArchives, THUMBNAIL_CONCURRENCY, async (archive) => {
        const id = archiveId(archive);
        if (!id) return null;
        const blob = await loadDeduplicatorThumbnailBlob(id);
        if (!blob) return null;
        const signature = await createCoverSignature(blob, 8);
        signatures.set(id, signature);
        return signature;
      }, (done, total) => {
        setStatus('正在读取封面');
        setProgress({
          label: '读取封面',
          current: done,
          total,
          detail: `${done} / ${total}`,
        });
      });

      missing = scopedArchives.length - signatures.size;
      if (signatures.size < 2) {
        setLastScanStats({ ...baseStats, signatureCount: signatures.size, missing, pairCount: 0 });
        setProgress({
          label: '检测完成',
          current: signatures.size,
          total: scopedArchives.length,
          detail: missing > 0
            ? `已排除 ${missing} 个缺失封面的归档；有效封面不足 2 个，无法进行比较`
            : '有效封面不足 2 个，无法进行比较',
        });
        setStatus(missing > 0
          ? `检测完成，已排除 ${missing} 个缺失封面的归档`
          : '检测完成，有效封面不足');
        return;
      }
      setStatus('正在比较封面');
      setProgress({
        label: '比较封面',
        current: 0,
        total: signatures.size,
        detail: missing > 0
          ? `按 LRReader 规则比较缩略图，已排除 ${missing} 个缺失封面的归档`
          : '按 LRReader 规则比较缩略图',
      });
      const pairs = await findDuplicatePairsAsync(signatures, ignoredSet, {
        onProgress: ({ current, total, pairs }) => {
          setStatus('正在比较封面');
          setProgress({
            label: '比较封面',
            current,
            total,
            detail: `${current.toLocaleString()} / ${total.toLocaleString()}，发现 ${pairs.toLocaleString()} 组疑似重复`,
          });
        },
      });
      const groupIds = buildDuplicateGroups(pairs, ignoredSet);
      const nextGroups = filterGroupsByProcessedState(groupIds
        .map((ids) => ids.map((id) => allArchiveMap.get(id)).filter(Boolean))
        .filter((group) => group.length > 1), new Set(), new Set());

      setGroups(nextGroups);
      setLastScanStats({ ...baseStats, signatureCount: signatures.size, missing, pairCount: pairs.length });
      setWorkerWarning(delayedWorkerWarning);
      setProgress({
        label: '检测完成',
        current: 1,
        total: 1,
        detail: [
          nextGroups.length ? `发现 ${nextGroups.length} 组疑似重复` : '未发现疑似重复',
          missing > 0 ? `已排除 ${missing} 个缺失封面的归档` : '',
        ].filter(Boolean).join('，'),
      });
      setStatus(nextGroups.length
        ? `检测完成，发现 ${nextGroups.length} 组疑似重复`
        : '检测完成，未发现疑似重复');
    } catch (err) {
      setStatus(err.message || '检测失败');
      setProgress({ label: '检测失败', current: 0, total: 1, detail: err.message || '检测失败' });
    } finally {
      setRunning(false);
    }
  }, [dateRange.end, dateRange.start, loadAllArchives]);

  const toggleArchiveSelection = useCallback((archive) => {
    const id = archiveId(archive);
    if (!id) return;
    const ownerGroup = groups.find((group) => groupIds(group).includes(id));
    setSelectedArchiveIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (ownerGroup) {
      const key = groupKey(ownerGroup);
      setSelectedGroupKeys((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [groups]);

  const toggleGroupSelection = useCallback((group) => {
    const key = groupKey(group);
    const ids = new Set(groupIds(group));
    setSelectedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSelectedArchiveIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const smartSelect = useCallback(() => {
    const ids = new Set();
    groups.forEach((group) => {
      selectDuplicateDeletionIds(group).forEach((id) => ids.add(id));
    });
    setSelectedArchiveIds(ids);
    setSelectedGroupKeys(new Set());
  }, [groups]);

  const syncEhFavoriteBeforeDelete = useCallback(async (archive, confirmationEnabled) => {
    if (!shouldSyncEhFavorite(ehFavoriteDeleteSync, confirmationEnabled)) return;
    const id = archiveId(archive);
    let galleryUrl = extractEhGalleryUrl(archive);
    if (!galleryUrl && id) {
      try {
        const metadata = await lrrApi.getArchive(id);
        galleryUrl = extractEhGalleryUrl({ ...archive, ...metadata });
      } catch {}
    }
    if (!galleryUrl) return;
    await removeEhFavorite({
      galleryUrl,
      cookie: getEhCookie(),
      workerUrl: getWorkerUrl(),
      token: getSyncToken(),
    });
  }, [ehFavoriteDeleteSync]);

  const requestDeleteSelectedArchives = useCallback(() => {
    setDeleteSyncConfirmed(true);
    setDeletePending(true);
  }, []);

  const deleteSelectedArchives = useCallback(async () => {
    if (selectedArchives.length === 0) return;

    setRunning(true);
    const deleted = [];
    const failures = [];
    for (const archive of selectedArchives) {
      const id = archiveId(archive);
      setStatus(`正在删除 ${archive.title || id}`);
      try {
        await syncEhFavoriteBeforeDelete(archive, deleteSyncConfirmed);
        await lrrApi.deleteArchive(id);
        deleted.push(id);
      } catch (err) {
        failures.push(`${archive.title || id}: ${err.message || '删除失败'}`);
      }
    }

    const deletedSet = new Set(deleted);
    setArchives((prev) => prev.filter((archive) => !deletedSet.has(archiveId(archive))));
    setGroups((prev) => prev
      .map((group) => group.filter((archive) => !deletedSet.has(archiveId(archive))))
      .filter((group) => group.length > 1));
    setProcessedDeletedArchiveIds((prev) => new Set([...prev, ...deleted]));
    setSelectedArchiveIds(new Set());
    setSelectedGroupKeys(new Set());
    setDeletePending(false);
    setRunning(false);
    setStatus(failures.length ? `已删除 ${deleted.length} 个，${failures.length} 个失败` : `已删除 ${deleted.length} 个归档`);
    if (failures.length) alert(failures.slice(0, 5).join('\n') + (failures.length > 5 ? '\n...' : ''));
  }, [deleteSyncConfirmed, selectedArchives, syncEhFavoriteBeforeDelete]);

  const markSelectedGroups = useCallback(async () => {
    const selectedGroups = groups.filter((group) => selectedGroupKeys.has(groupKey(group)));
    if (selectedGroups.length === 0) return;
    const pairs = selectedGroups.flatMap(pairKeysForGroup);
    try {
      setRunning(true);
      setStatus('正在写入非重复记录');
      await markNonDuplicatePairs(pairs);
      const pairSet = new Set([...ignoredPairs, ...pairs]);
      setIgnoredPairs(pairSet);
      setProcessedNonDuplicatePairKeys((prev) => new Set([...prev, ...pairs]));
      const selectedKeys = new Set(selectedGroups.map(groupKey));
      setGroups((prev) => prev.filter((group) => !selectedKeys.has(groupKey(group))));
      setSelectedGroupKeys(new Set());
      setSelectedArchiveIds(new Set());
      setStatus(`已标记 ${selectedGroups.length} 组为不重复`);
    } catch (err) {
      alert(err.message || '标记失败，请检查 Worker 与访问 Token');
      setStatus('标记失败');
    } finally {
      setRunning(false);
    }
  }, [groups, ignoredPairs, selectedGroupKeys]);

  const saveResult = useCallback(() => {
    const selectedVisibleGroupKeys = new Set(groups.map(groupKey));
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      dateRange,
      status,
      archives,
      groups: groupsToIdGroups(groups),
      lastScanStats,
      workerWarning,
      selectedArchiveIds: Array.from(selectedArchiveIds),
      selectedGroupKeys: Array.from(selectedGroupKeys).filter((key) => selectedVisibleGroupKeys.has(key)),
      processedDeletedArchiveIds: Array.from(processedDeletedArchiveIds),
      processedNonDuplicatePairKeys: Array.from(processedNonDuplicatePairKeys),
      ignoredPairs: Array.from(ignoredPairs),
    };
    try {
      localStorage.setItem(DEDUPE_SAVED_RESULT_KEY, JSON.stringify(payload));
      setSavedResultAvailable(true);
      setStatus('已保存筛选结果');
    } catch (err) {
      alert(err.message || '保存失败，浏览器存储空间可能不足');
    }
  }, [
    archives,
    dateRange,
    groups,
    ignoredPairs,
    lastScanStats,
    processedDeletedArchiveIds,
    processedNonDuplicatePairKeys,
    selectedArchiveIds,
    selectedGroupKeys,
    status,
    workerWarning,
  ]);

  const loadSavedResult = useCallback(() => {
    try {
      const raw = localStorage.getItem(DEDUPE_SAVED_RESULT_KEY);
      if (!raw) {
        setSavedResultAvailable(false);
        return;
      }
      const payload = JSON.parse(raw);
      const nextArchives = Array.isArray(payload.archives) ? payload.archives : [];
      const archiveById = new Map(nextArchives.map((archive) => [archiveId(archive), archive]));
      const deletedSet = new Set(payload.processedDeletedArchiveIds || []);
      const nonDuplicateSet = new Set(payload.processedNonDuplicatePairKeys || []);
      const restoredGroups = filterGroupsByProcessedState(
        (payload.groups || [])
          .map((ids) => (ids || []).map((id) => archiveById.get(String(id))).filter(Boolean))
          .filter((group) => group.length > 1),
        deletedSet,
        nonDuplicateSet,
      );
      const visibleArchiveIds = new Set(restoredGroups.flatMap(groupIds));
      const visibleGroupKeys = new Set(restoredGroups.map(groupKey));
      setArchives(nextArchives.filter((archive) => !deletedSet.has(archiveId(archive))));
      setGroups(restoredGroups);
      setSelectedArchiveIds(new Set((payload.selectedArchiveIds || []).filter((id) => visibleArchiveIds.has(id))));
      setSelectedGroupKeys(new Set((payload.selectedGroupKeys || []).filter((key) => visibleGroupKeys.has(key))));
      setProcessedDeletedArchiveIds(deletedSet);
      setProcessedNonDuplicatePairKeys(nonDuplicateSet);
      setIgnoredPairs(new Set(payload.ignoredPairs || []));
      setDateRange(normalizeDedupeDateRange(payload.dateRange?.start, payload.dateRange?.end, getTodayDateString()));
      setLastScanStats(payload.lastScanStats || null);
      setWorkerWarning(payload.workerWarning || '');
      setProgress(null);
      setSavedResultAvailable(true);
      setStatus(payload.status || '已载入保存结果');
    } catch (err) {
      alert(err.message || '载入保存结果失败');
    }
  }, []);

  const deleteSavedResult = useCallback(() => {
    try {
      localStorage.removeItem(DEDUPE_SAVED_RESULT_KEY);
      setSavedResultAvailable(false);
      setStatus('已删除保存结果');
    } catch (err) {
      alert(err.message || '删除保存结果失败');
    }
  }, []);

  const allGroupsSelected = groups.length > 0 && selectedGroupKeys.size === groups.length;

  return (
    <div style={{ minHeight: '100vh', padding: '22px', maxWidth: '1320px', margin: '0 auto' }}>
      <header style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', lineHeight: 1.2 }}>重复归档检测</h1>
          <div style={{ color: 'var(--text-sub)', fontSize: '13px', marginTop: '6px' }}>{status}</div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={onBack} disabled={running}>返回</button>
          <button type="button" className="btn" onClick={runDetection} disabled={running}>{running ? '处理中...' : '开始检测'}</button>
          <button type="button" className="btn" onClick={smartSelect} disabled={running || groups.length === 0}>智能选择</button>
          <button type="button" className="btn" onClick={requestDeleteSelectedArchives} disabled={running || selectedArchiveIds.size === 0}>删除选中 ({selectedArchiveIds.size})</button>
          <button type="button" className="btn" onClick={markSelectedGroups} disabled={running || selectedGroupKeys.size === 0}>标记分组不重复 ({selectedGroupKeys.size})</button>
          <button type="button" className="btn" onClick={saveResult} disabled={running || (!lastScanStats && groups.length === 0)}>保存结果</button>
          <button type="button" className="btn" onClick={loadSavedResult} disabled={running || !savedResultAvailable}>载入保存</button>
          <button type="button" className="btn" onClick={deleteSavedResult} disabled={running || !savedResultAvailable}>删除保存</button>
        </div>
      </header>

      <DateRangePanel
        range={dateRange}
        running={running}
        onChange={setDateRange}
        onReset={resetDateRange}
      />

      <ProgressPanel progress={progress} running={running} />

      {!running && workerWarning && (
        <div className="glass-panel" style={{ padding: '12px 14px', marginBottom: '16px', borderColor: 'rgba(251,191,36,0.45)', color: '#fbbf24', fontSize: '13px' }}>
          {workerWarning}
        </div>
      )}

      <StatsPanel stats={lastScanStats} ignoredCount={ignoredPairs.size} />

      {groups.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', color: 'var(--text-sub)', fontSize: '13px' }}>
          <input
            type="checkbox"
            checked={allGroupsSelected}
            onChange={() => {
              setSelectedGroupKeys(allGroupsSelected ? new Set() : new Set(groups.map(groupKey)));
              setSelectedArchiveIds(new Set());
            }}
          />
          <span>选择全部分组标记为不重复</span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
        {groups.map((group, groupIndex) => (
          <section
            key={groupKey(group)}
            onClick={() => toggleGroupSelection(group)}
            style={{
              position: 'relative',
              border: selectedGroupKeys.has(groupKey(group))
                ? '1px solid rgba(251,191,36,0.72)'
                : '1px solid var(--glass-border)',
              borderRadius: '14px',
              padding: '26px 16px 18px',
              background: selectedGroupKeys.has(groupKey(group))
                ? 'rgba(251,191,36,0.08)'
                : 'rgba(255,255,255,0.025)',
              cursor: 'pointer',
              boxShadow: selectedGroupKeys.has(groupKey(group))
                ? '0 12px 34px rgba(251,191,36,0.08)'
                : 'none',
            }}
          >
            <div style={{
              position: 'absolute',
              top: '-12px',
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '4px 14px',
              borderRadius: '999px',
              border: '1px solid var(--glass-border)',
              background: 'var(--dropdown-bg)',
              color: selectedGroupKeys.has(groupKey(group)) ? '#fbbf24' : 'var(--text-main)',
              fontWeight: 850,
              fontSize: '13px',
              whiteSpace: 'nowrap',
              boxShadow: 'var(--shadow)',
            }}>
              疑似重复 {groupIndex + 1}
            </div>
            {selectedGroupKeys.has(groupKey(group)) && (
              <div style={{ textAlign: 'center', color: '#fbbf24', fontSize: '12px', marginBottom: '12px', fontWeight: 700 }}>
                已选择整组标记为不重复
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '18px', justifyItems: 'center' }}>
              {group.map((archive) => {
                const id = archiveId(archive);
                return (
                  <div
                    key={id}
                    onClick={(event) => event.stopPropagation()}
                    style={{ display: 'grid', justifyItems: 'center', gap: '8px' }}
                  >
                    <ArchiveCard
                      archive={archive}
                      onClick={() => toggleArchiveSelection(archive)}
                      noCrop
                      selectionMode
                      selected={selectedArchiveIds.has(id)}
                      onSelectToggle={toggleArchiveSelection}
                      overlay={selectedArchiveIds.has(id) ? (
                        <div style={{
                          position: 'absolute',
                          top: '-8px',
                          right: '-8px',
                          zIndex: 3,
                          width: '26px',
                          height: '26px',
                          borderRadius: '50%',
                          background: 'var(--accent)',
                          color: '#fff',
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 800,
                          boxShadow: '0 8px 18px rgba(0,0,0,0.3)',
                        }}>
                          ✓
                        </div>
                      ) : null}
                    />
                    <div style={{
                      minHeight: '18px',
                      padding: '3px 8px',
                      borderRadius: '999px',
                      border: '1px solid var(--glass-border)',
                      background: 'rgba(255,255,255,0.035)',
                      color: 'var(--text-sub)',
                      fontSize: '12px',
                      lineHeight: 1.2,
                    }}>
                      {formatBytes(archive.size) || '体积未知'}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {!running && groups.length === 0 && !lastScanStats && (
        <EmptyState
          title="等待检测"
          detail="点击“开始检测”后会读取归档封面，按 LRReader 的缩略图相似度规则查找疑似重复。"
        />
      )}
      {!running && groups.length === 0 && lastScanStats && (
        <EmptyState
          title={lastScanStats.signatureCount < 2 ? '有效封面不足' : '本次检测未发现疑似重复'}
          detail={lastScanStats.missing > 0
            ? `已排除 ${formatCount(lastScanStats.missing)} 个缺失封面的归档。其余有效封面已完成比较。`
            : '所有有效封面已完成比较。'}
        />
      )}
      <ConfirmDialog
        open={deletePending}
        title="确认批量删除归档"
        message={`将从 LANraragi 中删除选中的 ${selectedArchives.length} 个归档。此操作不可撤销。`}
        confirmLabel={running ? '删除中...' : '确认删除'}
        cancelLabel="取消"
        onConfirm={deleteSelectedArchives}
        onCancel={() => { if (!running) setDeletePending(false); }}
        confirmDisabled={running}
      >
        {ehFavoriteDeleteSync && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '13px', color: 'var(--text-main)' }}>
            <input
              type="checkbox"
              checked={deleteSyncConfirmed}
              onChange={(event) => setDeleteSyncConfirmed(event.target.checked)}
              disabled={running}
            />
            <span>同时从 EH/EX 收藏夹移除</span>
          </label>
        )}
      </ConfirmDialog>
    </div>
  );
}
