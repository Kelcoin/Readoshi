import React, {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ARCHIVE_CARD_WIDTH, getArchiveCardMove, packArchiveGridItems } from '../lib/archiveGridLayout';

const ArchiveGrid = forwardRef(function ArchiveGrid({ className = '', children, ...props }, forwardedRef) {
  const gridRef = useRef(null);
  const widthsRef = useRef(new Map());
  const previousRectsRef = useRef(new Map());
  const animationsRef = useRef(new Map());
  const [layout, setLayout] = useState({ width: 0, gap: 0, revision: 0 });

  const setGridRef = useCallback((node) => {
    gridRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  const reportItemWidth = useCallback((key, width) => {
    if (!key || (widthsRef.current.get(key) ?? ARCHIVE_CARD_WIDTH) === width) return;
    if (width === ARCHIVE_CARD_WIDTH) widthsRef.current.delete(key);
    else widthsRef.current.set(key, width);
    setLayout((current) => ({ ...current, revision: current.revision + 1 }));
  }, []);

  useLayoutEffect(() => {
    const node = gridRef.current;
    if (!node) return undefined;

    const measure = () => {
      const nextWidth = node.clientWidth;
      const nextGap = Number.parseFloat(window.getComputedStyle(node).columnGap) || 0;
      setLayout((current) => (
        current.width === nextWidth && current.gap === nextGap
          ? current
          : { ...current, width: nextWidth, gap: nextGap }
      ));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const activeKeys = new Set(Children.toArray(children).map((element) => String(element.key)));
    for (const key of widthsRef.current.keys()) {
      if (!activeKeys.has(key)) widthsRef.current.delete(key);
    }
  }, [children]);

  const packedChildren = useMemo(() => {
    const items = Children.toArray(children).map((element) => ({
      element,
      key: String(element.key),
      width: widthsRef.current.get(String(element.key)) ?? ARCHIVE_CARD_WIDTH,
    }));
    const packed = packArchiveGridItems(items, layout.width, layout.gap);

    return packed.map(({ element, key }) => (
      isValidElement(element)
        ? cloneElement(element, {
            archiveGridItemKey: key,
            archiveGridChildrenVersion: children,
            archiveGridLayoutVersion: `${layout.width}:${layout.gap}:${layout.revision}`,
            onArchiveGridWidthChange: reportItemWidth,
          })
        : element
    ));
  }, [children, layout.gap, layout.revision, layout.width, reportItemWidth]);

  useLayoutEffect(() => {
    const node = gridRef.current;
    if (!node) return;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const nextRects = new Map();

    for (const element of node.children) {
      const key = element.dataset.archiveGridKey;
      if (!key) continue;

      const nextRect = { left: element.offsetLeft, top: element.offsetTop };
      const previousRect = previousRectsRef.current.get(key);
      const logicalMove = getArchiveCardMove(previousRect, nextRect);
      nextRects.set(key, nextRect);
      if (!logicalMove) continue;

      const activeAnimation = animationsRef.current.get(key);
      const animatedRect = activeAnimation ? element.getBoundingClientRect() : null;
      activeAnimation?.cancel();
      const settledRect = activeAnimation ? element.getBoundingClientRect() : null;
      const animationOffset = activeAnimation ? {
        x: animatedRect.left - settledRect.left,
        y: animatedRect.top - settledRect.top,
      } : null;
      const move = animationOffset
        ? getArchiveCardMove(previousRect, nextRect, animationOffset)
        : logicalMove;

      if (!move || reduceMotion || typeof element.animate !== 'function') continue;
      const animation = element.animate(
        [
          { translate: `${move.x}px ${move.y}px` },
          { translate: '0px 0px' },
        ],
        {
          duration: 220,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
      );
      animationsRef.current.set(key, animation);
      const clear = () => {
        if (animationsRef.current.get(key) === animation) animationsRef.current.delete(key);
      };
      animation.onfinish = clear;
      animation.oncancel = clear;
    }

    previousRectsRef.current = nextRects;
  }, [packedChildren]);

  useEffect(() => () => {
    for (const animation of animationsRef.current.values()) animation.cancel();
    animationsRef.current.clear();
    previousRectsRef.current.clear();
  }, []);

  return (
    <div ref={setGridRef} className={['archive-grid', className].filter(Boolean).join(' ')} {...props}>
      {packedChildren}
    </div>
  );
});

export default ArchiveGrid;
