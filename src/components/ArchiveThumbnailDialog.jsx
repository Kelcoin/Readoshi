import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { encodeApiKey, lrrApi } from '../lib/api';
import { acquireBodyScrollLock } from '../lib/bodyScrollLock';
import { getImage, IMAGE_LOAD_PRIORITY } from '../lib/imageCache';
import ArchivePageThumbnail from './ArchivePageThumbnail';

function archiveId(archive) {
  return String(archive?.arcid || archive?.id || '');
}

function normalizePageUrl(rawUrl) {
  const serverUrl = (localStorage.getItem('lrr_server_url') || '').replace(/\/$/, '');
  try {
    return new URL(rawUrl, serverUrl ? `${serverUrl}/` : window.location.origin).href;
  } catch {
    return rawUrl || '';
  }
}

async function loadPageImage(pageUrl) {
  const normalized = normalizePageUrl(pageUrl);
  if (!normalized) return null;
  return getImage(normalized, async (signal) => {
    const apiKey = localStorage.getItem('lrr_api_key') || '';
    const headers = apiKey ? { Authorization: `Bearer ${encodeApiKey(apiKey)}` } : {};
    const response = await fetch(normalized, { headers, signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.blob();
  }, { priority: IMAGE_LOAD_PRIORITY.CRITICAL });
}

export default function ArchiveThumbnailDialog({ archive, onClose }) {
  const id = archiveId(archive);
  const [pages, setPages] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [viewMode, setViewMode] = useState('grid');
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewSrc, setPreviewSrc] = useState(null);
  const [previewState, setPreviewState] = useState('idle');
  const [previewRetryToken, setPreviewRetryToken] = useState(0);

  useEffect(() => acquireBodyScrollLock(), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState('loading');
    setLoadError('');
    setPages([]);
    void lrrApi.getArchiveFiles(id, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        const nextPages = Array.isArray(response?.pages) ? response.pages.filter(Boolean) : [];
        setPages(nextPages);
        setLoadState(nextPages.length > 0 ? 'ready' : 'empty');
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setLoadError(error?.message || '未知错误');
        setLoadState('error');
      });
    return () => controller.abort();
  }, [id, reloadToken]);

  useEffect(() => {
    if (viewMode !== 'preview' || !pages[previewIndex]) {
      setPreviewSrc(null);
      setPreviewState('idle');
      return undefined;
    }
    let active = true;
    setPreviewSrc(null);
    setPreviewState('loading');
    void loadPageImage(pages[previewIndex])
      .then((src) => {
        if (!active) return;
        setPreviewSrc(src);
        setPreviewState(src ? 'ready' : 'error');
      })
      .catch(() => {
        if (active) setPreviewState('error');
      });
    return () => { active = false; };
  }, [pages, previewIndex, previewRetryToken, viewMode]);

  const showPreview = useCallback((index) => {
    setPreviewIndex(index);
    setViewMode('preview');
  }, []);
  const previousPage = useCallback(() => setPreviewIndex((index) => Math.max(0, index - 1)), []);
  const nextPage = useCallback(() => setPreviewIndex((index) => Math.min(pages.length - 1, index + 1)), [pages.length]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
      if (viewMode === 'preview' && event.key === 'ArrowLeft') previousPage();
      if (viewMode === 'preview' && event.key === 'ArrowRight') nextPage();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [nextPage, onClose, previousPage, viewMode]);

  const title = useMemo(() => archive?.title || id, [archive?.title, id]);

  return createPortal(
    <div className="archive-thumbnail-dialog-overlay" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${title} 缩略图`}
        className="glass-panel archive-thumbnail-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="archive-thumbnail-dialog-header">
          <div className="archive-thumbnail-dialog-heading">
            <strong>{viewMode === 'grid' ? '页面缩略图' : `第 ${previewIndex + 1} 页`}</strong>
            <span title={title}>{title}</span>
          </div>
          <div className="archive-thumbnail-dialog-header-actions">
            {viewMode === 'preview' && (
              <button type="button" className="btn" onClick={() => setViewMode('grid')}>返回缩略图</button>
            )}
            <button type="button" className="btn archive-thumbnail-dialog-close" onClick={onClose} aria-label="关闭" title="关闭">✕</button>
          </div>
        </header>

        <div className="archive-thumbnail-dialog-body">
          {viewMode === 'grid' && loadState === 'loading' && <div className="archive-thumbnail-dialog-status">正在读取页面…</div>}
          {viewMode === 'grid' && loadState === 'empty' && <div className="archive-thumbnail-dialog-status">该档案没有可显示的页面</div>}
          {viewMode === 'grid' && loadState === 'error' && (
            <div className="archive-thumbnail-dialog-status">
              <span>页面列表加载失败：{loadError}</span>
              <button type="button" className="btn" onClick={() => setReloadToken((token) => token + 1)}>重试</button>
            </div>
          )}
          {viewMode === 'grid' && loadState === 'ready' && (
            <div className="archive-thumbnail-dialog-grid">
              {pages.map((page, index) => (
                <button
                  key={`${page}-${index}`}
                  type="button"
                  className="archive-thumbnail-dialog-thumb"
                  onClick={() => showPreview(index)}
                  aria-label={`查看第 ${index + 1} 页大图`}
                >
                  <span className="archive-thumbnail-dialog-thumb-media">
                    <ArchivePageThumbnail archiveId={id} pageIndex={index} active eager={index < 12} />
                  </span>
                  <span className="archive-thumbnail-dialog-thumb-label">P. {index + 1}</span>
                </button>
              ))}
            </div>
          )}

          {viewMode === 'preview' && (
            <div className="archive-thumbnail-dialog-preview">
              <button type="button" className="btn archive-thumbnail-dialog-page-button" onClick={previousPage} disabled={previewIndex <= 0} aria-label="上一页">‹</button>
              <div className="archive-thumbnail-dialog-preview-stage">
                {previewState === 'loading' && <div className="archive-thumbnail-dialog-status">正在加载大图…</div>}
                {previewState === 'error' && (
                  <div className="archive-thumbnail-dialog-status">
                    <span>大图加载失败</span>
                    <button type="button" className="btn" onClick={() => setPreviewRetryToken((token) => token + 1)}>重试</button>
                  </div>
                )}
                {previewSrc && <img className="archive-thumbnail-dialog-preview-image" src={previewSrc} alt={`第 ${previewIndex + 1} 页`} />}
              </div>
              <button type="button" className="btn archive-thumbnail-dialog-page-button" onClick={nextPage} disabled={previewIndex >= pages.length - 1} aria-label="下一页">›</button>
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
