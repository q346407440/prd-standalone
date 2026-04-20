import { useEffect, useRef, useState } from 'react';
import {
  FiLayers,
  FiPlus,
  FiCheck,
  FiEdit2,
  FiChevronDown,
  FiDownload,
  FiFileText,
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
  backupPrdDoc,
} from '../prd-api.js';
import { FeishuSyncEntry } from '../../../feishu-sync/index.jsx';
import { ExportPackageModal } from './modals/ExportPackageModal.jsx';
import { BackupFolderPathModal } from './modals/BackupFolderPathModal.jsx';

export function PrdToolbar({
  activeSlug,
  blocks,
  onSwitch,
  onExport,
  onExportNativeMd,
  exporting = false,
  exportingNativeMd = false,
  autoBackupOff = false,
  onAutoBackupOffChange,
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

  const [exportMdDialogOpen, setExportMdDialogOpen] = useState(false);
  const [exportMdPackageName, setExportMdPackageName] = useState('');
  const [exportMdPackageError, setExportMdPackageError] = useState('');

  const [switchingSlug, setSwitchingSlug] = useState(null);

  /** 本会话内已对某 slug 做过「首次选中立即备份」，再次切回该 slug 仅走定时器 */
  const backupImmediateDoneForSlugRef = useRef(new Set());
  const activeSlugForBackupRef = useRef(activeSlug);
  activeSlugForBackupRef.current = activeSlug;
  const [autoBackupStatus, setAutoBackupStatus] = useState({ kind: 'idle', text: '' });
  const [backupPathModalOpen, setBackupPathModalOpen] = useState(false);
  const prevAutoBackupOffRef = useRef(autoBackupOff);
  const prevSlugForBackupTransitionRef = useRef(activeSlug);

  const switchBtnRef = useRef(null);
  const panelRef = useRef(null);
  const newDocInputRef = useRef(null);
  const renameInputRef = useRef(null);
  const exportInputRef = useRef(null);
  const exportMdInputRef = useRef(null);
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

  function openExportMdDialog() {
    setExportMdPackageName(getDefaultExportPackageName());
    setExportMdPackageError('');
    setExportMdDialogOpen(true);
  }

  function closeExportMdDialog() {
    if (exportingNativeMd) return;
    setExportMdDialogOpen(false);
    setExportMdPackageError('');
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

  /** 从「关闭自动备份」切回「开启」时，允许对该 slug 再跑一次立即备份（仅同 slug 内 off→on，换文档时不误删） */
  useEffect(() => {
    if (prevSlugForBackupTransitionRef.current !== activeSlug) {
      prevSlugForBackupTransitionRef.current = activeSlug;
      prevAutoBackupOffRef.current = autoBackupOff;
      return;
    }
    if (prevAutoBackupOffRef.current && !autoBackupOff && activeSlug) {
      backupImmediateDoneForSlugRef.current.delete(activeSlug);
    }
    prevAutoBackupOffRef.current = autoBackupOff;
  }, [autoBackupOff, activeSlug]);

  useEffect(() => {
    if (!activeSlug) {
      setAutoBackupStatus({ kind: 'idle', text: '' });
      return undefined;
    }
    if (autoBackupOff) {
      setAutoBackupStatus({
        kind: 'paused',
        text: '自动备份已关闭（刷新页面后将恢复开启）',
      });
      return undefined;
    }

    let cancelled = false;
    let intervalId = null;
    const slugAtMount = activeSlug;

    function formatLocalTime(iso) {
      try {
        const d = new Date(iso);
        return d.toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
      } catch {
        return '';
      }
    }

    const run = async (expectedSlug) => {
      if (cancelled || activeSlugForBackupRef.current !== expectedSlug) return;
      try {
        const data = await backupPrdDoc(expectedSlug);
        if (cancelled || activeSlugForBackupRef.current !== expectedSlug) return;
        const t = data.at ? formatLocalTime(data.at) : '';
        setAutoBackupStatus({
          kind: 'ok',
          text: t ? `自动备份成功 · ${t}` : '自动备份成功',
        });
      } catch (e) {
        if (cancelled || activeSlugForBackupRef.current !== expectedSlug) return;
        setAutoBackupStatus({
          kind: 'err',
          text: `自动备份失败 · ${e?.message || '未知错误'}`,
        });
      }
    };

    if (!backupImmediateDoneForSlugRef.current.has(slugAtMount)) {
      backupImmediateDoneForSlugRef.current.add(slugAtMount);
      run(slugAtMount);
    }
    intervalId = window.setInterval(() => run(slugAtMount), 5 * 60 * 1000);

    return () => {
      cancelled = true;
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, [activeSlug, autoBackupOff]);

  useEffect(() => {
    if (exportDialogOpen) {
      setTimeout(() => {
        exportInputRef.current?.focus();
        exportInputRef.current?.select();
      }, 30);
    }
  }, [exportDialogOpen]);

  useEffect(() => {
    if (exportMdDialogOpen) {
      setTimeout(() => {
        exportMdInputRef.current?.focus();
        exportMdInputRef.current?.select();
      }, 30);
    }
  }, [exportMdDialogOpen]);

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

  async function handleExportNativeMdWithPackageName() {
    const archiveName = normalizeProjectLikeName(exportMdPackageName);
    if (!archiveName) {
      setExportMdPackageError('请输入合法文件名');
      return;
    }
    setExportMdPackageError('');
    await onExportNativeMd?.({
      currentTitle: activeTitle || activeSlug,
      archiveName,
    });
    setExportMdDialogOpen(false);
  }

  return (
    <div className="prd-toolbar">
      {/* ── 左侧：自动备份状态（仅当前选中文档） ── */}
      <div className="prd-toolbar__left">
        {activeSlug ? (
          <label
            className="prd-toolbar__backup-toggle"
            title="关闭后本标签页内不再定时备份，避免异常清空后覆盖 pages-backup；刷新页面后恢复为开启"
          >
            <input
              type="checkbox"
              className="prd-toolbar__backup-toggle-input"
              checked={!autoBackupOff}
              onChange={(e) => onAutoBackupOffChange?.(!e.target.checked)}
            />
            <span className="prd-toolbar__backup-toggle-label">自动备份</span>
          </label>
        ) : null}
        {autoBackupStatus.text ? (
          <span
            className={
              autoBackupStatus.kind === 'err'
                ? 'prd-toolbar__auto-backup prd-toolbar__auto-backup--err'
                : autoBackupStatus.kind === 'paused'
                  ? 'prd-toolbar__auto-backup prd-toolbar__auto-backup--paused'
                  : 'prd-toolbar__auto-backup'
            }
            title="将 pages 下当前文档目录复制到 pages-backup 下该文档的 s0、s1、s2 子文件夹；优先补空槽，三槽均有内容后每 5 分钟覆盖最旧的一份"
          >
            {autoBackupStatus.text}
          </span>
        ) : null}
        {activeSlug ? (
          <button
            type="button"
            className="prd-toolbar__backup-view-path"
            onClick={() => setBackupPathModalOpen(true)}
          >
            查看
          </button>
        ) : null}
      </div>

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
                      placeholder="输入文档文件名…"
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
        <button
          className={`prd-toolbar__btn${exportingNativeMd ? ' prd-toolbar__btn--active' : ''}`}
          title="导出原生 Markdown：去掉 block 标记、表格转 GFM、图片随包"
          onClick={openExportMdDialog}
          disabled={exportingNativeMd}
        >
          <FiFileText className="prd-toolbar__btn-icon" />
          <span>{exportingNativeMd ? '导出中…' : '导出原生 MD'}</span>
        </button>
      </div>
      {backupPathModalOpen ? (
        <BackupFolderPathModal
          slug={activeSlug}
          open={backupPathModalOpen}
          onClose={() => setBackupPathModalOpen(false)}
        />
      ) : null}
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
      {exportMdDialogOpen ? (
        <ExportPackageModal
          value={exportMdPackageName}
          error={exportMdPackageError}
          exporting={exportingNativeMd}
          inputRef={exportMdInputRef}
          onChange={(value) => {
            setExportMdPackageName(normalizeProjectLikeName(value));
            setExportMdPackageError('');
          }}
          onCancel={closeExportMdDialog}
          onConfirm={handleExportNativeMdWithPackageName}
        />
      ) : null}
    </div>
  );
}
