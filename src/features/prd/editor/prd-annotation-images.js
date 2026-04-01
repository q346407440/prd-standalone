function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export async function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`图片加载失败: ${src}`));
    image.src = `${src}${src.includes('?') ? '&' : '?'}t=${Date.now()}`;
  });
}

function stripDataUrlPrefix(dataUrl) {
  const idx = String(dataUrl).indexOf(',');
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

export function buildCropBase64(image, bbox) {
  const sx = Math.max(0, Math.round(bbox.x));
  const sy = Math.max(0, Math.round(bbox.y));
  const sw = Math.max(1, Math.round(bbox.w));
  const sh = Math.max(1, Math.round(bbox.h));
  const canvas = createCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  return stripDataUrlPrefix(canvas.toDataURL('image/png'));
}

export function buildFocusBase64(image, bbox, label) {
  const canvas = createCanvas(image.naturalWidth, image.naturalHeight);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  ctx.fillStyle = 'rgba(17, 24, 39, 0.42)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.clearRect(bbox.x, bbox.y, bbox.w, bbox.h);
  ctx.save();
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = Math.max(4, Math.round(canvas.width / 240));
  ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
  ctx.fillStyle = '#ef4444';
  const fontSize = Math.max(18, Math.round(canvas.width / 36));
  ctx.font = `700 ${fontSize}px Arial`;
  const paddingX = Math.max(12, Math.round(fontSize * 0.6));
  const paddingY = Math.max(8, Math.round(fontSize * 0.45));
  const metrics = ctx.measureText(label);
  const boxWidth = metrics.width + paddingX * 2;
  const boxHeight = fontSize + paddingY * 2;
  const left = bbox.x;
  const top = Math.max(0, bbox.y - boxHeight - 10);
  ctx.fillRect(left, top, boxWidth, boxHeight);
  ctx.fillStyle = '#fff';
  ctx.fillText(label, left + paddingX, top + boxHeight - paddingY - 2);
  ctx.restore();
  return stripDataUrlPrefix(canvas.toDataURL('image/png'));
}
