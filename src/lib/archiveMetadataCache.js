import { lrrApi } from './api';
import { getConfigScopeId, migrateLegacyStorageKey } from './configScope';

const metadataCache = new Map();
const metadataRequests = new Map();
const HYDRATE_CONCURRENCY = 6;
const METADATA_STORAGE_KEY = 'lrr_archive_metadata_cache_v1';
const METADATA_STORAGE_LIMIT = 300;
let persistTimer = null;

function metadataStorageKey() {
  return migrateLegacyStorageKey(METADATA_STORAGE_KEY);
}

function scopedArchiveKey(id, scope = getConfigScopeId()) {
  return `${scope}:${id}`;
}

function readPersistedMetadata() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(metadataStorageKey()) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function persistMetadataCache() {
  if (typeof localStorage === 'undefined') return;
  try {
    const scopePrefix = `${getConfigScopeId()}:`;
    const entries = Array.from(metadataCache.entries())
      .filter(([key]) => key.startsWith(scopePrefix))
      .map(([, value]) => value)
      .slice(-METADATA_STORAGE_LIMIT);
    localStorage.setItem(metadataStorageKey(), JSON.stringify(entries));
  } catch {}
}

function scheduleMetadataPersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistMetadataCache();
  }, 80);
}

function archiveId(value) {
  return String(value?.id || value?.arcid || '').trim();
}

function isMissingArchiveError(error) {
  return error?.status === 400 || error?.status === 404;
}

export function rememberArchiveMetadata(archive) {
  return rememberArchiveMetadataForScope(archive, getConfigScopeId());
}

function rememberArchiveMetadataForScope(archive, scope) {
  const id = archiveId(archive);
  if (!id) return null;
  const metadata = { ...archive, id, arcid: id };
  metadataCache.set(scopedArchiveKey(id, scope), metadata);
  if (metadataCache.size > METADATA_STORAGE_LIMIT) metadataCache.delete(metadataCache.keys().next().value);
  scheduleMetadataPersist();
  return metadata;
}

export function decorateArchiveRecord(record) {
  const id = archiveId(record);
  if (!id) return null;
  const progress = Number(record.page) || 0;
  const metadata = metadataCache.get(scopedArchiveKey(id));
  if (!metadata) return { ...record, id, arcid: id, title: id, tags: '', progress };
  return {
    ...metadata,
    ...record,
    id,
    arcid: id,
    title: metadata.title || id,
    tags: metadata.tags || '',
    total: Number(metadata.pagecount) || 0,
    progress: Number(record.page) || 0,
  };
}

readPersistedMetadata().forEach((archive) => {
  const id = archiveId(archive);
  if (id) metadataCache.set(scopedArchiveKey(id), { ...archive, id, arcid: id });
});

async function fetchArchiveMetadata(id, { force = false } = {}) {
  const requestScope = getConfigScopeId();
  const cacheKey = scopedArchiveKey(id, requestScope);
  if (!force && metadataCache.has(cacheKey)) return metadataCache.get(cacheKey);
  if (metadataRequests.has(cacheKey)) return metadataRequests.get(cacheKey);
  const request = lrrApi.getArchive(id)
    .then((metadata) => rememberArchiveMetadataForScope({ ...metadata, id, arcid: id }, requestScope))
    .finally(() => metadataRequests.delete(cacheKey));
  metadataRequests.set(cacheKey, request);
  return request;
}

export async function hydrateArchiveRecords(records, { force = false } = {}) {
  const source = (Array.isArray(records) ? records : []).filter((item) => archiveId(item));
  const missingIds = [];
  const hydrated = new Map();

  for (let index = 0; index < source.length; index += HYDRATE_CONCURRENCY) {
    const batch = source.slice(index, index + HYDRATE_CONCURRENCY);
    await Promise.all(batch.map(async (record) => {
      const id = archiveId(record);
      if (!force && metadataCache.has(scopedArchiveKey(id))) {
        hydrated.set(id, decorateArchiveRecord(record));
        return;
      }
      try {
        await fetchArchiveMetadata(id, { force });
        hydrated.set(id, decorateArchiveRecord(record));
      } catch (error) {
        if (isMissingArchiveError(error)) missingIds.push(id);
        else hydrated.set(id, decorateArchiveRecord(record));
      }
    }));
  }

  return {
    items: source.map((record) => hydrated.get(archiveId(record))).filter(Boolean),
    missingIds: Array.from(new Set(missingIds)),
  };
}
