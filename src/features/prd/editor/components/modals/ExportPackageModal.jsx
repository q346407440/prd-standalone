import { PRD_FILE_NAME_RULE_HINT } from '../../prd-constants.js';

const COPY = {
  offline: {
    title: '重命名离线包',
    desc: '仅影响下载的 ZIP 文件名，不会修改压缩包内部文件名。',
    label: '离线包名称',
    placeholder: '请输入离线包名称',
  },
  'native-md': {
    title: '重命名原生 MD 包',
    desc: '仅影响下载的 ZIP 文件名，不会修改包内 .md 与图片文件名。',
    label: '原生 MD 包名称',
    placeholder: '请输入原生 MD 包名称',
  },
};

export function ExportPackageModal({
  kind = 'offline',
  value,
  error,
  exporting,
  inputRef,
  onChange,
  onCancel,
  onConfirm,
}) {
  const copy = COPY[kind] || COPY.offline;
  return (
    <div className="prd-modal-overlay" onClick={onCancel}>
      <div className="prd-modal prd-modal--form" onClick={(e) => e.stopPropagation()}>
        <div className="prd-modal__header">
          <div className="prd-modal__title">{copy.title}</div>
          <div className="prd-modal__desc">{copy.desc}</div>
        </div>
        <div className="prd-modal__field">
          <label className="prd-modal__label" htmlFor="prd-export-package-name">{copy.label}</label>
          <input
            id="prd-export-package-name"
            ref={inputRef}
            className="prd-modal__input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onConfirm();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
              }
            }}
            disabled={exporting}
            placeholder={copy.placeholder}
          />
          <div className="prd-modal__hint">{PRD_FILE_NAME_RULE_HINT}</div>
          {error ? <div className="prd-modal__error">{error}</div> : null}
        </div>
        <div className="prd-modal__actions">
          <button className="prd-modal__btn prd-modal__btn--cancel" onClick={onCancel} disabled={exporting}>取消</button>
          <button className="prd-modal__btn prd-modal__btn--primary" onClick={onConfirm} disabled={exporting || !value.trim()}>
            {exporting ? '导出中…' : '确认导出'}
          </button>
        </div>
      </div>
    </div>
  );
}
