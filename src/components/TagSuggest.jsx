import React, { useState, useEffect, useRef, useCallback } from 'react';
import { searchTags, isDBReady, NAMESPACE_COLORS_MAP, NS_CN_LABELS } from '../lib/tags';

const COLORS = NAMESPACE_COLORS_MAP || {};

const NS_COLORS = {
  artist: COLORS.artist || '#f0ad4e',
  parody: COLORS.parody || '#5bc0de',
  category: COLORS.category || '#a0e7e5',
  character: COLORS.character || '#a5dc86',
  female: COLORS.female || '#f27474',
  male: COLORS.male || '#74b9ff',
  group: COLORS.group || '#a29bfe',
  series: COLORS.series || '#fd79a8',
  language: COLORS.language || '#55efc4',
  date_added: COLORS.date_added || '#8899aa',
  timestamp: COLORS.timestamp || '#8899aa',
  source: COLORS.source || '#7ec8e3',
  general: COLORS.general || '#b2bec3'
};

export default function TagSuggest({ inputValue, onSelectTag, containerRef, onSetActive }) {
  const [suggestions, setSuggestions] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [visible, setVisible] = useState(false);
  const listRef = useRef(null);
  const debounceRef = useRef(null);
  const dismissTimerRef = useRef(null);
  const [panelShift, setPanelShift] = useState(0); // mobile: px to shift panel left

  const updateSuggestions = useCallback((val) => {
    if (!isDBReady()) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (typeof val !== 'undefined') updateSuggestions(val);
      }, 300);
      return;
    }

    const raw = (val || '');
    const lastSep = raw.lastIndexOf(',');
    const segment = (lastSep >= 0 ? raw.slice(lastSep + 1) : raw).trim();
    if (segment.length === 0) {
      setSuggestions([]);
      setVisible(false);
      return;
    }

    const results = searchTags(segment);
    if (results.length > 0) {
      setSuggestions(results);
      setVisible(true);
    } else {
      setSuggestions([]);
      setVisible(false);
    }
  }, []);

  useEffect(() => {
    updateSuggestions(inputValue);
    setActiveIndex(-1);
  }, [inputValue, updateSuggestions]);

  useEffect(() => {
    if (onSetActive) onSetActive(visible);
  }, [visible, onSetActive]);

  // Calculate horizontal shift for mobile panel (pull to viewport edge)
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 600;
  useEffect(() => {
    if (!visible || !isNarrow || !containerRef?.current) {
      setPanelShift(0);
      return;
    }
    const parent = containerRef.current.parentElement;
    if (parent) {
      const parentRect = parent.getBoundingClientRect();
      setPanelShift(parentRect.left - 16);
    }
  }, [visible, isNarrow, containerRef]);

  // ── Dismiss on outside click/tap ──
  // Panel uses stopPropagation to prevent events from reaching document.
  // Any event that reaches the document listener is from outside the panel.
  useEffect(() => {
    if (!visible) return;

    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    let armed = false;
    dismissTimerRef.current = setTimeout(() => { armed = true; }, 200);

    const handleDismiss = (e) => {
      if (!armed) return;
      // Allow clicks on the input itself (containerRef)
      if (containerRef?.current && containerRef.current.contains(e.target)) return;
      setVisible(false);
    };

    document.addEventListener('mousedown', handleDismiss);
    document.addEventListener('touchstart', handleDismiss, { passive: true });
    return () => {
      armed = false;
      clearTimeout(dismissTimerRef.current);
      document.removeEventListener('mousedown', handleDismiss);
      document.removeEventListener('touchstart', handleDismiss);
    };
  }, [visible, containerRef]);

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current && visible) {
      const items = listRef.current.querySelectorAll('[data-suggest-index]');
      if (items[activeIndex]) {
        items[activeIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeIndex, visible]);

  const selectItem = useCallback((item) => {
    const tag = `${item.ns}:${item.key}$`;
    onSelectTag(tag);
    setVisible(false);
    setSuggestions([]);
  }, [onSelectTag]);

  const handleKeyDown = useCallback((e) => {
    if (!visible || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        selectItem(suggestions[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setVisible(false);
    }
  }, [visible, suggestions, activeIndex, selectItem]);

  if (!visible || suggestions.length === 0) return null;

  const basePanel = {
    overflowY: 'auto',
    overflowX: 'hidden',
    WebkitOverflowScrolling: 'touch',
    background: 'rgba(22, 24, 32, 0.98)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '12px',
    boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
    padding: '6px 0',
  };

  // Desktop: absolute, anchored below the input
  // Mobile: absolute with negative left shift, fills viewport width
  let panelStyle;
  if (isNarrow) {
    panelStyle = {
      ...basePanel,
      position: 'absolute',
      left: -panelShift,
      width: 'calc(100vw - 32px)',
      maxWidth: '400px',
      top: 'calc(100% + 4px)',
      maxHeight: '50vh',
      borderRadius: '16px',
      zIndex: 9999,
    };
  } else {
    panelStyle = {
      ...basePanel,
      position: 'absolute',
      top: 'calc(100% + 4px)',
      left: 0,
      width: '100%',
      maxHeight: '320px',
      zIndex: 200,
    };
  }

  return (
    <div onKeyDown={handleKeyDown} tabIndex={-1} style={{ outline: 'none', position: 'relative' }}>
      <div
        ref={listRef}
        className="dropdown-animate no-scrollbar"
        style={panelStyle}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        {suggestions.map((item, idx) => {
          const ns = item.ns;
          const key = item.key;
          const label = item.label;
          const tag = `${ns}:${key}$`;
          const nsColor = NS_COLORS[ns] || NS_COLORS.general;
          const nsLabel = (NS_CN_LABELS && NS_CN_LABELS[ns]) || ns;

          // ── Responsive item layout ──
          // Desktop: [badge] [label (flex:1, ellipsis)] [tag]
          // Mobile: row1=[badge][label (flex:1, ellipsis)] / row2=[tag (small, gray)]
          if (isNarrow) {
            return (
              <div
                key={`${ns}|${key}`}
                data-suggest-index={idx}
                onMouseDown={(e) => { e.preventDefault(); selectItem(item); }}
                onClick={(e) => { e.preventDefault(); selectItem(item); }}
                onMouseEnter={() => setActiveIndex(idx)}
                style={{
                  padding: '8px 14px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  background: activeIndex === idx ? 'rgba(255,255,255,0.1)' : 'transparent',
                  transition: 'background 0.1s',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                }}
              >
                {/* Row 1: badge + Chinese label */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <span style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    color: nsColor,
                    background: `${nsColor}22`,
                    border: `1px solid ${nsColor}44`,
                    borderRadius: '4px',
                    padding: '1px 5px',
                    whiteSpace: 'nowrap',
                    minWidth: '36px',
                    textAlign: 'center',
                    flexShrink: 0,
                  }}>
                    {nsLabel}
                  </span>
                  <span style={{
                    color: '#e0e6f0',
                    fontSize: '13px',
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {label}
                  </span>
                </div>
                {/* Row 2: original tag (small, gray) */}
                <span style={{
                  fontSize: '10px',
                  color: '#888',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  paddingLeft: '46px',
                }}>
                  {tag.length > 36 ? tag.slice(0, 36) + '...' : tag}
                </span>
              </div>
            );
          }

          // ── Desktop layout ──
          return (
            <div
              key={`${ns}|${key}`}
              data-suggest-index={idx}
              onMouseDown={(e) => { e.preventDefault(); selectItem(item); }}
              onMouseEnter={() => setActiveIndex(idx)}
              style={{
                padding: '7px 14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '13px',
                background: activeIndex === idx ? 'rgba(255,255,255,0.1)' : 'transparent',
                transition: 'background 0.1s',
                userSelect: 'none',
              }}
            >
              <span style={{
                fontSize: '10px',
                fontWeight: 600,
                color: nsColor,
                background: `${nsColor}22`,
                border: `1px solid ${nsColor}44`,
                borderRadius: '4px',
                padding: '1px 5px',
                whiteSpace: 'nowrap',
                minWidth: '36px',
                textAlign: 'center',
                flexShrink: 0,
              }}>
                {nsLabel}
              </span>
              <span style={{ color: '#e0e6f0', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {label}
              </span>
              <span style={{ fontSize: '10px', color: '#888', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {tag.length > 30 ? tag.slice(0, 30) + '...' : tag}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
