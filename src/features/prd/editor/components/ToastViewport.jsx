import { createPortal } from 'react-dom';
import { FiAlertCircle, FiAlertTriangle, FiCheckCircle } from 'react-icons/fi';

export function ToastIcon({ tone }) {
  if (tone === 'error') return <FiAlertCircle className="prd-toast__icon" />;
  if (tone === 'warning') return <FiAlertTriangle className="prd-toast__icon" />;
  return <FiCheckCircle className="prd-toast__icon" />;
}

export function ToastViewport({ toasts }) {
  if (!toasts.length) return null;
  return createPortal(
    <div className="prd-toast-viewport" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={[
            'prd-toast',
            `prd-toast--${toast.tone}`,
            toast.visible ? 'prd-toast--visible' : 'prd-toast--hidden',
          ].filter(Boolean).join(' ')}
        >
          <ToastIcon tone={toast.tone} />
          <span className="prd-toast__text">{toast.message}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}
