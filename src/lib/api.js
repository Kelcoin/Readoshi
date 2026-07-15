const getBaseUrl = () => {
  return (localStorage.getItem('lrr_server_url') || '').replace(/\/$/, '');
};

const encodeKey = () => {
  const key = localStorage.getItem('lrr_api_key') || '';
  return btoa(key);
};

const getAuthHeaders = () => ({ Authorization: `Bearer ${encodeKey()}` });

const getApiUrl = (endpoint) => {
  const base = getBaseUrl();
  if (!base) throw new Error('未配置服务器地址');
  return `${base}/api${endpoint}`;
};

function createApiError(status, message) {
  const err = new Error(message || `API Error: ${status}`);
  err.status = status;
  return err;
}

async function readResponse(res) {
  if (!res.ok) {
    if (res.status === 401) throw createApiError(res.status, 'API Error: 401 (API Key 错误或未授权)');
    let message = '';
    try { message = await res.text(); } catch {}
    throw createApiError(res.status, message || `API Error: ${res.status}`);
  }

  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const request = async (endpoint, method = 'GET', body = null, options = {}) => {
  const base = getBaseUrl();
  if (!base) throw new Error('未配置服务器地址');

  const headers = getAuthHeaders();
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${base}/api${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
    signal: options.signal,
  });

  return readResponse(res);
};

export function normalizeUntaggedArchiveIds(response) {
  const items = Array.isArray(response)
    ? response
    : (Array.isArray(response?.data)
      ? response.data
      : (Array.isArray(response?.archives) ? response.archives : response?.ids));
  return (Array.isArray(items) ? items : [])
    .map((item) => (typeof item === 'string' ? item : (item?.arcid || item?.id)))
    .filter(Boolean);
}

export async function loadArchiveMetadataBatch(ids, loadArchive, { concurrency = 6, signal, ignoreMissing = false } = {}) {
  const archiveIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (archiveIds.length === 0) return [];
  const results = new Array(archiveIds.length);
  let cursor = 0;
  const workerCount = Math.min(archiveIds.length, Math.max(1, Math.floor(Number(concurrency) || 1)));
  const abortError = () => {
    if (signal?.reason) return signal.reason;
    const error = new Error('Archive metadata request aborted');
    error.name = 'AbortError';
    return error;
  };
  const worker = async () => {
    while (cursor < archiveIds.length) {
      if (signal?.aborted) throw abortError();
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await loadArchive(archiveIds[index]);
      } catch (error) {
        if (ignoreMissing && (error?.status === 400 || error?.status === 404)) continue;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results.filter((item) => item !== undefined);
}

export const lrrApi = {
  search: (filter = '', start = 0, sortby = 'date_added', order = 'desc', options = {}) =>
    request(`/search?filter=${encodeURIComponent(filter)}&start=${start}&sortby=${sortby}&order=${order}`, 'GET', null, options),
  clearSearchCache: () => request('/search/cache', 'DELETE'),

  getRandom: (count = 10, options = {}) => request(`/search/random?count=${count}`, 'GET', null, options),
  getUntaggedArchives: async (options = {}) => normalizeUntaggedArchiveIds(await request('/archives/untagged', 'GET', null, options)),
  getArchive: (id, options = {}) => request(`/archives/${id}/metadata`, 'GET', null, options),
  updateArchiveMetadata: (id, { title = '', tags = '', summary = '' }) => {
    const params = new URLSearchParams({ title, tags, summary });
    return request(`/archives/${encodeURIComponent(id)}/metadata?${params}`, 'PUT');
  },
  getMetadataPlugins: () => request('/plugins/metadata'),
  getDownloadPlugins: () => request('/plugins/download'),
  useMetadataPlugin: (id, plugin, arg = '') => {
    const params = new URLSearchParams({ id, plugin, arg });
    return request(`/plugins/use?${params}`, 'POST');
  },
  useDownloadPlugin: (plugin, arg) => {
    const params = new URLSearchParams({ plugin, arg });
    return request(`/plugins/use?${params}`, 'POST');
  },
  uploadArchive: async (file) => {
    const body = new FormData();
    body.append('file', file, file.name);
    const res = await fetch(getApiUrl('/archives/upload'), {
      method: 'PUT',
      headers: getAuthHeaders(),
      body,
    });
    return readResponse(res);
  },
  getArchiveFiles: (id, options = {}) => request(`/archives/${id}/files`, 'GET', null, options),
  deleteArchive: (id) => request(`/archives/${encodeURIComponent(id)}`, 'DELETE'),
  setArchiveThumbnail: (id, page) =>
    request(`/archives/${encodeURIComponent(id)}/thumbnail?page=${encodeURIComponent(page)}`, 'PUT'),
  downloadArchive: async (id) => {
    const res = await fetch(getApiUrl(`/archives/${encodeURIComponent(id)}/download`), {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      if (res.status === 401) throw createApiError(res.status, 'API Error: 401 (API Key 错误或未授权)');
      throw createApiError(res.status, `API Error: ${res.status}`);
    }
    const disposition = res.headers.get('Content-Disposition') || '';
    const filenameMatch = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i);
    const filename = filenameMatch
      ? decodeURIComponent((filenameMatch[1] || filenameMatch[2] || '').trim())
      : `${id}.zip`;
    return { blob: await res.blob(), filename };
  },
  getArchiveThumbnail: async (id, { page = null, noFallback = false } = {}) => {
    const base = getBaseUrl();
    if (!base) throw new Error('未配置服务器地址');

    const params = new URLSearchParams();
    if (page !== undefined && page !== null) params.set('page', String(page));
    if (noFallback) params.set('no_fallback', 'true');

    const query = params.toString();
    const res = await fetch(`${base}/api/archives/${encodeURIComponent(id)}/thumbnail${query ? `?${query}` : ''}`, {
      headers: getAuthHeaders(),
    });

    if (res.status === 202) {
      let job = null;
      try { job = await res.json(); } catch {}
      return { status: 202, blob: null, job };
    }
    if (!res.ok) {
      if (res.status === 401) throw createApiError(res.status, 'API Error: 401 (API Key 错误或未授权)');
      throw createApiError(res.status, `API Error: ${res.status}`);
    }
    return { status: res.status, blob: await res.blob() };
  },
  regenerateThumbnails: (force = false) => request(`/regen_thumbs?force=${force ? 1 : 0}`, 'POST'),
  getMinionStatus: (job) => request(`/minion/${encodeURIComponent(job)}`),
  queueArchivePageThumbnails: (id, force = false) =>
    request(`/archives/${id}/files/thumbnails${force ? '?force=true' : ''}`, 'POST'),
  extractArchive: (id, options = {}) => request(`/archives/${id}/extract`, 'POST', null, options),
  clearCache: (id) => request(`/archives/${id}/extract`, 'DELETE'),
  updateProgress: (id, page) => request(`/archives/${id}/progress/${page}`, 'PUT'),
  getCategories: () => request('/categories'),
  getServerInfo: () => request('/info'),
};

export const checkServerStatus = async (url, key) => {
  const base = (url || '').replace(/\/$/, '');
  if (!base) throw new Error('未配置服务器地址');

  const headers = {};
  if (key) headers['Authorization'] = `Bearer ${btoa(key)}`;

  const res = await fetch(`${base}/api/info`, { headers });
  if (!res.ok) {
    if (res.status === 401) throw new Error('API Key 错误或未授权');
    throw new Error(`服务器返回错误 (${res.status})`);
  }
  return res.json();
};


