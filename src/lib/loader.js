function promisePool(tasks, concurrency = 6) {
  const results = new Array(tasks.length);
  let idx = 0;
  let done = 0;

  return new Promise((resolve) => {
    const run = async () => {
      while (idx < tasks.length) {
        const i = idx++;
        try { results[i] = await tasks[i](); } catch (e) { results[i] = e; }
        done++;
        if (done === tasks.length) resolve(results);
      }
    };

    const limit = Math.min(concurrency, tasks.length);
    for (let i = 0; i < limit; i++) run();
    if (tasks.length === 0) resolve([]);
  });
}

export const loadViaPool = async (urls, fetchOptions, concurrency = 6) => {
  const tasks = urls.map((url) => async () => {
    const key = localStorage.getItem('lrr_api_key') || '';
    const headers = { ...(fetchOptions?.headers || {}) };
    if (key) headers['Authorization'] = `Bearer ${btoa(key)}`;

    const res = await fetch(url, { ...fetchOptions, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  });
  return promisePool(tasks, concurrency);
};

export const loadImagesAsUrls = async (urls, fetchOptions, concurrency = 6) => {
  const blobs = await loadViaPool(urls, fetchOptions, concurrency);
  return blobs.map((b) => {
    if (b instanceof Error) return null;
    return URL.createObjectURL(b);
  });
};
