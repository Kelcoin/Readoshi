export function isNearWhite({ l = 0, chroma = 0 } = {}) {
  return l > 0.94 && chroma < 0.025;
}

export function classifyWebtoonSeams(seams, { minimumValid = 3, threshold = 0.65 } = {}) {
  const valid = seams.filter(seam => seam.validRatio >= 0.12 && !seam.white);
  if (valid.length < minimumValid) return { isWebtoon: false, confidence: 0, validSeams: valid.length };
  const continuous = valid.filter(seam => seam.medianDelta < 0.045 && seam.p75Delta < 0.08).length;
  const confidence = continuous / valid.length;
  return { isWebtoon: confidence >= threshold, confidence, validSeams: valid.length };
}

function rgbDistance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 441.7; }
function whitePixel(pixel) { const max = Math.max(...pixel), min = Math.min(...pixel); return min > 240 && max - min < 10; }

export function compareSeamPixels(bottom, top) {
  const deltas = [];
  const length = Math.min(bottom.length, top.length);
  for (let index = 0; index + 3 < length; index += 4) {
    const a = [bottom[index], bottom[index + 1], bottom[index + 2]];
    const b = [top[index], top[index + 1], top[index + 2]];
    if (whitePixel(a) || whitePixel(b)) continue;
    deltas.push(rgbDistance(a, b));
  }
  deltas.sort((a, b) => a - b);
  return { white: deltas.length === 0, validRatio: deltas.length / Math.max(1, length / 4), medianDelta: deltas[Math.floor(deltas.length * .5)] ?? 1, p75Delta: deltas[Math.floor(deltas.length * .75)] ?? 1 };
}

export async function sampleImageSeam(image, edge, { width = 96, strip = 16 } = {}) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = strip;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const sourceY = edge === 'top' ? 0 : Math.max(0, image.naturalHeight - strip);
  context.drawImage(image, 0, sourceY, image.naturalWidth, Math.min(strip, image.naturalHeight), 0, 0, width, strip);
  return context.getImageData(0, 0, width, strip).data;
}
