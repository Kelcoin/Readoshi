import React from 'react';

export default function SettingHint({ text, children, className = 'settings-row-title' }) {
  return (
    <span className="settings-hint-wrap" tabIndex={0}>
      <span className={className}>{children}</span>
      {text && <span className="settings-hint-bubble" role="tooltip">{text}</span>}
    </span>
  );
}
