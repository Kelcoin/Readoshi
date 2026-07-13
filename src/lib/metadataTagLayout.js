export function metadataTagFontScale(availableWidth, preferredWidth) {
  const available = Math.max(0, Number(availableWidth) || 0);
  const preferred = Math.max(1, Number(preferredWidth) || 1);
  return Math.round(Math.max(0.72, Math.min(1, available / preferred)) * 100) / 100;
}
