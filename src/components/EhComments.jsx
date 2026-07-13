import React, { useState, useRef, useEffect, useCallback } from 'react';

const commentsCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;
const EMPTY_API_DATA = Object.freeze({ apiuid: null, apikey: null, gid: null, token: null, apiUrl: 'https://api.e-hentai.org/api.php' });

const VoteIcon = ({ direction, active = false }) => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="currentColor"
    style={{ display: 'block' }}
  >
    {direction === 'up'
      ? <path d="M8 3L13 11H3L8 3Z" opacity={active ? 1 : 0.96} />
      : <path d="M8 13L3 5H13L8 13Z" opacity={active ? 1 : 0.96} />}
  </svg>
);

function formatTimeCN(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

function getSafeCookie(raw) {
  let c = (raw || '').trim();
  if (!c) return '';
  if (!c.endsWith(';')) c += ';';
  if (!c.includes('nw=1')) c += ' nw=1;';
  return c;
}

function extractApiData(htmlText) {
  const apiuidMatch = htmlText.match(/var\s+apiuid\s*=\s*(\d+)/);
  const apikeyMatch = htmlText.match(/var\s+apikey\s*=\s*["']([^"']+)["']/);
  const gidMatch = htmlText.match(/var\s+gid\s*=\s*(\d+)/);
  const tokenMatch = htmlText.match(/var\s+token\s*=\s*["']([^"']+)["']/);
  const apiUrlMatch = htmlText.match(/var\s+api_url\s*=\s*["']([^"']+)["']/);

  return {
    apiuid: apiuidMatch ? parseInt(apiuidMatch[1]) : null,
    apikey: apikeyMatch ? apikeyMatch[1] : null,
    gid: gidMatch ? parseInt(gidMatch[1]) : null,
    token: tokenMatch ? tokenMatch[1] : null,
    apiUrl: apiUrlMatch ? apiUrlMatch[1] : 'https://api.e-hentai.org/api.php'
  };
}

function hasVotingApiData(value) {
  return !!(value?.apiuid && value?.apikey && value?.gid && value?.token);
}

function parseEHCommentsFromDOM(htmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');

  if (doc.querySelector('h1')?.textContent.includes('Content Warning')) {
    return { comments: [], contentWarning: true, apiData: null };
  }

  const commentDivs = doc.querySelectorAll('#cdiv .c1');
  const comments = [];

  commentDivs.forEach(el => {
    try {
      let commentId = 0;
      const idAnchor = el.previousElementSibling;
      if (idAnchor && idAnchor.name && idAnchor.name.startsWith('c')) commentId = parseInt(idAnchor.name.substring(1)) || 0;
      else {
        const c6 = el.querySelector('.c6');
        if (c6 && c6.id && c6.id.startsWith('comment_')) commentId = parseInt(c6.id.substring(8)) || 0;
      }

      const editLink = el.querySelector('.c4 a[onclick*="edit_comment"]');
      const isEditable = !!editLink;

      const voteUpLink = el.querySelector('.c4 a[id^="comment_vote_up"]');
      const voteDownLink = el.querySelector('.c4 a[id^="comment_vote_down"]');
      let myVote = 0;

      const hasStyle = (link) => {
        if (!link) return false;
        const s = link.getAttribute('style');
        return s && (s.includes('color') || s.includes('font-weight'));
      };

      if (voteUpLink && hasStyle(voteUpLink)) myVote = 1;
      else if (voteDownLink && hasStyle(voteDownLink)) myVote = -1;

      const metaBlock = el.querySelector('.c3');
      const userLink = metaBlock?.querySelector('a');
      const userName = userLink ? userLink.textContent : (metaBlock?.textContent?.match(/Posted by:? (.*?) on/)?.[1] || 'Unknown');
      const rawTime = metaBlock?.textContent?.match(/Posted on (.*?) by/)?.[1] || '';
      const timestamp = Date.parse(rawTime + ' UTC') || 0;

      const scoreBlock = el.querySelector('.c5 span');
      const scoreText = scoreBlock ? scoreBlock.textContent : '0';
      const score = parseInt(scoreText.replace(/[^0-9+-]/g, '')) || 0;

      const contentBlock = el.querySelector('.c6');
      let contentHtml = '';
      if (contentBlock) {
        const safeClone = contentBlock.cloneNode(true);
        safeClone.querySelectorAll('script, style, link, iframe, form, input, button, textarea').forEach(n => n.remove());
        safeClone.querySelectorAll('*').forEach(node => {
          node.removeAttribute('style'); node.removeAttribute('class'); node.removeAttribute('id');
          Array.from(node.attributes).forEach(attr => {
            if (attr.name.toLowerCase().startsWith('on')) node.removeAttribute(attr.name);
          });
          if (node.tagName === 'A') {
            node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer');
          }
        });
        contentHtml = safeClone.innerHTML;
      }

      const isUploader = !!el.querySelector('a[name="ulcomment"]');

      comments.push({ id: commentId, user: userName, timestamp, score, content: contentHtml, isUploader, isEditable, myVote });
    } catch {}
  });

  return { comments, contentWarning: false, apiData: null };
}

function parseEHCommentsFromAPI(apiResp) {
  if (!apiResp || !apiResp.gmetadata) return [];
  const meta = apiResp.gmetadata[0];
  if (!meta || !meta.comments) return [];

  const isUploaderName = meta.uploader || '';
  return meta.comments.map(c => ({
    id: c.id,
    user: c.comment_poster || 'Unknown',
    timestamp: c.posted_date ? Date.parse(c.posted_date + ' UTC') || 0 : 0,
    score: c.comment_score || 0,
    content: c.comment_body || '',
    isUploader: (c.comment_poster || '').toLowerCase() === isUploaderName.toLowerCase(),
    isEditable: false,
    myVote: 0,
  }));
}

function isContentWarningOrLogin(htmlText) {
  if (htmlText.toLowerCase().includes('you are seeing this page because')) return 'warning';
  if (htmlText.includes('<title>Login</title>') || htmlText.includes('Please login')) return 'login';
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  if (doc.querySelector('h1')?.textContent.includes('Content Warning')) return 'warning';
  return null;
}

function isGalleryUnavailable(htmlText, status) {
  if (status === 404 || status === 410) return true;
  if (status === 403) return 'blocked';
  const lower = htmlText.toLowerCase();
  if (lower.includes('gallery not available') ||
      lower.includes('this gallery is not available') ||
      lower.includes('expunged') ||
      lower.includes('gallery removed') ||
      lower.includes('no longer available')) {
    return true;
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  const bodyText = doc.body?.textContent?.toLowerCase() || '';
  if (bodyText.includes('gallery not available') ||
      bodyText.includes('not available') ||
      bodyText.includes('expunged')) {
    return true;
  }
  return false;
}

function ehUrl(rawUrl, worker) {
  if (!rawUrl) return rawUrl;
  if (worker) return worker;
  if (!import.meta.env.DEV) return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (u.hostname === 'exhentai.org' || u.hostname === 'e-hentai.org') {
      return '/eh' + u.pathname + u.search;
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function normaliseEhUrl(rawUrl) {
  if (!rawUrl) return '';
  const trimmed = rawUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return 'https://' + trimmed;
}

async function workerApi(workerBase, path, body, token) {
  if (!token) throw new Error('Worker Token 无效或缺失。请在设定面板填入 KV tokens 中配置的 Token。');
  const url = (workerBase || '').replace(/\/$/, '') + path;
  const headers = { 'Content-Type': 'application/json', 'x-sync-token': token };
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

export default function EhComments({ sourceUrl, ehEnabled, ehCookie, ehWorker, ehToken, ehMinScore, ehMaxComments, ehSortMethod, ehSortOrder }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [needsCookie, setNeedsCookie] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [shouldAutoLoad, setShouldAutoLoad] = useState(false);
  const sectionRef = useRef(null);
  const autoLoadSourceRef = useRef('');
  const hasAutoLoaded = useRef(false);
  const autoRetryTimerRef = useRef(null);
  const autoRetryCountRef = useRef(0);

  const [apiData, setApiData] = useState(EMPTY_API_DATA);
  const [postText, setPostText] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [votingId, setVotingId] = useState(null);
  const votingRef = useRef(null);

  const cookie = getSafeCookie(ehCookie);

  useEffect(() => {
    setComments([]);
    setLoaded(false);
    setError(null);
    setNeedsCookie(false);
    setApiData(EMPTY_API_DATA);
    setShouldAutoLoad(false);
    autoLoadSourceRef.current = '';
    hasAutoLoaded.current = false;
    autoRetryCountRef.current = 0;

    if (!sourceUrl || !ehEnabled) return undefined;
    const node = sectionRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      autoLoadSourceRef.current = sourceUrl;
      setShouldAutoLoad(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        autoLoadSourceRef.current = sourceUrl;
        setShouldAutoLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: '600px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ehEnabled, sourceUrl]);

  const fetchComments = useCallback(async (forceRefresh) => {
    if (!sourceUrl) return;

    const cacheKey = `${sourceUrl}::${cookie}`;
    if (!forceRefresh) {
      const cached = commentsCache.get(cacheKey);
      const cacheCanRestoreVoting = !ehWorker || !cookie || hasVotingApiData(cached?.apiData);
      if (cached && cacheCanRestoreVoting && Date.now() - cached.ts < CACHE_TTL) {
        setComments(cached.data);
        setApiData(cached.apiData || EMPTY_API_DATA);
        setLoading(false);
        setLoaded(true);
        return;
      }
    }

    setLoading(true);
    setError(null);
    setNeedsCookie(false);
    setApiData(EMPTY_API_DATA);

    try {
      const realUrl = normaliseEhUrl(sourceUrl);
      const workerUrl = ehUrl(realUrl, ehWorker);

      let htmlText;

      if (ehWorker) {
        if (!ehToken) throw new Error('Worker Token 无效或缺失。请在设定面板填入 KV tokens 中配置的 Token。');
        const workerHeaders = { 'Content-Type': 'application/json', 'x-sync-token': ehToken };
        const galleryRes = await fetch(workerUrl, {
          method: 'POST',
          headers: workerHeaders,
          body: JSON.stringify({ url: realUrl, cookie: cookie || '' }),
        });

        if (!galleryRes.ok) {
          // Try reading as JSON (Worker may return structured error)
          let jsonErr = null;
          let errBody = '';
          try { errBody = await galleryRes.text(); jsonErr = JSON.parse(errBody); } catch {}

          if (jsonErr && jsonErr.error) {
            const msgMap = {
              Unauthorized: 'Worker Token 无效或缺失。请在设定面板填入 KV tokens 中配置的 Token。',
              EH_REQUIRES_LOGIN: 'EH/EX 需要有效 Cookie。请在设定面板填入 Cookie 后重试。',
              EH_CLOUDFLARE_BLOCK: 'Worker 被 EH/EX 的 Cloudflare 防护拦截。请等待一段时间后重试，或更换 Worker 部署区域。',
              EH_EMPTY_RESPONSE: 'EH 返回了异常响应。请检查画廊 URL 是否正确。',
              EH_UNEXPECTED_PAGE: jsonErr.detail || 'EH 返回了非预期页面。Cookie 可能已过期，请更新。',
            };
            throw new Error(msgMap[jsonErr.error] || (jsonErr.detail || `Worker 错误: ${jsonErr.error}`));
          }

          const unavailable = isGalleryUnavailable(errBody, galleryRes.status);
          if (unavailable === 'blocked') throw new Error('画廊访问被拒绝。');
          if (unavailable) throw new Error('画廊已不可用。');
          throw new Error(`请求失败 (${galleryRes.status})`);
        }

        // Check for JSON error even on 200
        const rawResponse = await galleryRes.text();
        let jsonErr200 = null;
        try { jsonErr200 = JSON.parse(rawResponse); } catch {}
        if (jsonErr200 && jsonErr200.error) {
          const msgMap = {
            Unauthorized: 'Worker Token 无效或缺失。请在设定面板填入 KV tokens 中配置的 Token。',
            EH_REQUIRES_LOGIN: 'EH/EX 需要有效 Cookie。请在设定面板填入 Cookie 后重试。',
            EH_CLOUDFLARE_BLOCK: 'Worker 被 EH/EX 的 Cloudflare 防护拦截。',
            EH_EMPTY_RESPONSE: 'EH 返回了异常响应。请检查画廊 URL。',
            EH_UNEXPECTED_PAGE: jsonErr200.detail || 'EH 返回了非预期页面。Cookie 可能已过期。',
          };
          throw new Error(msgMap[jsonErr200.error] || (jsonErr200.detail || `Worker 错误`));
        }

        htmlText = rawResponse;
      } else {
        const headers = {};
        if (cookie) headers['X-EH-Cookie'] = cookie;
        const galleryRes = await fetch(workerUrl, { headers, redirect: 'manual' });

        if (galleryRes.type === 'opaqueredirect') {
          throw new Error('EH 请求被重定向到外部域名，请使用 Cloudflare Worker 代理。');
        }

        if (!galleryRes.ok) throw new Error(`请求失败 (${galleryRes.status})`);

        htmlText = await galleryRes.text();
      }

      const blockType = isContentWarningOrLogin(htmlText);

      if (blockType) {
        setNeedsCookie(true);
        setComments([]);
        setLoaded(true);
        setError(blockType === 'warning'
          ? '遇到内容警告页。请在设定面板中填入有效的 EH Cookie 后重新加载。'
          : '需要登录 E-Hentai。请在设定面板中配置 EH Cookie。');
        setLoading(false);
        return;
      }

      if (isGalleryUnavailable(htmlText, 200)) {
        setComments([]);
        setLoaded(true);
        setError('画廊已不可用。该画廊可能已从 E-Hentai 删除 (expunged)。');
        setLoading(false);
        return;
      }

      const parsedApi = extractApiData(htmlText);
      if (parsedApi.apiuid) setApiData(parsedApi);

      const domResult = parseEHCommentsFromDOM(htmlText);
      if (domResult.contentWarning) {
        setNeedsCookie(true);
        setComments([]);
        setLoaded(true);
        setError('遇到内容警告页。请在设定面板填入有效 EH Cookie（含 nw=1）后重试。');
        setLoading(false);
        return;
      }

      let finalComments = domResult.comments;

      // DOM parsing returned 0 comments but the page has #cdiv container —
      // the gallery likely requires login; try API fallback if we have apiData
      if (finalComments.length === 0 && parsedApi.apiuid && parsedApi.gid && parsedApi.token && ehWorker) {
        try {
          const apiRes = await workerApi(ehWorker, '/api', {
            apiUrl: parsedApi.apiUrl,
            cookie: cookie || '',
            payload: {
              method: 'gdata',
              gidlist: [[parsedApi.gid, parsedApi.token]],
              namespace: 1,
            },
          }, ehToken);
          const apiComments = parseEHCommentsFromAPI(apiRes);
          if (apiComments.length > 0) {
            finalComments = apiComments;
            commentsCache.set(cacheKey + '::api', { data: finalComments, ts: Date.now() });
          }
        } catch {}
      }

      setComments(finalComments);
      if (finalComments.length === 0) {
        if (htmlText.includes('#cdiv') || htmlText.includes('commentthread')) {
          setError('评论内容需要登录后可见。请在设定面板中填入 EH Cookie 后点击"重新加载"。');
          setNeedsCookie(true);
        }
      }
      commentsCache.set(cacheKey, { data: finalComments, apiData: parsedApi, ts: Date.now() });
      setLoaded(true);
    } catch (e) {
      if (e instanceof TypeError && e.message === 'Failed to fetch') {
        setError(
          '无法直接访问 E-Hentai（浏览器 CORS 策略限制）。' +
          (import.meta.env.DEV ? '请确认 Vite 代理配置正确。' : '生产环境需要部署反向代理来中转 EH 请求。')
        );
        setNeedsCookie(true);
      } else {
        setError(e.message || '获取评论失败');
      }
    } finally {
      setLoading(false);
    }
  }, [sourceUrl, cookie, ehWorker, ehToken]);

  const doVote = useCallback(async (commentId, voteValue) => {
    if (!ehWorker || !cookie || !apiData.apikey || !apiData.apiuid || !apiData.gid || !apiData.token) return;
    if (votingRef.current !== null) return;

    const id = commentId;
    votingRef.current = id;
    setVotingId(id);

    try {
      await workerApi(ehWorker, '/api', {
        apiUrl: apiData.apiUrl,
        cookie,
        payload: {
          method: 'votecomment',
          apiuid: apiData.apiuid,
          apikey: apiData.apikey,
          gid: apiData.gid,
          token: apiData.token,
          comment_id: id,
          comment_vote: voteValue,
        },
      }, ehToken);
      const cacheKey = `${sourceUrl}::${cookie}`;
      commentsCache.delete(cacheKey);
      await fetchComments(true);
    } catch {} finally {
      votingRef.current = null;
      setVotingId(null);
    }
  }, [ehWorker, cookie, apiData, sourceUrl, fetchComments]);

  const doPostComment = useCallback(async () => {
    if (!postText.trim() || !ehWorker || !cookie || !sourceUrl) return;
    setPosting(true);
    try {
      const normalUrl = normaliseEhUrl(sourceUrl);
      const formBody = 'commenttext_new=' + encodeURIComponent(postText) + '&post_comment=Post+Comment';
      await workerApi(ehWorker, '/comment', { galleryUrl: normalUrl, cookie, formBody }, ehToken);
      setPostText('');
      // Invalidate cache then force refresh
      const cacheKey = `${sourceUrl}::${cookie}`;
      commentsCache.delete(cacheKey);
      fetchComments(true);
    } catch {} finally {
      setPosting(false);
    }
  }, [postText, ehWorker, cookie, sourceUrl, fetchComments]);

  const doEditComment = useCallback(async (commentId) => {
    if (!editText.trim() || !ehWorker || !cookie || !sourceUrl) return;
    try {
      const normalUrl = normaliseEhUrl(sourceUrl);
      const formBody = 'edit_comment=' + commentId + '&commenttext_edit=' + encodeURIComponent(editText) + '&edit_comment_submit=Edit+Comment';
      await workerApi(ehWorker, '/comment', { galleryUrl: normalUrl, cookie, formBody }, ehToken);
      setEditingId(null);
      setEditText('');
      const cacheKey = `${sourceUrl}::${cookie}`;
      commentsCache.delete(cacheKey);
      fetchComments(true);
    } catch {}
  }, [editText, ehWorker, cookie, sourceUrl, fetchComments]);

  const handleReload = useCallback(() => {
    autoLoadSourceRef.current = sourceUrl;
    hasAutoLoaded.current = true;
    setShouldAutoLoad(true);
    setRetryTick((value) => value + 1);
  }, [sourceUrl]);

  useEffect(() => {
    if (!sourceUrl || !ehEnabled || !shouldAutoLoad || autoLoadSourceRef.current !== sourceUrl) return;
    fetchComments(!hasAutoLoaded.current ? false : true);
    hasAutoLoaded.current = true;
  }, [sourceUrl, ehEnabled, fetchComments, retryTick, shouldAutoLoad]);

  useEffect(() => {
    if (!sourceUrl || !ehEnabled) return undefined;
    if (loading) return undefined;
    if (!loaded) return undefined;
    if (comments.length > 0) {
      if (ehWorker && cookie && !hasVotingApiData(apiData) && autoRetryCountRef.current < 1) {
        autoRetryTimerRef.current = setTimeout(() => {
          commentsCache.delete(`${sourceUrl}::${cookie}`);
          autoRetryCountRef.current += 1;
          setRetryTick((value) => value + 1);
        }, 900);
        return () => {
          if (autoRetryTimerRef.current) clearTimeout(autoRetryTimerRef.current);
        };
      }
      autoRetryCountRef.current = 0;
      return undefined;
    }
    if (needsCookie) return undefined;
    if (autoRetryCountRef.current >= 2) return undefined;
    autoRetryTimerRef.current = setTimeout(() => {
      const cacheKey = `${sourceUrl}::${cookie}`;
      commentsCache.delete(cacheKey);
      commentsCache.delete(cacheKey + '::api');
      autoRetryCountRef.current += 1;
      setRetryTick((v) => v + 1);
    }, 1500);
    return () => {
      if (autoRetryTimerRef.current) clearTimeout(autoRetryTimerRef.current);
    };
  }, [apiData, comments.length, cookie, ehEnabled, ehWorker, loaded, loading, needsCookie, sourceUrl]);

  if (!ehEnabled) return null;
  if (!sourceUrl) return null;

  const isEHUrl = (() => {
    try {
      const u = new URL(normaliseEhUrl(sourceUrl));
      return u.hostname === 'e-hentai.org' || u.hostname === 'exhentai.org';
    } catch { return false; }
  })();
  if (!isEHUrl) return null;

  const filteredAndSorted = (() => {
    let list = comments.filter(c => c.isUploader || c.score >= (ehMinScore || 0));
    const orderFactor = ehSortOrder === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (a.isUploader !== b.isUploader) return a.isUploader ? -1 : 1;
      if (ehSortMethod === 'time') return (b.timestamp - a.timestamp) * orderFactor;
      return (b.score - a.score) * orderFactor;
    });
    return list.slice(0, ehMaxComments || 45);
  })();

  const jumpUrl = normaliseEhUrl(sourceUrl);

  return (
    <div ref={sectionRef} data-lrr-eh-comments className="glass-panel section-reveal section-reveal-delay-3" style={{ padding: '20px', marginTop: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--accent)' }}>💬</span> EH 评论区
          {loaded && <span style={{ fontSize: '11px', color: 'var(--text-sub)', fontWeight: 400 }}>{comments.length} 条</span>}
        </h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <a
            href={jumpUrl} target="_blank" rel="noopener noreferrer"
            className="btn"
            style={{ padding: '5px 12px', fontSize: '12px', textDecoration: 'none', background: 'rgba(255,255,255,0.06)' }}
          >
            跳转画廊
          </a>
          <button className="btn" onClick={handleReload} disabled={loading} style={{ padding: '5px 12px', fontSize: '12px' }}>
            {loading ? '加载中...' : '重新加载'}
          </button>
        </div>
      </div>

      {!loaded && !loading && (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-sub)', fontSize: '13px' }}>
          点击「重新加载」获取 E-Hentai 评论
        </div>
      )}

      {loading && !loaded && (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-sub)', fontSize: '13px' }}>
          正在获取评论...
        </div>
      )}

      {error && (
        <div style={{ padding: '14px 18px', background: 'rgba(242,116,116,0.1)', border: '1px solid rgba(242,116,116,0.3)', borderRadius: '8px', color: '#f27474', fontSize: '13px', lineHeight: 1.6, marginBottom: '16px', whiteSpace: 'pre-wrap' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>⚠️ {error}</div>
          {needsCookie && (
            <div style={{ marginTop: '8px', color: 'var(--text-sub)', fontSize: '12px' }}>
              请在设定面板中填入 E-Hentai Cookie（igneous、ipb_member_id、ipb_pass_hash）。
            </div>
          )}
        </div>
      )}

      {loaded && comments.length === 0 && !error && (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-sub)', fontSize: '13px' }}>
          该画廊暂无评论，或需要登录 E-Hentai 后可见。
          {!cookie && (
            <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-sub)' }}>
              在设定面板填入 EH Cookie 后刷新即可加载需要登录才能看到的评论。
            </div>
          )}
        </div>
      )}

      {loaded && comments.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', fontSize: '12px' }}>
            <span style={{ color: 'var(--text-sub)' }}>
              排序: {ehSortMethod === 'time' ? '时间' : '分数'} / {ehSortOrder === 'asc' ? '正序' : '倒序'}
              {(ehMinScore || 0) > 0 && <span style={{ marginLeft: '8px' }}>最低: {ehMinScore}分</span>}
            </span>
          </div>

          <div style={{ marginBottom: '16px' }}>
            {(() => {
              const hasUserCommented = comments.some(c => c.isEditable);
              return filteredAndSorted.map(c => {
                const scoreClass = c.score > 0 ? '#a5dc86' : c.score < 0 ? '#f27474' : 'var(--text-sub)';
                const scoreSign = c.score > 0 ? '+' : '';
                const canVote = !c.isUploader && ehWorker && cookie && apiData.apikey && apiData.apiuid && apiData.gid && apiData.token;

                return (
                <div key={c.id} style={{
                  background: c.isUploader ? 'rgba(255,152,0,0.08)' : 'rgba(0,0,0,0.2)',
                  padding: '14px 16px', borderRadius: '10px', marginBottom: '10px',
                  border: c.isUploader ? '1px solid rgba(255,152,0,0.3)' : '1px solid rgba(255,255,255,0.06)',
                  borderLeft: c.isUploader ? '4px solid #ff9800' : '4px solid rgba(255,255,255,0.1)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px', fontSize: '12px', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: '1 1 auto' }}>
                      <span style={{ color: c.isEditable ? '#69f0ae' : 'var(--accent)', fontWeight: 'bold', fontSize: '13px' }}>
                        {c.user}{c.isEditable ? ' (你)' : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                      {c.isUploader && <span style={{ background: '#ff9800', color: '#000', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', fontWeight: 'bold' }}>UP</span>}
                      {!c.isUploader && (
                        <span style={{ color: scoreClass, fontWeight: 'bold', fontSize: '12px' }}>
                          评分 {scoreSign}{c.score}
                        </span>
                      )}
                      {canVote && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: '46px', height: '20px', flexShrink: 0,
                        }}>
                          {votingId === c.id ? (
                            <span style={{
                              display: 'inline-block', width: '12px', height: '12px',
                              border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'var(--accent)',
                              borderRadius: '50%', animation: 'spin 0.6s linear infinite',
                            }} />
                          ) : (
                            <>
                              <button onClick={() => doVote(c.id, 1)} style={{
                                background: 'none', border: 'none', color: c.myVote === 1 ? '#a5dc86' : '#666',
                                cursor: 'pointer', width: '20px', height: '20px', padding: 0,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.2s ease', borderRadius: '3px', flexShrink: 0,
                                lineHeight: 0, verticalAlign: 'middle',
                              }}
                              onMouseEnter={e => { if (c.myVote !== 1) e.currentTarget.style.color = '#a5dc86'; }}
                              onMouseLeave={e => { if (c.myVote !== 1) e.currentTarget.style.color = '#666'; }}
                              title="赞同"
                              aria-label="赞同"
                              ><VoteIcon direction="up" active={c.myVote === 1} /></button>
                              <button onClick={() => doVote(c.id, -1)} style={{
                                background: 'none', border: 'none', color: c.myVote === -1 ? '#f27474' : '#666',
                                cursor: 'pointer', width: '20px', height: '20px', padding: 0,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.2s ease', borderRadius: '3px', flexShrink: 0,
                                lineHeight: 0, verticalAlign: 'middle',
                              }}
                              onMouseEnter={e => { if (c.myVote !== -1) e.currentTarget.style.color = '#f27474'; }}
                              onMouseLeave={e => { if (c.myVote !== -1) e.currentTarget.style.color = '#666'; }}
                              title="反对"
                              aria-label="反对"
                              ><VoteIcon direction="down" active={c.myVote === -1} /></button>
                            </>
                          )}
                        </span>
                      )}
                      {c.isEditable && ehWorker && cookie && (
                        <button onClick={() => { setEditingId(c.id); setEditText(''); }} style={{
                          background: 'none', border: 'none', color: '#999', cursor: 'pointer',
                          fontSize: '11px', textDecoration: 'underline',
                        }}>编辑</button>
                      )}
                    </div>
                  </div>
                  {editingId === c.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <textarea value={editText} onChange={(e) => setEditText(e.target.value)}
                        placeholder={c.content.replace(/<[^>]*>/g, '').substring(0, 100)}
                        style={{
                          width: '100%', minHeight: '70px', background: 'rgba(255,255,255,0.06)',
                          border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#ccc',
                          padding: '10px', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box',
                          fontFamily: 'inherit',
                        }}
                      />
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn" onClick={() => setEditingId(null)} style={{ fontSize: '11px', padding: '4px 10px' }}>取消</button>
                        <button className="btn" onClick={() => doEditComment(c.id)} style={{ fontSize: '11px', padding: '4px 10px' }}>保存</button>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-sub)', textAlign: 'right', lineHeight: 1.4 }}>
                        {formatTimeCN(c.timestamp)}
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div dangerouslySetInnerHTML={{ __html: c.content }} style={{ fontSize: '14px', lineHeight: '1.7', color: 'var(--text-main)', wordBreak: 'break-word', overflowWrap: 'break-word', maxWidth: '100%', overflow: 'hidden' }} />
                      <div style={{ fontSize: '11px', color: 'var(--text-sub)', textAlign: 'right', lineHeight: 1.4 }}>
                        {formatTimeCN(c.timestamp)}
                      </div>
                    </div>
                  )}
                </div>
              );})})()}

            {!comments.some(c => c.isEditable) && ehWorker && cookie && (
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <textarea value={postText} onChange={(e) => setPostText(e.target.value)}
                  placeholder="发表新评论..."
                  style={{
                    width: '100%', minHeight: '80px', background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', color: '#ccc',
                    padding: '12px', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                />
                <div style={{ marginTop: '10px', textAlign: 'center' }}>
                  <button className="btn" onClick={doPostComment} disabled={posting || !postText.trim()}
                    style={{ padding: '8px 24px', fontSize: '13px' }}>
                    {posting ? '发送中...' : '发表评论'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
