export const PRD_TOAST_EVENT = 'prd:toast';

export function emitPrdToast(message, options = {}) {
  if (!message || typeof window === 'undefined') return;
  const {
    tone = 'success',
    duration = 1800,
    id,
  } = options;
  window.dispatchEvent(new CustomEvent(PRD_TOAST_EVENT, {
    detail: { id, message, tone, duration },
  }));
}
