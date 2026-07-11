export function rectsOverlap(a, b, margin = 6) {
  if (!a || !b) return false;
  const expanded = { left: a.left - margin, right: a.right + margin, top: a.top - margin, bottom: a.bottom + margin };
  return Math.min(expanded.right, b.right) - Math.max(expanded.left, b.left) >= 1
    && Math.min(expanded.bottom, b.bottom) - Math.max(expanded.top, b.top) >= 1;
}
export function computeContainedImageRect(box, naturalWidth, naturalHeight) {
  if (!box || naturalWidth <= 0 || naturalHeight <= 0) return box;
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2,
    right: box.left + (box.width + width) / 2, bottom: box.top + (box.height + height) / 2, width, height };
}
