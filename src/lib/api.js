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

  if (!res.ok) {
    if (res.status === 401) throw createApiError(res.status, 'API Error: 401 (API Key 错误或未授权)');
    throw createApiError(res.status, `API Error: ${res.status}`);
  }

  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const lrrApi = {
  search: (filter = '', start = 0, sortby = 'date_added', order = 'desc') =>
    request(`/search?filter=${encodeURIComponent(filter)}&start=${start}&sortby=${sortby}&order=${order}`),
  clearSearchCache: () => request('/search/cache', 'DELETE'),

  getRandom: (count = 10, options = {}) => request(`/search/random?count=${count}`, 'GET', null, options),
  getArchive: (id) => request(`/archives/${id}/metadata`),
  getArchiveFiles: (id) => request(`/archives/${id}/files`),
  deleteArchive: (id) => request(`/archives/${encodeURIComponent(id)}`, 'DELETE'),
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
  getArchiveThumbnail: async (id, { page = 1, noFallback = false } = {}) => {
    const base = getBaseUrl();
    if (!base) throw new Error('未配置服务器地址');

    const params = new URLSearchParams();
    if (page > 0) params.set('page', String(page));
    if (noFallback) params.set('no_fallback', 'true');

    const res = await fetch(`${base}/api/archives/${id}/thumbnail?${params.toString()}`, {
      headers: getAuthHeaders(),
    });

    if (res.status === 202) {
      return { status: 202, blob: null };
    }
    if (!res.ok) {
      if (res.status === 401) throw createApiError(res.status, 'API Error: 401 (API Key 错误或未授权)');
      throw createApiError(res.status, `API Error: ${res.status}`);
    }
    return { status: res.status, blob: await res.blob() };
  },
  queueArchivePageThumbnails: (id, force = false) =>
    request(`/archives/${id}/files/thumbnails${force ? '?force=true' : ''}`, 'POST'),
  extractArchive: (id) => request(`/archives/${id}/extract`, 'POST'),
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


