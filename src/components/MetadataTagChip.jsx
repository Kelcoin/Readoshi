import React, { useLayoutEffect, useRef, useState } from 'react';
import { metadataTagFontScale } from '../lib/metadataTagLayout';

const CHIP_CHROME_WIDTH = 57;

export default function MetadataTagChip({ tag, translatedTag, revealed, onReveal, onHide, onToggle, onCopy, onDelete }) {
  const rootRef = useRef(null);
  const translatedMeasureRef = useRef(null);
  const originalMeasureRef = useRef(null);
  const lastPointerTypeRef = useRef('');
  const [textWidths, setTextWidths] = useState({ translated: 1, original: 1 });
  const [fontScale, setFontScale] = useState(1);

  useLayoutEffect(() => {
    const translated = Math.ceil(translatedMeasureRef.current?.scrollWidth || 1);
    const original = Math.ceil(originalMeasureRef.current?.scrollWidth || 1);
    setTextWidths({ translated, original });
  }, [tag, translatedTag]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    const updateScale = () => {
      const preferredTextWidth = revealed ? textWidths.original : textWidths.translated;
      setFontScale(metadataTagFontScale(root.clientWidth - CHIP_CHROME_WIDTH, preferredTextWidth));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(root);
    return () => observer.disconnect();
  }, [revealed, textWidths]);

  const preferredTextWidth = revealed
    ? Math.max(textWidths.translated, textWidths.original)
    : textWidths.translated;
  const preferredWidth = preferredTextWidth + CHIP_CHROME_WIDTH;

  return (
    <span
      ref={rootRef}
      className={`btn metadata-tag${revealed ? ' is-revealed' : ''}`}
      style={{
        '--metadata-tag-preferred-width': `${preferredWidth}px`,
        '--metadata-tag-font-scale': fontScale,
      }}
      onPointerDown={(event) => { lastPointerTypeRef.current = event.pointerType || ''; }}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') onReveal(); }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') onHide(); }}
    >
      <button
        type="button"
        className="metadata-tag-copy"
        aria-label={`复制标签 ${tag}`}
        aria-pressed={revealed}
        title={revealed ? tag : translatedTag}
        onClick={async () => {
          const revealOnTap = !!lastPointerTypeRef.current && lastPointerTypeRef.current !== 'mouse';
          lastPointerTypeRef.current = '';
          if (revealOnTap) onToggle();
          await onCopy();
        }}
      >
        <span className="metadata-tag-labels">
          <span className="metadata-tag-label metadata-tag-label-translated">{translatedTag}</span>
          <span className="metadata-tag-label metadata-tag-label-original">{tag}</span>
        </span>
      </button>
      <button type="button" className="metadata-tag-delete" aria-label={`删除 ${tag}`} title="删除标签" onClick={onDelete}>×</button>
      <span ref={translatedMeasureRef} className="metadata-tag-measure" aria-hidden="true">{translatedTag}</span>
      <span ref={originalMeasureRef} className="metadata-tag-measure" aria-hidden="true">{tag}</span>
    </span>
  );
}
