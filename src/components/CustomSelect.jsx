import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function CustomSelect({ value, options, onChange, style, compact }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && containerRef.current.contains(e.target)) return;
      if (dropdownRef.current && dropdownRef.current.contains(e.target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => opt.value === value);
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 480;

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', minWidth: compact ? (isNarrow ? '80px' : '100px') : '150px', ...style }}>
      <div 
        ref={triggerRef}
        className="input-glass"
        style={{ 
          cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
          userSelect: 'none',
          padding: compact && isNarrow ? '6px 8px' : undefined,
          background: isOpen ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.05)',
          borderColor: isOpen ? 'var(--accent)' : 'var(--glass-border)'
        }}
        onClick={() => {
            if (!isOpen && triggerRef.current) {
              const r = triggerRef.current.getBoundingClientRect();
              setPos({ top: r.bottom + 8, left: r.left, width: r.width });
            }
            setIsOpen(prev => !prev);
          }}
      >
        <span style={{ fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selectedOption ? selectedOption.label : '请选择...'}
        </span>
        <span style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s', fontSize: '10px', color: 'var(--text-sub)', flexShrink: 0 }}>▼</span>
      </div>

      {isOpen && createPortal(
        <div ref={dropdownRef} className="glass-panel dropdown-animate" data-select-dropdown="true" style={{
          position: 'fixed', top: pos.top, left: pos.left, width: pos.width || 'auto',
          zIndex: 99999, padding: '8px 0', maxHeight: '250px', overflowY: 'auto',
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)'
        }}>
          {options.map(opt => (
            <div
              key={opt.value}
              style={{
                padding: '10px 16px', cursor: 'pointer', fontSize: '14px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: opt.value === value ? 'rgba(74, 159, 240, 0.15)' : 'transparent',
                color: opt.value === value ? 'var(--accent)' : 'var(--text-main)',
                transition: 'background 0.2s'
              }}
              onMouseEnter={(e) => { if(opt.value !== value) e.target.style.background = 'rgba(255, 255, 255, 0.08)' }}
              onMouseLeave={(e) => { if(opt.value !== value) e.target.style.background = 'transparent' }}
              onClick={() => { onChange(opt.value); setIsOpen(false); }}
            >
              <span>{opt.label}</span>
              {opt.value === value && <span style={{ fontSize: '14px' }}>✔</span>}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}