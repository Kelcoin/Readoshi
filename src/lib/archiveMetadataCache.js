import { lrrApi } from './api';

const metadataCache = new Map();
const metadataRequests = new Map();
const HYDRATE_CONCURRENCY = 6;
const METADATA_STORAGE_KEY = 'lrr_archive_metadata_cache_v1';
const METADATA_STORAGE_LIMIT = 300;
let persistTimer = null;

function metadataStorageKey() {
  if (typeof localStorage === 'undefined') return METADATA_STORAGE_KEY;
  return `${METADATA_STORAGE_KEY}:${localStorage.getItem('lrr_server_url') || 'default'}`;
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
    const entries = Array.from(metadataCache.values()).slice(-METADATA_STORAGE_LIMIT);
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
  const id = archiveId(archive);
  if (!id) return null;
  const metadata = { ...archive, id, arcid: id };
  metadataCache.set(id, metadata);
  if (metadataCache.size > METADATA_STORAGE_LIMIT) metadataCache.delete(metadataCache.keys().next().value);
  scheduleMetadataPersist();
  return metadata;
}

export function decorateArchiveRecord(record) {
  const id = archiveId(record);
  if (!id) return null;
  const metadata = metadataCache.get(id);
  if (!metadata) return { ...record, id, arcid: id, title: id, tags: '' };
  return {
    ...metadata,
    ...record,
    id,
    arcid: id,
    title: metadata.title || id,
    tags: metadata.tags || '',
    total: Number(metadata.pagecount) || 0,
  };
}

readPersistedMetadata().forEach((archive) => {
  const id = archiveId(archive);
  if (id) metadataCache.set(id, { ...archive, id, arcid: id });
});

async function fetchArchiveMetadata(id, { force = false } = {}) {
  if (!force && metadataCache.has(id)) return metadataCache.get(id);
  if (metadataRequests.has(id)) return metadataRequests.get(id);
  const request = lrrApi.getArchive(id)
    .then((metadata) => rememberArchiveMetadata({ ...metadata, id, arcid: id }))
    .finally(() => metadataRequests.delete(id));
  metadataRequests.set(id, request);
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
      if (!force && metadataCache.has(id)) {
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
