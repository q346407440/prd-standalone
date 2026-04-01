import { useEffect, useRef, useState } from 'react';
import {
  FiLayers,
  FiPlus,
  FiCheck,
  FiEdit2,
  FiChevronDown,
  FiDownload,
} from 'react-icons/fi';
import {
  PRD_FILE_NAME_RULE_HINT,
} from '../prd-constants.js';
import {
  normalizeProjectLikeName,
  mapPrdFileNameError,
} from '../prd-utils.js';
import {
  fetchDocList,
  createDoc,
  switchDoc,
  renameDoc,
} from '../prd-api.js';
import { FeishuSyncEntry } from '../../../feishu-sync/index.jsx';
import { ExportPackageModal } from './modals/ExportPackageModal.jsx';

export function PrdToolbar({
  activeSlug, blocks, onSwitch, onExport, exporting = false,
}) {
  const [switchPanelOpen, setSwitchPanelOpen] = useState(false);
  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [activeTitle, setActiveTitle] = useState('');

  const [creating, setCreating] = useState(false);
  const [newDocName, setNewDocName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const newDocComposingRef = useRef(false);

  const [renaming, setRenaming] = useState(null);
  const renameComposingRef = useRef(false);

  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportPackageName, setExportPackageName] = useState('');
  const [exportPackageError, setExportPackageError] = useState('');

  const [switchingSlug, setSwitchingSlug] = useState(null);

  const switchBtnRef = useRef(null);
  const panelRef = useRef(null);
  const newDocInputRef = useRef(null);
  const renameInputRef = useRef(null);
  const exportInputRef = useRef(null);
  const [panelStyle, setPanelStyle] = useState({});

  function closePanel() {
    setSwitchPanelOpen(false);
    setCreating(false);
    setNewDocName('');
    setCreateError('');
    setRenaming(null);
  }

  function getDefaultExportPackageName() {
    return normalizeProjectLikeName(activeTitle || activeSlug || '') || activeSlug || 'prd-export';
  }

  function openExportDialog() {
    setExportPackageName(getDefaultExportPackageName());
    setExportPackageError('');
    setExportDialogOpen(true);
  }

  function closeExportDialog() {
    if (exporting) return;
    setExportDialogOpen(false);
    setExportPackageError('');
  }

  useEffect(() => {
    fetchDocList().then(list => {
      setDocs(list);
      const cur = list.find(d => d.slug === activeSlug);
      if (cur) setActiveTitle(cur.title);
    });
  }, []);

  useEffect(() => {
    const cur = docs.find(d => d.slug === activeSlug);
    if (cur) setActiveTitle(cur.title);
  }, [activeSlug, docs]);

  useEffect(() => {
    if (!switchPanelOpen || !switchBtnRef.current) return;
    const rect = switchBtnRef.current.getBoundingClientRect();
    setPanelStyle({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    });
  }, [switchPanelOpen]);

  useEffect(() => {
    if (!switchPanelOpen) return;
    const hasCached = docs.length > 0;
    if (!hasCached) setDocsLoading(true);
    fetchDocList()
      .then(list => {
        setDocs(list);
        const cur = list.find(d => d.slug === activeSlug);
        if (cur) setActiveTitle(cur.title);
      })
      .finally(() => setDocsLoading(false));
  }, [switchPanelOpen]);

  useEffect(() => {
    if (creating) setTimeout(() => newDocInputRef.current?.focus(), 30);
  }, [creating]);

  useEffect(() => {
    if (renaming) setTimeout(() => { renameInputRef.current?.focus(); renameInputRef.current?.select(); }, 30);
  }, [renaming?.slug]);

  useEffect(() => {
    if (exportDialogOpen) {
      setTimeout(() => {
        exportInputRef.current?.focus();
        exportInputRef.current?.select();
      }, 30);
    }
  }, [exportDialogOpen]);

  useEffect(() => {
    if (!switchPanelOpen) return;
    function handleClickOutside(e) {
      if (
        panelRef.current && !panelRef.current.contains(e.target) &&
        switchBtnRef.current && !switchBtnRef.current.contains(e.target)
      ) closePanel();
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [switchPanelOpen]);

  async function handleSwitchDoc(slug) {
    if (slug === activeSlug || switchingSlug || renaming) return;
    setSwitchingSlug(slug);
    try {
      await switchDoc(slug);
      onSwitch?.(slug);
      setSwitchPanelOpen(false);
    } finally {
      setSwitchingSlug(null);
    }
  }

  async function handleCreateDoc() {
    const name = normalizeProjectLikeName(newDocName);
    if (!name) { setCreateError('请输入合法文件名'); return; }
    setCreateLoading(true);
    setCreateError('');
    try {
      const result = await createDoc(name);
      if (!result.ok) {
        setCreateError(
          result.error === 'slug already exists'
            ? '同名文档已存在，请换个名称'
            : (mapPrdFileNameError(result.error) || '创建失败'),
        );
        return;
      }
      setCreating(false);
      setNewDocName('');
      onSwitch?.(result.slug);
      setSwitchPanelOpen(false);
    } catch (e) {
      setCreateError(e.message || '创建失败');
    } finally {
      setCreateLoading(false);
    }
  }

  function startRename(doc, e) {
    e.stopPropagation();
    setRenaming({ slug: doc.slug, value: doc.title, error: '', loading: false });
    setCreating(false);
  }

  async function handleRenameDoc() {
    if (!renaming || renaming.loading) return;
    const name = normalizeProjectLikeName(renaming.value);
    if (!name) { setRenaming(r => ({ ...r, error: '请输入合法文件名' })); return; }
    if (name === docs.find(d => d.slug === renaming.slug)?.title) { setRenaming(null); return; }
    setRenaming(r => ({ ...r, loading: true, error: '' }));
    try {
      const result = await renameDoc(renaming.slug, name);
      if (!result.ok) {
        setRenaming(r => ({
          ...r,
          loading: false,
          error: result.error === 'filename already exists' ? '同名文件已存在' : (mapPrdFileNameError(result.error) || '重命名失败'),
        }));
        return;
      }
      setDocs(list => list.map(d => d.slug === renaming.slug ? { ...d, title: result.title } : d));
      if (renaming.slug === activeSlug) setActiveTitle(result.title);
      setRenaming(null);
    } catch (e) {
      setRenaming(r => ({ ...r, loading: false, error: e.message || '重命名失败' }));
    }
  }

  async function handleExportWithPackageName() {
    const archiveName = normalizeProjectLikeName(exportPackageName);
    if (!archiveName) {
      setExportPackageError('请输入合法文件名');
      return;
    }
    setExportPackageError('');
    await onExport?.({
      currentTitle: activeTitle || activeSlug,
      archiveName,
    });
    setExportDialogOpen(false);
  }

  return (
    <div className="prd-toolbar">
      {/* ── 左侧：占位，保持工具栏撑满 ── */}
      <div className="prd-toolbar__left" />

      {/* ── 右侧：文档选择器 + 导出 + 飞书 ── */}
      <div className="prd-toolbar__right">
        <div className="prd-toolbar__switch-wrap prd-toolbar__switch-wrap--right">
          {/* 触发器：直接展示当前文档名 */}
          <button
            ref={switchBtnRef}
            className={`prd-toolbar__doc-selector${switchPanelOpen ? ' prd-toolbar__doc-selector--open' : ''}`}
            onClick={() => {
              if (switchPanelOpen) closePanel();
              else setSwitchPanelOpen(true);
            }}
          >
            <FiLayers className="prd-toolbar__doc-selector-icon" />
            <span className="prd-toolbar__doc-selector-name">
              {activeTitle || activeSlug || '加载中…'}
            </span>
            <FiChevronDown className={`prd-toolbar__doc-selector-caret${switchPanelOpen ? ' prd-toolbar__doc-selector-caret--open' : ''}`} />
          </button>

          {switchPanelOpen && (
            <div ref={panelRef} className="prd-toolbar__switch-panel" style={panelStyle} data-panel-open="true">
              <div className="prd-toolbar__switch-panel-list prd-toolbar__switch-panel-list--top-pad">
                {docsLoading ? (
                  <div className="prd-toolbar__switch-loading">加载中…</div>
                ) : docs.length === 0 ? (
                  <div className="prd-toolbar__switch-empty">暂无文档</div>
                ) : docs.map(doc => (
                  <div
                    key={doc.slug}
                    className={`prd-toolbar__switch-row${doc.slug === activeSlug ? ' prd-toolbar__switch-row--active' : ''}`}
                  >
                    {renaming?.slug === doc.slug ? (
                      /* ── 重命名内联编辑 ── */
                      <div className="prd-toolbar__rename-wrap">
                        <input
                          ref={renameInputRef}
                          className="prd-toolbar__rename-input"
                          value={renaming.value}
                          onChange={e => {
                            const v = renameComposingRef.current
                              ? e.target.value
                              : normalizeProjectLikeName(e.target.value);
                            setRenaming(r => ({ ...r, value: v, error: '' }));
                          }}
                          onCompositionStart={() => { renameComposingRef.current = true; }}
                          onCompositionEnd={e => {
                            renameComposingRef.current = false;
                            setRenaming(r => ({ ...r, value: normalizeProjectLikeName(e.target.value), error: '' }));
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); handleRenameDoc(); }
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                          disabled={renaming.loading}
                        />
                        <div className="prd-toolbar__rename-hint">{PRD_FILE_NAME_RULE_HINT}</div>
                        {renaming.error && <div className="prd-toolbar__rename-error">{renaming.error}</div>}
                        <div className="prd-toolbar__rename-actions">
                          <button
                            className="prd-toolbar__switch-create-cancel"
                            onClick={() => setRenaming(null)}
                            disabled={renaming.loading}
                          >取消</button>
                          <button
                            className="prd-toolbar__switch-create-confirm"
                            onClick={handleRenameDoc}
                            disabled={renaming.loading || !renaming.value.trim()}
                          >{renaming.loading ? '保存中…' : '保存'}</button>
                        </div>
                      </div>
                    ) : (
                      /* ── 正常行 ── */
                      <div className="prd-toolbar__switch-item">
                        <button
                          type="button"
                          className="prd-toolbar__switch-item-main"
                          onClick={() => handleSwitchDoc(doc.slug)}
                          disabled={!!switchingSlug}
                        >
                          {doc.slug === activeSlug
                            ? <FiCheck className="prd-toolbar__switch-item-check" />
                            : <span className="prd-toolbar__switch-item-check-placeholder" />
                          }
                          <span className="prd-toolbar__switch-item-name" title={doc.title}>{doc.title}</span>
                          {doc.slug === activeSlug && <span className="prd-toolbar__switch-item-badge">当前</span>}
                          {switchingSlug === doc.slug && <span className="prd-toolbar__switch-item-loading" />}
                        </button>
                        <button
                          type="button"
                          className="prd-toolbar__switch-item-rename"
                          title="重命名"
                          onClick={e => startRename(doc, e)}
                        >
                          <FiEdit2 />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="prd-toolbar__switch-panel-footer">
                {!creating ? (
                  <button className="prd-toolbar__switch-new-btn" onClick={() => { setCreating(true); setRenaming(null); }}>
                    <FiPlus />
                    <span>新建 PRD</span>
                  </button>
                ) : (
                  <div className="prd-toolbar__switch-create">
                    <input
                      ref={newDocInputRef}
                      className="prd-toolbar__switch-create-input"
                      placeholder="输入英文文件名…"
                      value={newDocName}
                      onChange={e => {
                        const v = newDocComposingRef.current
                          ? e.target.value
                          : normalizeProjectLikeName(e.target.value);
                        setNewDocName(v);
                        setCreateError('');
                      }}
                      onCompositionStart={() => { newDocComposingRef.current = true; }}
                      onCompositionEnd={e => {
                        newDocComposingRef.current = false;
                        setNewDocName(normalizeProjectLikeName(e.target.value));
                        setCreateError('');
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleCreateDoc();
                        if (e.key === 'Escape') { setCreating(false); setNewDocName(''); setCreateError(''); }
                      }}
                      disabled={createLoading}
                    />
                    <div className="prd-toolbar__switch-create-hint">{PRD_FILE_NAME_RULE_HINT}</div>
                    {createError && <div className="prd-toolbar__switch-create-error">{createError}</div>}
                    <div className="prd-toolbar__switch-create-actions">
                      <button
                        className="prd-toolbar__switch-create-cancel"
                        onClick={() => { setCreating(false); setNewDocName(''); setCreateError(''); }}
                        disabled={createLoading}
                      >取消</button>
                      <button
                        className="prd-toolbar__switch-create-confirm"
                        onClick={handleCreateDoc}
                        disabled={createLoading || !newDocName.trim()}
                      >{createLoading ? '创建中…' : '创建'}</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="prd-toolbar__divider" />
        <FeishuSyncEntry
          blocks={blocks}
          activeSlug={activeSlug}
          activeTitle={activeTitle}
        />
        <div className="prd-toolbar__divider" />
        <button
          className={`prd-toolbar__btn${exporting ? ' prd-toolbar__btn--active' : ''}`}
          title="导出可离线预览且包含源码的 ZIP 包"
          onClick={openExportDialog}
          disabled={exporting}
        >
          <FiDownload className="prd-toolbar__btn-icon" />
          <span>{exporting ? '导出中…' : '导出离线包'}</span>
        </button>
      </div>
      {exportDialogOpen ? (
        <ExportPackageModal
          value={exportPackageName}
          error={exportPackageError}
          exporting={exporting}
          inputRef={exportInputRef}
          onChange={(value) => {
            setExportPackageName(normalizeProjectLikeName(value));
            setExportPackageError('');
          }}
          onCancel={closeExportDialog}
          onConfirm={handleExportWithPackageName}
        />
      ) : null}
    </div>
  );
}
