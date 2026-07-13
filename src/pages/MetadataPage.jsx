import React, { useEffect, useMemo, useRef, useState } from 'react';
import { lrrApi } from '../lib/api';
import { formatMetadataTag, mergeTags, metadataFingerprint, normalizeMetadataPlugins, parseTags, readMetadataPluginResult } from '../lib/metadataEditor';
import { navigateHome, navigateToArchive } from '../lib/navigation';
import CustomSelect from '../components/CustomSelect';
import TagSuggest from '../components/TagSuggest';
import ConfirmDialog from '../components/ConfirmDialog';
import MetadataTagChip from '../components/MetadataTagChip';
import EhFavoriteDeleteSwitch from '../components/EhFavoriteDeleteSwitch';
import { getEhFavoriteDeleteSync } from '../lib/ehFavoriteSync';
import { deleteArchiveWithFavoriteSync } from '../lib/archiveDeletion';
import { translateTag } from '../lib/tags';

const field = { width: '100%', boxSizing: 'border-box' };

export default function MetadataPage({ archiveId }) {
  const [archive, setArchive] = useState(null);
  const [baseline, setBaseline] = useState('');
  const [form, setForm] = useState({ title: '', summary: '', tags: [] });
  const [tagInput, setTagInput] = useState('');
  const [plugins, setPlugins] = useState([]);
  const [plugin, setPlugin] = useState('');
  const [pluginArg, setPluginArg] = useState('');
  const [status, setStatus] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteSync, setDeleteSync] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [revealedTag, setRevealedTag] = useState('');
  const tagInputRef = useRef(null);
  const statusTimerRef = useRef(null);
  const statusIdRef = useRef(0);
  const dirty = useMemo(() => baseline && metadataFingerprint({ ...form, tags: form.tags.join(',') }) !== baseline, [baseline, form]);

  const showStatus = (text, type = 'info', { autoHide = false } = {}) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusIdRef.current += 1;
    setStatus({ id: statusIdRef.current, text, type, closing: false });
    if (autoHide) {
      statusTimerRef.current = setTimeout(() => {
        setStatus(current => current ? { ...current, closing: true } : current);
        statusTimerRef.current = setTimeout(() => setStatus(null), 260);
      }, 1800);
    }
  };

  useEffect(() => {
    Promise.all([lrrApi.getArchive(archiveId), lrrApi.getMetadataPlugins().catch(() => [])]).then(([data, list]) => {
      const next = { title: data.title || '', summary: data.summary || '', tags: parseTags(data.tags) };
      setArchive(data); setForm(next); setBaseline(metadataFingerprint({ ...next, tags: next.tags.join(',') }));
      const values = normalizeMetadataPlugins(list);
      setPlugins(values); setPlugin(values[0]?.value || '');
    }).catch(error => showStatus(error.message, 'error'));
  }, [archiveId]);

  useEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
  }, []);

  useEffect(() => {
    const guard = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const addTags = (value) => { setForm(current => ({ ...current, tags: mergeTags(current.tags, value) })); setTagInput(''); };
  const save = async () => {
    showStatus('正在保存…');
    try {
      const latest = await lrrApi.getArchive(archiveId);
      if (metadataFingerprint(latest) !== baseline) throw new Error('服务器上的元数据已发生变化，请刷新后再编辑。');
      await lrrApi.updateArchiveMetadata(archiveId, { ...form, tags: form.tags.join(',') });
      await lrrApi.clearSearchCache().catch(() => {});
      setBaseline(metadataFingerprint({ ...form, tags: form.tags.join(',') })); showStatus('已保存', 'success', { autoHide: true });
    } catch (error) { showStatus(error.status === 423 ? '归档正被其他任务占用，请稍后重试。' : error.message, 'error'); }
  };
  const runPlugin = async () => {
    if (!plugin) return;
    showStatus('插件执行中…');
    try {
      const result = await lrrApi.useMetadataPlugin(archiveId, plugin, pluginArg.trim() || form.title || archive.title || '');
      const { tags } = readMetadataPluginResult(result);
      if (tags) addTags(tags);
      showStatus(tags ? '插件标签已合并，保存后生效。' : '插件执行完成，未返回新标签。', tags ? 'success' : 'info');
    } catch (error) { showStatus(error.message, 'error'); }
  };
  if (!archive) return <div style={{ padding: 32 }}>{status?.text || '正在载入元数据…'}</div>;
  return <main className="metadata-page">
    <h2 className="metadata-page-title">编辑 {archive.title}</h2>
    <section className="glass-panel metadata-panel">
      <label className="metadata-field">当前文件名<input className="input-glass" style={field} readOnly value={archive.filename || archive.filepath || ''} /></label>
      <label className="metadata-field">ID<input className="input-glass" style={field} readOnly value={archiveId} /></label>
      <label className="metadata-field">标题<input className="input-glass" style={field} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <label className="metadata-field">摘要<textarea className="input-glass" style={{ ...field, minHeight: 110 }} value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} /></label>
      <div className="metadata-tag-field"><div style={{ marginBottom: 10 }}>标签</div>
        <div ref={tagInputRef} style={{ position: 'relative', marginBottom: 10 }}><input className="input-glass" style={field} value={tagInput} placeholder="输入中文、拼音或标签，按回车/逗号添加" onChange={e => { const value = e.target.value; if (value.includes(',')) addTags(value); else setTagInput(value); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTags(tagInput); } else if (e.key === 'Backspace' && !tagInput && form.tags.length) setForm({ ...form, tags: form.tags.slice(0, -1) }); }} /><TagSuggest inputValue={tagInput} containerRef={tagInputRef} onSelectTag={(tag) => addTags(tag.replace(/\$$/, ''))} /></div>
        <div className="metadata-tags-box">{form.tags.map(tag => <MetadataTagChip key={tag} tag={tag} translatedTag={formatMetadataTag(tag, translateTag)} revealed={revealedTag === tag} onReveal={() => setRevealedTag(tag)} onHide={() => setRevealedTag(current => current === tag ? '' : current)} onToggle={() => setRevealedTag(current => current === tag ? '' : tag)} onCopy={async () => { try { await navigator.clipboard.writeText(tag); showStatus(`已复制标签：${tag}`, 'success'); } catch { showStatus('复制标签失败', 'error'); } }} onDelete={() => { setRevealedTag(current => current === tag ? '' : current); setForm({ ...form, tags: form.tags.filter(item => item !== tag) }); }} />)}</div>
      </div>
      <div className="metadata-plugin-row"><CustomSelect value={plugin} options={plugins} onChange={setPlugin} /><input className="input-glass" value={pluginArg} onChange={e => setPluginArg(e.target.value)} placeholder="插件参数或 URL" /><button className="btn" onClick={runPlugin}>执行插件</button></div>
      <div className="metadata-status-wrap" data-open={status ? 'true' : 'false'} aria-live="polite">
        <div className="metadata-status-clip">
          {status && <div key={status.id} className={`metadata-status-card is-${status.type}${status.closing ? ' is-closing' : ''}`}>{status.text}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 14 }}><button className="btn" onClick={() => navigateToArchive(archiveId)}>阅读归档</button><button className="btn metadata-delete-button" onClick={() => { setDeleteSync(true); setDeleteOpen(true); }}>删除归档</button><button className="btn" onClick={save}>保存元数据</button><button className="btn" onClick={() => { if (window.history.length > 1) window.history.back(); else navigateHome(); }}>返回</button></div>
    </section>
    <ConfirmDialog open={deleteOpen} title="确认删除归档" message={`将永久删除“${archive.title}”。`} confirmLabel={deleting ? '删除中…' : '确认删除'} confirmDisabled={deleting} onCancel={() => !deleting && setDeleteOpen(false)} onConfirm={async () => { setDeleting(true); try { await deleteArchiveWithFavoriteSync({ ...archive, id: archiveId }, { syncEnabled: getEhFavoriteDeleteSync(), confirmationEnabled: deleteSync }); navigateHome(); } catch (error) { showStatus(error.message, 'error'); setDeleting(false); } }}>
      {getEhFavoriteDeleteSync() && <EhFavoriteDeleteSwitch checked={deleteSync} onChange={setDeleteSync} disabled={deleting} />}
    </ConfirmDialog>
  </main>;
}
