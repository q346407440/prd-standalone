import { useEffect, useState } from 'react';
import { fetchBackupDocDir } from '../../prd-api.js';

export function BackupFolderPathModal({ slug, open, onClose }) {
  const [loading, setLoading] = useState(true);
  const [backupDir, setBackupDir] = useState('');
  const [slots, setSlots] = useState([]);
  const [backupExists, setBackupExists] = useState(false);
  const [error, setError] = useState('');
  const [copiedKey, setCopiedKey] = useState('');

  useEffect(() => {
    if (!open || !slug) return undefined;
    let cancelled = false;
    setLoading(true);
    setBackupDir('');
    setSlots([]);
    setError('');
    setCopiedKey('');
    fetchBackupDocDir(slug)
      .then((data) => {
        if (cancelled) return;
        setBackupDir(data.backupDir);
        setSlots(Array.isArray(data.slots) ? data.slots : []);
        setBackupExists(!!data.backupExists);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || '加载失败');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, slug]);

  async function copyPath(text, key) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(''), 2000);
    } catch {
      setCopiedKey('');
    }
  }

  if (!open) return null;

  return (
    <div className="prd-modal-overlay" onClick={onClose} role="presentation">
      <div className="prd-modal prd-modal--form" onClick={(e) => e.stopPropagation()}>
        <div className="prd-modal__header">
          <div className="prd-modal__title">本地备份目录</div>
          <div className="prd-modal__desc">
            同一文档在 <code className="prd-backup-path-modal__code">s0</code>、
            <code className="prd-backup-path-modal__code">s1</code>
            两个文件夹中轮替保存：两槽都有内容后，每次定时备份会覆盖「较早写入」的那一栏，另一栏仍保留上一份快照。
            {!backupExists && !loading && !error ? ' 当前尚未有任何槽位内容（未成功备份过或已删除）。' : null}
          </div>
        </div>
        <div className="prd-modal__field prd-backup-path-modal__body">
          {loading ? (
            <div className="prd-backup-path-modal__loading">加载中…</div>
          ) : error ? (
            <div className="prd-modal__error">{error}</div>
          ) : (
            <>
              <div className="prd-backup-path-modal__section-title">备份根目录（内含 s0 / s1）</div>
              <div className="prd-backup-path-modal__path-row">
                <div className="prd-backup-path-modal__path" title={backupDir}>{backupDir}</div>
                <button
                  type="button"
                  className="prd-backup-path-modal__copy-btn"
                  onClick={() => copyPath(backupDir, 'root')}
                >
                  {copiedKey === 'root' ? '已复制' : '复制'}
                </button>
              </div>
              {slots.length > 0 ? (
                <>
                  <div className="prd-backup-path-modal__section-title">各槽位路径</div>
                  <ul className="prd-backup-path-modal__slot-list">
                    {slots.map((s) => (
                      <li key={s.name} className="prd-backup-path-modal__slot-item">
                        <div className="prd-backup-path-modal__slot-head">
                          <span className="prd-backup-path-modal__slot-name">{s.name}</span>
                          <span className={s.exists ? 'prd-backup-path-modal__slot-badge' : 'prd-backup-path-modal__slot-badge prd-backup-path-modal__slot-badge--empty'}>
                            {s.exists ? '有内容' : '空'}
                          </span>
                        </div>
                        <div className="prd-backup-path-modal__path-row">
                          <div className="prd-backup-path-modal__path" title={s.path}>{s.path}</div>
                          <button
                            type="button"
                            className="prd-backup-path-modal__copy-btn"
                            onClick={() => copyPath(s.path, s.name)}
                          >
                            {copiedKey === s.name ? '已复制' : '复制'}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          )}
        </div>
        <div className="prd-modal__actions">
          <button type="button" className="prd-modal__btn prd-modal__btn--cancel" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
