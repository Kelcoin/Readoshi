import React, { useEffect, useMemo, useRef, useState } from 'react';
import { lrrApi } from '../lib/api';
import { formatMetadataTag, mergeTags, metadataFingerprint, normalizeMetadataPlugins, parseTags } from '../lib/metadataEditor';
import { navigateHome, navigateToArchive } from '../lib/navigation';
import CustomSelect from '../components/CustomSelect';
import TagSuggest from '../components/TagSuggest';
import ConfirmDialog from '../components/ConfirmDialog';
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
  const [status, setStatus] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteSync, setDeleteSync] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [hoveredTag, setHoveredTag] = useState('');
  const tagInputRef = useRef(null);
  const dirty = useMemo(() => baseline && metadataFingerprint({ ...form, tags: form.tags.join(',') }) !== baseline, [baseline, form]);

  useEffect(() => {
    Promise.all([lrrApi.getArchive(archiveId), lrrApi.getMetadataPlugins().catch(() => [])]).then(([data, list]) => {
      const next = { title: data.title || '', summary: data.summary || '', tags: parseTags(data.tags) };
      setArchive(data); setForm(next); setBaseline(metadataFingerprint({ ...next, tags: next.tags.join(',') }));
      const values = normalizeMetadataPlugins(list);
      setPlugins(values); setPlugin(values[0]?.value || '');
    }).catch(error => setStatus(error.message));
  }, [archiveId]);

  useEffect(() => {
    const guard = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const addTags = (value) => { setForm(current => ({ ...current, tags: mergeTags(current.tags, value) })); setTagInput(''); };
  const save = async () => {
    setStatus('正在保存…');
    try {
      const latest = await lrrApi.getArchive(archiveId);
      if (metadataFingerprint(latest) !== baseline) throw new Error('服务器上的元数据已发生变化，请刷新后再编辑。');
      await lrrApi.updateArchiveMetadata(archiveId, { ...form, tags: form.tags.join(',') });
      await lrrApi.clearSearchCache().catch(() => {});
      setBaseline(metadataFingerprint({ ...form, tags: form.tags.join(',') })); setStatus('已保存');
    } catch (error) { setStatus(error.status === 423 ? '归档正被其他任务占用，请稍后重试。' : error.message); }
  };
  const runPlugin = async () => {
    if (!plugin) return;
    setStatus('插件执行中…');
    try { const result = await lrrApi.useMetadataPlugin(archiveId, plugin, pluginArg); addTags(result?.data?.new_tags || result?.new_tags || ''); setStatus('插件标签已合并，保存后生效。'); }
    catch (error) { setStatus(error.message); }
  };
  if (!archive) return <div style={{ padding: 32 }}>{status || '正在载入元数据…'}</div>;
  return <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px 48px' }}>
    <h2 style={{ textAlign: 'center' }}>编辑 {archive.title}</h2>
    <section className="glass-panel" style={{ padding: 28, display: 'grid', gap: 18 }}>
      <label>当前文件名<input className="input-glass" style={field} readOnly value={archive.filename || archive.filepath || ''} /></label>
      <label>ID<input className="input-glass" style={field} readOnly value={archiveId} /></label>
      <label>标题<input className="input-glass" style={field} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <label>摘要<textarea className="input-glass" style={{ ...field, minHeight: 110 }} value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} /></label>
      <div><div style={{ marginBottom: 8 }}>标签</div>
        <div ref={tagInputRef} style={{ position: 'relative', marginBottom: 10 }}><input className="input-glass" style={field} value={tagInput} placeholder="输入中文、拼音或标签，按回车/逗号添加" onChange={e => { const value = e.target.value; if (value.includes(',')) addTags(value); else setTagInput(value); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTags(tagInput); } else if (e.key === 'Backspace' && !tagInput && form.tags.length) setForm({ ...form, tags: form.tags.slice(0, -1) }); }} /><TagSuggest inputValue={tagInput} containerRef={tagInputRef} onSelectTag={(tag) => addTags(tag.replace(/\$$/, ''))} /></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, justifyContent: 'center', alignItems: 'center' }}>{form.tags.map(tag => <span key={tag} className="btn" onMouseEnter={() => setHoveredTag(tag)} onMouseLeave={() => setHoveredTag('')} onClick={async () => { try { await navigator.clipboard.writeText(tag); setStatus(`已复制标签：${tag}`); } catch { setStatus('复制标签失败'); } }} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: 34, gap: 7, cursor: 'copy' }}><span style={{ display: 'grid', alignItems: 'center' }}><span style={{ gridArea: '1 / 1', visibility: hoveredTag === tag ? 'hidden' : 'visible' }}>{formatMetadataTag(tag, translateTag)}</span><span style={{ gridArea: '1 / 1', visibility: hoveredTag === tag ? 'visible' : 'hidden' }}>{tag}</span></span><button type="button" aria-label={`删除 ${tag}`} title="删除标签" onClick={(event) => { event.stopPropagation(); setForm({ ...form, tags: form.tags.filter(item => item !== tag) }); }} style={{ border: 0, background: 'transparent', color: 'var(--text-sub)', cursor: 'pointer', padding: 0, fontSize: 15 }}>×</button></span>)}</div>
      </div>
      <div className="metadata-plugin-row"><CustomSelect value={plugin} options={plugins} onChange={setPlugin} /><input className="input-glass" value={pluginArg} onChange={e => setPluginArg(e.target.value)} placeholder="插件参数或 URL" /><button className="btn" onClick={runPlugin}>执行插件</button></div>
      {status && <div style={{ color: 'var(--text-sub)' }}>{status}</div>}
      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 14 }}><button className="btn" onClick={() => navigateToArchive(archiveId)}>阅读归档</button><button className="btn" onClick={() => { setDeleteSync(true); setDeleteOpen(true); }} style={{ color: '#ff9e9e' }}>删除归档</button><button className="btn" onClick={save}>保存元数据</button><button className="btn" onClick={() => { if (window.history.length > 1) window.history.back(); else navigateHome(); }}>返回</button></div>
    </section>
    <ConfirmDialog open={deleteOpen} title="确认删除归档" message={`将永久删除“${archive.title}”。`} confirmLabel={deleting ? '删除中…' : '确认删除'} confirmDisabled={deleting} onCancel={() => !deleting && setDeleteOpen(false)} onConfirm={async () => { setDeleting(true); try { await deleteArchiveWithFavoriteSync({ ...archive, id: archiveId }, { syncEnabled: getEhFavoriteDeleteSync(), confirmationEnabled: deleteSync }); navigateHome(); } catch (error) { setStatus(error.message); setDeleting(false); } }}>
      {getEhFavoriteDeleteSync() && <EhFavoriteDeleteSwitch checked={deleteSync} onChange={setDeleteSync} disabled={deleting} />}
    </ConfirmDialog>
  </main>;
}
