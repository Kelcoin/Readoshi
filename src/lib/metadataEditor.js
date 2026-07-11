export function parseTags(value) {
  const seen = new Set();
  return String(value || '').split(',').map(tag => tag.trim()).filter(tag => {
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function mergeTags(current, incoming) { return parseTags([...current, ...parseTags(incoming)].join(',')); }
export function metadataFingerprint(value = {}) { return JSON.stringify([value.title || '', value.summary || '', parseTags(value.tags).join(',')]); }
