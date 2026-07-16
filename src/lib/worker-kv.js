import { getSyncToken, getWorkerUrl } from './worker-config';
import { getServerScopeId } from './configScope';

function workerEndpoint(path) {
  const workerUrl = getWorkerUrl();
  if (!workerUrl) throw new Error('未配置 Worker');
  return workerUrl.replace(/\/$/, '') + path;
}

function workerHeaders() {
  const token = getSyncToken();
  if (!token) throw new Error('未配置 Worker 访问 Token');
  const serverScope = getServerScopeId();
  if (!serverScope) throw new Error('未配置 LANraragi 服务器地址');
  return {
    'Content-Type': 'application/json',
    'x-sync-token': token,
    'x-lrr-server-scope': serverScope,
  };
}

async function readJson(res) {
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    throw new Error(data?.detail || data?.error || `Worker Error: ${res.status}`);
  }
  return data;
}

export async function getNonDuplicatePairKeys() {
  const res = await fetch(workerEndpoint('/dedupe/non-duplicates'), {
    headers: workerHeaders(),
  });
  const data = await readJson(res);
  return Array.isArray(data?.pairs) ? data.pairs.map(String).filter(Boolean) : [];
}

export async function markNonDuplicatePairs(pairs) {
  const uniquePairs = Array.from(new Set((pairs || []).map(String).filter(Boolean)));
  if (uniquePairs.length === 0) return { ok: true, count: 0 };
  const res = await fetch(workerEndpoint('/dedupe/non-duplicates'), {
    method: 'PUT',
    headers: workerHeaders(),
    body: JSON.stringify({ pairs: uniquePairs }),
  });
  return readJson(res);
}
