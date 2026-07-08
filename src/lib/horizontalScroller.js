import { useCallback, useEffect, useRef } from 'react';

export function markHorizontalScrollActivity(el) {
  if (!el) return;
  el.dataset.scrollBlock = '1';
  clearTimeout(el.__horizontalScrollTimer);
  el.__horizontalScrollTimer = setTimeout(() => { delete el.dataset.scrollBlock; }, 300);
}

export function useHorizontalScroller() {
  const scrollerElRef = useRef(null);
  const dragStateRef = useRef({
    active: false,
    el: null,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
    suppressClick: false,
    prevUserSelect: '',
  });

  const finishDrag = useCallback(() => {
    const state = dragStateRef.current;
    if (!state.active) return;
    state.active = false;
    if (state.el) state.el.style.cursor = '';
    document.body.style.userSelect = state.prevUserSelect || '';
    window.removeEventListener('mousemove', handleWindowMouseMove);
    window.removeEventListener('mouseup', finishDrag);
    window.removeEventListener('blur', finishDrag);
  }, []);

  const handleWindowMouseMove = useCallback((e) => {
    const state = dragStateRef.current;
    if (!state.active || !state.el) return;
    const delta = e.clientX - state.startX;
    if (!state.moved && Math.abs(delta) < 4) return;
    state.moved = true;
    state.suppressClick = true;
    state.el.scrollLeft = state.startScrollLeft - delta;
    markHorizontalScrollActivity(state.el);
    if (e.cancelable) e.preventDefault();
  }, []);

  useEffect(() => () => {
    finishDrag();
  }, [finishDrag]);

  const handleWheel = useCallback((e) => {
    if (e.ctrlKey) return;
    const el = e.currentTarget || scrollerElRef.current;
    if (!el || el.scrollWidth <= el.clientWidth + 1) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (delta === 0) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    el.scrollLeft += delta * 2.4;
    markHorizontalScrollActivity(el);
  }, []);

  const setScrollerRef = useCallback((node) => {
    const prev = scrollerElRef.current;
    if (prev === node) return;
    if (prev) prev.removeEventListener('wheel', handleWheel, true);
    scrollerElRef.current = node;
    if (node) node.addEventListener('wheel', handleWheel, { capture: true, passive: false });
  }, [handleWheel]);

  useEffect(() => () => {
    if (scrollerElRef.current) {
      scrollerElRef.current.removeEventListener('wheel', handleWheel, true);
      scrollerElRef.current = null;
    }
  }, [handleWheel]);

  const onWheelCapture = useCallback(() => {
    // Native passive:false listener does the real wheel lock. Keeping this
    // prop harmless preserves existing call sites during incremental rollout.
  }, []);

  const onScroll = useCallback((e) => {
    markHorizontalScrollActivity(e.currentTarget);
  }, []);

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    if (!el || el.scrollWidth <= el.clientWidth + 1) return;
    dragStateRef.current.active = true;
    dragStateRef.current.el = el;
    dragStateRef.current.startX = e.clientX;
    dragStateRef.current.startScrollLeft = el.scrollLeft;
    dragStateRef.current.moved = false;
    dragStateRef.current.suppressClick = false;
    dragStateRef.current.prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    el.style.cursor = 'grabbing';
    window.addEventListener('mousemove', handleWindowMouseMove, { passive: false });
    window.addEventListener('mouseup', finishDrag, { passive: true });
    window.addEventListener('blur', finishDrag, { passive: true });
  }, [finishDrag, handleWindowMouseMove]);

  const onClickCapture = useCallback((e) => {
    if (!dragStateRef.current.suppressClick) return;
    dragStateRef.current.suppressClick = false;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
  }, []);

  const onDragStart = useCallback((e) => {
    if (e.cancelable) e.preventDefault();
  }, []);

  const getTouchScrollStyle = useCallback(() => ({
    touchAction: 'auto',
    WebkitOverflowScrolling: 'touch',
    overscrollBehaviorX: 'contain',
  }), []);

  const getMouseScrollStyle = useCallback(() => ({
    cursor: 'grab',
  }), []);

  const getNode = useCallback(() => scrollerElRef.current, []);

  return {
    ref: setScrollerRef,
    getNode,
    onWheelCapture,
    onScroll,
    onMouseDown,
    onClickCapture,
    onDragStart,
    getTouchScrollStyle,
    getMouseScrollStyle,
  };
}
