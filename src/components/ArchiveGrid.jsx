import React, { forwardRef } from 'react';

const ArchiveGrid = forwardRef(function ArchiveGrid({ className = '', children, ...props }, forwardedRef) {
  return (
    <div ref={forwardedRef} className={['archive-grid', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  );
});

export default ArchiveGrid;
