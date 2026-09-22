import { useState } from 'react';

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

/**
 * 同步成功后展示 MR 链接：只读输入框 + 一键复制。
 */
export function MergeRequestUrlCopyField({ url }) {
  const [copied, setCopied] = useState(false);
  if (!url) return null;

  async function handleCopy() {
    try {
      await writeClipboard(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="prd-modal__field prd-modal__mr-url">
      <label className="prd-modal__label" htmlFor="prd-sync-mr-url">Merge Request</label>
      <div className="prd-modal__mr-url-row">
        <input
          id="prd-sync-mr-url"
          className="prd-modal__input"
          type="text"
          value={url}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          className="prd-modal__btn prd-modal__btn--cancel"
          onClick={() => void handleCopy()}
          title="复制 MR 链接"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <div className="prd-modal__hint">
        已按默认规则创建 / 对齐 MR：目标分支 <code>develop</code>，不删除源分支。
      </div>
    </div>
  );
}
