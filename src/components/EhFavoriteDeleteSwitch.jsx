import React from 'react';
import ToggleSwitch from './ToggleSwitch';

export default function EhFavoriteDeleteSwitch({ checked, onChange, disabled = false }) {
  return (
    <label style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '14px',
      fontSize: '13px',
      color: 'var(--text-main)',
      padding: '10px 12px',
      borderRadius: '10px',
      background: 'rgba(255,255,255,0.045)',
      border: '1px solid rgba(174,191,214,0.12)',
    }}>
      <span>同步从 EH/EX 收藏夹移除</span>
      <ToggleSwitch label="同步从 EH/EX 收藏夹移除" checked={checked} onChange={onChange} disabled={disabled} />
    </label>
  );
}
