import { inferListPrefix } from '../../prd-list-utils.js';

export function hasOwnEnterField(payload, key) {
  return !!payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, key);
}

export function getEnterCurrentMarkdown(payload) {
  if (typeof payload === 'string') return payload;
  if (hasOwnEnterField(payload, 'currentMarkdown')) return payload.currentMarkdown ?? '';
  return undefined;
}

export function hasExplicitEnterNextMarkdown(payload) {
  return hasOwnEnterField(payload, 'nextMarkdown');
}

export function getEnterNextMarkdown(payload) {
  if (typeof payload === 'string') return inferListPrefix(payload) ?? '';
  if (hasExplicitEnterNextMarkdown(payload)) return payload.nextMarkdown ?? '';
  const currentMarkdown = getEnterCurrentMarkdown(payload);
  return currentMarkdown ? (inferListPrefix(currentMarkdown) ?? '') : '';
}
