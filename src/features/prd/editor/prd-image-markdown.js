const PURE_IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/;

export function createImageElement(src, alt = '') {
  const imageSrc = String(src ?? '').trim();
  const imageAlt = String(alt ?? '');
  return imageAlt
    ? { type: 'image', src: imageSrc, alt: imageAlt }
    : { type: 'image', src: imageSrc };
}

export function parseMarkdownImage(markdown) {
  const match = String(markdown ?? '').match(PURE_IMAGE_RE);
  if (!match) return null;
  return {
    src: String(match[2] ?? '').trim(),
    alt: String(match[1] ?? ''),
  };
}

export function serializeMarkdownImage(src, alt = '') {
  return `![${String(alt ?? '')}](${String(src ?? '')})`;
}
