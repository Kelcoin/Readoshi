import React from 'react';

const PROJECT_URL = 'https://github.com/Kelcoin/Lanraragi-React-Reader';

export default function AppVersion({ compact = false }) {
  return (
    <div className="app-version-link" style={{ fontSize: compact ? 11 : 12 }}>
      <span>{__APP_VERSION__}</span>
      <a href={PROJECT_URL} target="_blank" rel="noreferrer">GitHub</a>
    </div>
  );
}
