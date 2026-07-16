import { lrrApi } from './api';
import { getConfigScopeId, migrateLegacyStorageKey } from './configScope';

const CACHE_KEY = 'lrr_categories_cache_v1';
const UPDATE_INTERVAL = 30 * 60 * 1000;

let categoriesCache = null;
let categoriesPromise = null;
let categoriesScope = '';

function cacheKey() {
  return migrateLegacyStorageKey(CACHE_KEY);
}

function ensureCurrentScope() {
  const scope = getConfigScopeId();
  if (scope !== categoriesScope) {
    categoriesScope = scope;
    categoriesCache = null;
    categoriesPromise = null;
  }
}

function loadFromCache() {
  try {
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.t < UPDATE_INTERVAL) return parsed.data;
  } catch {}
  return null;
}

function saveToCache(data) {
  try { localStorage.setItem(cacheKey(), JSON.stringify({ t: Date.now(), data })); } catch {}
}

export function getCachedCategories() {
  ensureCurrentScope();
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
  ensureCurrentScope();
  return loadFromCache();
}

export async function loadCategories(options = {}) {
  ensureCurrentScope();
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
  ensureCurrentScope();
  categoriesCache = null;
  try { localStorage.removeItem(cacheKey()); } catch {}
}

let updateTimer = null;

export function startCategoriesUpdateTimer() {
  ensureCurrentScope();
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
