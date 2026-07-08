export function diagLog() {}

function getHeaderValue(headers, name) {
  if (!headers || !name) return '';
  const lowerName = name.toLowerCase();
  try {
    if (headers instanceof Headers) {
      return headers.get(name) || '';
    }
    if (Array.isArray(headers)) {
      const found = headers.find(([key]) => String(key).toLowerCase() === lowerName);
      return found ? String(found[1] || '') : '';
    }
    if (typeof headers === 'object') {
      const found = Object.entries(headers).find(([key]) => key.toLowerCase() === lowerName);
      return found ? String(found[1] || '') : '';
    }
  } catch {}
  return '';
}

function installFetchGuard() {
  if (typeof window === 'undefined' || window.__lrrDiagFetchInstalled) return;
  window.__lrrDiagFetchInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const input = args[0];
    const init = args[1] || {};
    const url = typeof input === 'string' ? input : input?.url || '';

    if (!url || url.startsWith('blob:') || url.startsWith('data:') || url.includes('/__lrr_cache__/')) {
      return originalFetch(...args);
    }

    let normalizedUrl = url;
    try {
      normalizedUrl = new URL(url, window.location.href).toString();
    } catch {}

    const method = init.method || input?.method || 'GET';
    const isRootPing = method === 'GET' && normalizedUrl === `${window.location.origin}/`;
    const acceptHeader = getHeaderValue(init.headers || input?.headers, 'accept');
    const isVitePing = isRootPing && acceptHeader.includes('text/x-vite-ping');

    if (
      import.meta.env.DEV &&
      isVitePing &&
      document.visibilityState === 'visible' &&
      Number(window.__lrrBlockViteResumeReloadUntil || 0) > Date.now()
    ) {
      throw new TypeError('Failed to fetch');
    }

    return originalFetch(...args);
  };
}

function installVisibilityGuard() {
  if (typeof window === 'undefined' || window.__lrrDiagLifecycleInstalled) return;
  window.__lrrDiagLifecycleInstalled = true;

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      window.__lrrBlockViteResumeReloadUntil = Date.now() + 10 * 60 * 1000;
    }
  };

  document.addEventListener('visibilitychange', onVisibility);
}

export function installDiagnostics() {
  if (typeof window === 'undefined' || window.__lrrDiagInstalled) return;
  window.__lrrDiagInstalled = true;

  installFetchGuard();
  installVisibilityGuard();
}
