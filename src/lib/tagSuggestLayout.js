export function getTagSuggestPlacement(rect, viewportWidth, viewportHeight, {
  gap = 6,
  viewportGap = 12,
  maxHeight = 320,
  viewportLeft = 0,
  viewportTop = 0,
  viewportRight = viewportWidth,
  viewportBottom = viewportHeight,
} = {}) {
  const boundsLeft = Number.isFinite(viewportLeft) ? viewportLeft : 0;
  const boundsTop = Number.isFinite(viewportTop) ? viewportTop : 0;
  const boundsRight = Number.isFinite(viewportRight) ? viewportRight : viewportWidth;
  const boundsBottom = Number.isFinite(viewportBottom) ? viewportBottom : viewportHeight;
  const availableWidth = Math.max(0, boundsRight - boundsLeft - viewportGap * 2);
  const width = Math.min(Math.max(0, rect.width), availableWidth);
  const left = Math.max(
    boundsLeft + viewportGap,
    Math.min(rect.left, boundsRight - width - viewportGap),
  );
  const below = Math.max(0, boundsBottom - rect.bottom - gap - viewportGap);
  const above = Math.max(0, rect.top - gap - viewportGap - boundsTop);
  const openAbove = below < 180 && above > below;
  const placement = {
    left,
    width,
    maxHeight: Math.min(maxHeight, openAbove ? above : below),
  };
  if (openAbove) placement.bottom = boundsBottom - rect.top + gap;
  else placement.top = rect.bottom + gap;
  return placement;
}
