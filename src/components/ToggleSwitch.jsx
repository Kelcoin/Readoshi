import React from 'react';

export default function ToggleSwitch({ checked, onChange, disabled = false, label }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} style={{
    width: 38, height: 22, borderRadius: 999, padding: 2, border: `1px solid ${checked ? 'rgba(141,216,255,.68)' : 'rgba(255,255,255,.18)'}`,
    background: checked ? 'rgba(88,183,255,.34)' : 'rgba(255,255,255,.08)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .5 : 1,
    display: 'flex', alignItems: 'center', justifyContent: checked ? 'flex-end' : 'flex-start', transition: 'all .2s ease', flexShrink: 0,
  }}><span style={{ width: 16, height: 16, borderRadius: '50%', background: checked ? '#9be2ff' : '#a9b0bc', boxShadow: checked ? '0 0 8px rgba(88,183,255,.55)' : 'none', transition: 'all .2s ease' }} /></button>;
}
