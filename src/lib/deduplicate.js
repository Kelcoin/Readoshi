export function toPairKey(left, right) {
  return [String(left || ''), String(right || '')].sort().join('|');
}

export const DEDUPE_DEFAULT_START_DATE = '2000-01-01';

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

export function getTodayDateString(date = new Date()) {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-');
}

function dateToDayString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-');
}

function parseArchiveDateValue(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000;
    return dateToDayString(new Date(ms));
  }
  const text = String(value).trim();
  if (!text) return '';
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n)) return '';
    const ms = n > 1e12 ? n : n * 1000;
    return dateToDayString(new Date(ms));
  }
  return dateToDayString(new Date(text));
}

export function getArchiveDateDay(archive) {
  const direct = parseArchiveDateValue(archive?.date_added);
  if (direct) return direct;
  const tagMatch = String(archive?.tags || '').match(/(?:^|,\s*)date_added:(\d+)/);
  if (tagMatch) {
    const fromTag = parseArchiveDateValue(tagMatch[1]);
    if (fromTag) return fromTag;
  }
  return DEDUPE_DEFAULT_START_DATE;
}

function getExplicitArchiveDateDay(archive) {
  const direct = parseArchiveDateValue(archive?.date_added);
  if (direct) return direct;
  const tagMatch = String(archive?.tags || '').match(/(?:^|,\s*)date_added:(\d+)/);
  if (!tagMatch) return '';
  return parseArchiveDateValue(tagMatch[1]);
}

export function normalizeDedupeDateRange(start, end, today = getTodayDateString()) {
  let from = /^\d{4}-\d{2}-\d{2}$/.test(String(start || '')) ? String(start) : DEDUPE_DEFAULT_START_DATE;
  let to = /^\d{4}-\d{2}-\d{2}$/.test(String(end || '')) ? String(end) : today;
  if (from > to) [from, to] = [to, from];
  return { start: from, end: to };
}

export function filterArchivesByDateRange(archives, start, end) {
  const range = normalizeDedupeDateRange(start, end);
  if (range.start <= DEDUPE_DEFAULT_START_DATE) return archives || [];
  return (archives || []).filter((archive) => {
    const day = getExplicitArchiveDateDay(archive);
    if (!day) return true;
    return day >= range.start && day <= range.end;
  });
}

export function filterDuplicateGroupsForSavedState(groups, deletedIds = new Set(), nonDuplicatePairKeys = new Set()) {
  return (groups || []).filter((group) => {
    const ids = (group || []).map((id) => String(id || '')).filter(Boolean);
    if (ids.length < 2) return false;
    if (ids.some((id) => deletedIds.has(id))) return false;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        if (nonDuplicatePairKeys.has(toPairKey(ids[i], ids[j]))) return false;
      }
    }
    return true;
  });
}

