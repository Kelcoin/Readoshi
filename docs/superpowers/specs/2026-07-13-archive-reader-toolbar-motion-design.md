# Archive Selection, Reader Toolbar, and Refresh Motion Design

## Goal

Improve archive selection layout, reader toolbar stability, archive refresh continuity, and metadata access without changing data sources or navigation behavior.

## Scope

- Move archive bulk actions to an animated second toolbar row.
- Merge reader history and watchlist access into one archive-list panel with tabs.
- Keep reader skeleton and loaded toolbar geometry identical.
- Standardize icon-button outer dimensions.
- Animate archive-grid refresh replacement.
- Move reader metadata editing into the thumbnail drawer heading.

No new dependency, route, persistence format, or API call is required.

## Archive Selection Toolbar

The first row keeps the section heading, archive count, selected count, selection-mode toggle, and refresh button. When selection mode is active, a second row expands below it and contains:

- `全选当前` / `取消全选`
- `删除所选`

The second row remains mounted so closing animation can run. Animate only opacity and transform; use a grid-row wrapper to reserve or collapse layout space without measuring DOM height. Disable pointer events and remove descendants from keyboard order while collapsed. Preserve the existing confirmation dialog before deletion.

## Reader Toolbar and Skeleton

Normal reader mode uses these controls:

- Left group: back, archive list.
- Right group: immersive mode, set cover, reader settings, thumbnail drawer.

The archive-list button replaces separate history and watchlist buttons. The metadata button leaves the toolbar. Mobile icon buttons share one fixed outer width and height, identical padding, box sizing, border, and glyph size. Desktop buttons share height and explicit transitions. All icon-only buttons provide `title` and `aria-label`.

The skeleton derives its groups from the same normalized toolbar model and renders the same number and dimensions of placeholders. Flex groups allow shrinking without overlap; title remains truncatable.

## Unified Archive List Panel

Reuse the existing `ReaderArchiveListPanel`. One panel receives an active type of `history` or `watchlist`. Its heading contains a two-button segmented control:

- `阅读历史`
- `待看归档`

Opening the toolbar button shows the panel with the last active tab for the current reader mount. Clicking the active toolbar button closes it. Changing tabs swaps list data, empty message, metadata formatting, and delete behavior without closing the panel. The tab group uses buttons, `aria-pressed`, visible focus, and an accessible group label.

Panel state stays local because it is transient reader UI and does not need a shareable URL.

## Archive Refresh Motion

Manual refresh keeps current cards visible while the request runs. The grid enters an exit phase using opacity and a small scale change. When fresh data arrives, React applies the new archive list and the grid enters from the matching start state to full opacity and scale. If refresh fails, the existing list returns to the visible state.

The transition is interruptible and does not block refresh controls longer than the request. Initial load, infinite append, filters, pagination, selection deletion, and restored snapshots keep their current behavior. Reduced-motion users receive an immediate content swap.

## Thumbnail Drawer Metadata Action

The drawer heading becomes three zones:

- `归档信息` heading
- metadata edit button immediately to its right
- close button aligned at the far right

Metadata edit keeps the existing `navigateToMetadata(archiveId)` behavior. It uses the existing metadata glyph, fixed icon-button dimensions, `title="编辑元数据"`, and `aria-label="编辑元数据"`.

## Styling and Accessibility

- Add focused CSS classes instead of more divergent inline button dimensions.
- Never use `transition: all`; list animated properties.
- Honor `prefers-reduced-motion: reduce` for new motion.
- Animate opacity and transform for card content.
- Keep visible `:focus-visible` treatment for new controls.
- Mark decorative SVGs hidden from assistive technology where the button already has a label.
- Preserve minimum touch target size for mobile toolbar buttons.

## Failure Handling

- Refresh failure keeps old archives and restores full grid visibility.
- Empty history or watchlist displays its existing empty state.
- Metadata navigation remains disabled only when no archive ID exists.
- Bulk deletion stays disabled with zero selected archives or while deletion runs.

## Testing

Create failing checks before product changes for:

- normalized reader toolbar groups contain two left and four right controls;
- archive-list panel mode selects correct title, items, empty message, and deletion action;
- refresh phase reducer covers idle, exiting, entering, and failed restoration;
- selection toolbar accessibility state matches expanded/collapsed state.

Then run all checks, ESLint, production build, and a focused Web Interface Guidelines review of `Home.jsx`, `Reader.jsx`, `readerSkeletonLayout.js`, and `index.css`.

Manual verification widths: narrow mobile, screenshot-sized tablet, and desktop. Verify skeleton-to-reader transition, rapid panel tab switching, reduced motion, refresh success/failure, selection expand/collapse, and drawer metadata navigation.

## Acceptance Criteria

1. Bulk actions appear on a new row below selection cancel and refresh, with smooth open/close motion.
2. Reader skeleton toolbar never overlaps at supported widths.
3. Every mobile toolbar icon button has identical outer dimensions.
4. One archive-list button opens a panel whose tabs switch between history and watchlist.
5. Manual archive refresh crossfades old and new grids without a blank flash.
6. Metadata edit appears directly right of `归档信息` and no longer appears in the reader toolbar.
7. New controls remain keyboard accessible and new motion respects reduced-motion settings.
