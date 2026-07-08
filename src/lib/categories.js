import { lrrApi } from './api';

const CACHE_KEY = 'lrr_categories_cache_v1';
const UPDATE_INTERVAL = 30 * 60 * 1000;

let categoriesCache = null;
let categoriesPromise = null;

function loadFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.t < UPDATE_INTERVAL) return parsed.data;
  } catch {}
  return null;
}

function saveToCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data })); } catch {}
}

export function getCachedCategories() {
  return categoriesCache;
}

async function fetchCategories() {
  try {
    const data = await lrrApi.getCategories();
    if (Array.isArray(data)) return data;
  } catch {}
  return [];
}

export function getStoredCategories() {
  return loadFromCache();
}

export async function loadCategories(options = {}) {
  const { cacheOnly = false } = options;
  const cached = loadFromCache();
  if (cached) {
    categoriesCache = cached;
    return cached;
  }

  if (cacheOnly) return categoriesCache || [];

  if (categoriesPromise) return categoriesPromise;

  categoriesPromise = (async () => {
    try {
      categoriesCache = await fetchCategories();
      if (categoriesCache.length > 0) saveToCache(categoriesCache);
      return categoriesCache;
    } catch {
      return categoriesCache || [];
    } finally {
      categoriesPromise = null;
    }
  })();

  return categoriesPromise;
}

export function clearCategoriesCache() {
  categoriesCache = null;
  try { localStorage.removeItem(CACHE_KEY); } catch {}
}

let updateTimer = null;

export function startCategoriesUpdateTimer() {
  stopCategoriesUpdateTimer();
  const doUpdate = async () => {
    try {
      const data = await fetchCategories();
      if (data.length > 0) {
        categoriesCache = data;
        saveToCache(data);
      }
    } catch {}
    updateTimer = setTimeout(doUpdate, UPDATE_INTERVAL);
  };
  updateTimer = setTimeout(doUpdate, UPDATE_INTERVAL);
}

export function stopCategoriesUpdateTimer() {
  if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
}