export function buildDuplicateGroups(pairs, ignoredPairKeys = new Set()) {
  const seen = new Set();
  const groups = [];
  for (const pair of pairs || []) {
    const left = pair?.left;
    const right = pair?.right;
    if (!left || !right) continue;
    const key = toPairKey(left, right);
    if (ignoredPairKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    groups.push(key.split('|'));
  }
  return groups
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function tagSet(archive) {
  return new Set(String(archive?.tags || '')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean));
}

function archiveId(archive) {
  return String(archive?.arcid || archive?.id || '');
}

function archiveSize(archive) {
  const value = archive?.size ?? archive?.filesize ?? archive?.file_size ?? 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function keepScore(archive, index) {
  const tags = tagSet(archive);
  return {
    uncensored: tags.has('other:uncensored') ? 1 : 0,
    noAds: tags.has('other:extraneous ads') ? 0 : 1,
    size: archiveSize(archive),
    index: -index,
  };
}

export function selectDuplicateDeletionIds(archives) {
  const items = (archives || []).filter((archive) => archiveId(archive));
  if (items.length < 2) return [];

  let keepIndex = 0;
  let best = keepScore(items[0], 0);
  for (let i = 1; i < items.length; i += 1) {
    const score = keepScore(items[i], i);
    if (
      score.uncensored > best.uncensored ||
      (score.uncensored === best.uncensored && score.noAds > best.noAds) ||
      (score.uncensored === best.uncensored && score.noAds === best.noAds && score.size > best.size) ||
      (score.uncensored === best.uncensored && score.noAds === best.noAds && score.size === best.size && score.index > best.index)
    ) {
      keepIndex = i;
      best = score;
    }
  }

  return items
    .filter((_, index) => index !== keepIndex)
    .map(archiveId);
}

async function imageFromBlob(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // LANraragi thumbnails may arrive as octet-stream/empty MIME blobs.
      // <img> can still decode those, matching ArchiveCard's display path.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function createCoverSignature(blob, width = 8) {
  const source = await imageFromBlob(blob);
  const sourceWidth = source.width || source.naturalWidth;
  const sourceHeight = source.height || source.naturalHeight;
  if (!sourceWidth || !sourceHeight) throw new Error('封面尺寸无效');

  const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, width, height);
  if (typeof source.close === 'function') source.close();
  return {
    width,
    height,
    ratio: sourceHeight / sourceWidth,
    pixels: ctx.getImageData(0, 0, width, height).data,
  };
}

export function areSignaturesDuplicate(left, right, {
  pixelThreshold = 30,
  percentDifference = 0.2,
  aspectRatioLimit = 0.1,
} = {}) {
  if (!left || !right) return false;
  if (Math.abs(left.ratio - right.ratio) > aspectRatioLimit) return false;

  const width = Math.min(left.width, right.width);
  const height = Math.min(left.height, right.height);
  let differences = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const li = (y * left.width + x) * 4;
      const ri = (y * right.width + x) * 4;
      const diff = Math.abs(left.pixels[li] - right.pixels[ri])
        + Math.abs(left.pixels[li + 1] - right.pixels[ri + 1])
        + Math.abs(left.pixels[li + 2] - right.pixels[ri + 2]);
      if (diff > pixelThreshold) differences += 1;
    }
  }
  return differences / (width * height) < percentDifference;
}

export function findDuplicatePairs(signatures, ignoredPairKeys = new Set(), options = {}) {
  const entries = Array.from(signatures || []).filter(([, signature]) => signature);
  const pairs = [];
  for (let i = 0; i < entries.length; i += 1) {
    const [leftId, leftSignature] = entries[i];
    for (let j = i + 1; j < entries.length; j += 1) {
      const [rightId, rightSignature] = entries[j];
      if (ignoredPairKeys.has(toPairKey(leftId, rightId))) continue;
      if (areSignaturesDuplicate(leftSignature, rightSignature, options)) {
        pairs.push({ left: leftId, right: rightId });
      }
    }
  }
  return pairs;
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function findDuplicatePairsAsync(signatures, ignoredPairKeys = new Set(), options = {}) {
  const aspectRatioLimit = options.aspectRatioLimit ?? 0.1;
  const entries = Array.from(signatures || [])
    .filter(([, signature]) => signature)
    .sort((a, b) => a[1].ratio - b[1].ratio);
  const chunkSize = options.chunkSize || 5000;
  const pairs = [];
  let checked = 0;
  let chunk = 0;

  for (let i = 0; i < entries.length; i += 1) {
    const [leftId, leftSignature] = entries[i];
    for (let j = i + 1; j < entries.length; j += 1) {
      const [rightId, rightSignature] = entries[j];
      if (rightSignature.ratio - leftSignature.ratio > aspectRatioLimit) break;
      checked += 1;
      chunk += 1;
      if (!ignoredPairKeys.has(toPairKey(leftId, rightId)) && areSignaturesDuplicate(leftSignature, rightSignature, options)) {
        pairs.push({ left: leftId, right: rightId });
      }
      if (chunk >= chunkSize) {
        chunk = 0;
        options.onProgress?.({ current: i, total: entries.length, checked, pairs: pairs.length });
        await yieldToBrowser();
      }
    }
    options.onProgress?.({ current: i + 1, total: entries.length, checked, pairs: pairs.length });
  }

  options.onProgress?.({ current: entries.length, total: entries.length, checked, pairs: pairs.length });
  return pairs;
}
