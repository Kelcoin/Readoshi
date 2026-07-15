# History, Watchlist, and Untagged Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep watchlist progress/removal current, restore history context-menu deletion behavior, and make untagged browsing resilient to missing archives and rapid deselection.

**Architecture:** Reuse existing page state, `ArchiveContextMenu`, `ConfirmDialog`, deletion helper, and bounded metadata loader. Add only two pure watchlist helpers and one opt-in missing-metadata policy; preserve current request ownership and visuals.

**Tech Stack:** React 18, browser localStorage/events, LANraragi HTTP API, Node `assert` checks, Vite.

## Global Constraints

- No new dependencies or global state store.
- Auto-remove only when progress is strictly greater than 80%; unknown totals never remove.
- Missing archive means HTTP 400 or 404 only.
- Other API errors stay visible and never delete history.
- Keep current card sizes, theme, animation, pagination, and Worker/LRR sync semantics.

---

### Task 1: Watchlist progress model

**Files:**
- Modify: `src/lib/watchlist.js`
- Create: `scripts/check-watchlist-progress.mjs`

**Interfaces:**
- Produces: `mergeWatchlistProgress(items, histories) -> Array<object>`
- Produces: `getWatchlistAutoRemoveIds(items, threshold = 0.8) -> Array<string>`

- [ ] **Step 1: Write failing pure-function checks**

```js
const merged = mergeWatchlistProgress(
  [{ id: 'a', pagecount: 100 }, { id: 'b', pagecount: 100 }],
  [{ id: 'a', page: 81 }, { id: 'b', page: 80 }],
);
assert.equal(merged[0].page, 81);
assert.deepEqual(getWatchlistAutoRemoveIds(merged), ['a']);
assert.deepEqual(getWatchlistAutoRemoveIds([{ id: 'x', page: 99 }]), []);
```

- [ ] **Step 2: Run check and verify RED**

Run: `node scripts/check-watchlist-progress.mjs`

Expected: import failure because helpers do not exist.

- [ ] **Step 3: Implement minimum pure helpers**

```js
export function mergeWatchlistProgress(items, histories) {
  const byId = new Map((histories || []).map((item) => [String(item.id || item.arcid), item]));
  return (items || []).map((item) => {
    const history = byId.get(String(item.id || item.arcid));
    const page = Math.max(Number(item.page) || 0, Number(history?.page) || 0);
    const total = Number(item.total || item.pagecount || history?.total || history?.pagecount) || 0;
    return { ...item, page, total };
  });
}

export function getWatchlistAutoRemoveIds(items, threshold = 0.8) {
  return (items || []).filter((item) => item.total > 0 && item.page / item.total > threshold)
    .map((item) => String(item.id || item.arcid)).filter(Boolean);
}
```

- [ ] **Step 4: Run check and verify GREEN**

Run: `node scripts/check-watchlist-progress.mjs`

Expected: `watchlist progress checks passed`.

### Task 2: Connect watchlist views to history

**Files:**
- Modify: `src/pages/Home.jsx`
- Modify: `src/pages/WatchlistPage.jsx`
- Modify: `src/pages/Reader.jsx`
- Modify: `scripts/check-watchlist-progress.mjs`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: both watchlist views show monotonic history progress and remove over-threshold items.

- [ ] **Step 1: Add failing source assertions**

Assert both pages call `mergeWatchlistProgress`, pass `currentPage` and `showProgressBar`, and call `removeWatchlistItems(getWatchlistAutoRemoveIds(...))`; assert WatchlistPage listens for `lrr:history-changed`.

- [ ] **Step 2: Run check and verify RED**

Run: `node scripts/check-watchlist-progress.mjs`

Expected: first missing page integration assertion fails.

- [ ] **Step 3: Wire derived progress and cleanup**

Use `useMemo` for merged items and a guarded `useEffect` for batch removal. In Reader, use already computed `highestPage` rather than `currentIndex + 1` for the existing 80% comparison.

- [ ] **Step 4: Run check and verify GREEN**

Run: `node scripts/check-watchlist-progress.mjs`

Expected: pass.

### Task 3: History context menu and missing-delete notice

**Files:**
- Modify: `src/pages/HistoryPage.jsx`
- Create: `scripts/check-history-context-menu.mjs`

**Interfaces:**
- Consumes: `ArchiveContextMenu`, `ConfirmDialog`, `deleteArchiveWithFavoriteSync`, `isArchiveMissingError`, `removeHistoryItems`, `removeWatchlistItem`.
- Produces: standard context menu; confirmed delete; themed result/error dialog.

- [ ] **Step 1: Write failing source assertions**

Assert HistoryPage renders `ArchiveContextMenu`, passes `onArchiveContextMenu`, supplies `onDelete`, confirms deletion, branches through `isArchiveMissingError`, removes history on 400/404, and renders a non-destructive `ConfirmDialog` with `showCancel={false}`.

- [ ] **Step 2: Run check and verify RED**

Run: `node scripts/check-history-context-menu.mjs`

Expected: fail at missing `ArchiveContextMenu`.

- [ ] **Step 3: Reuse existing menu and deletion patterns**

Add menu state and handlers matching WatchlistPage/Home. Normal delete success removes history and watchlist. Missing 400/404 removes history then sets notice text `归档已不存在于 LANraragi，相关历史记录已清理。`; other failures set `删除失败：<message>` without removing history.

- [ ] **Step 4: Run check and verify GREEN**

Run: `node scripts/check-history-context-menu.mjs`

Expected: `history context menu checks passed`.

### Task 4: Untagged missing-ID tolerance and deselection refresh

**Files:**
- Modify: `src/lib/api.js`
- Modify: `src/pages/Home.jsx`
- Modify: `scripts/check-untagged-archives.mjs`

**Interfaces:**
- Extends: `loadArchiveMetadataBatch(ids, loadArchive, { concurrency, signal, ignoreMissing })`.
- Preserves: default fail-fast behavior for every existing caller.

- [ ] **Step 1: Add failing behavior checks**

```js
const missing = Object.assign(new Error('missing'), { status: 400 });
const kept = await loadArchiveMetadataBatch(['ok', 'gone'], async (id) => {
  if (id === 'gone') throw missing;
  return { id };
}, { ignoreMissing: true });
assert.deepEqual(kept, [{ id: 'ok' }]);
```

Also assert 401 and Abort still reject, Home enables `ignoreMissing`, and `handleUntaggedCategoryClick` invalidates `lastFetchedFilterRef/lastFetchedRef` before state change.

- [ ] **Step 2: Run check and verify RED**

Run: `node scripts/check-untagged-archives.mjs`

Expected: missing 400 still rejects.

- [ ] **Step 3: Implement opt-in skip and dedupe invalidation**

Catch each worker item only when `ignoreMissing && (status === 400 || status === 404)`, store no result, then return `results.filter(Boolean)`. Before toggling untagged, clear last fetched key/time so the existing effect must request the new state.

- [ ] **Step 4: Run check and verify GREEN**

Run: `node scripts/check-untagged-archives.mjs`

Expected: pass.

### Task 5: Full verification and commit

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run targeted checks**

Run:

```powershell
node scripts/check-watchlist-progress.mjs
node scripts/check-history-context-menu.mjs
node scripts/check-untagged-archives.mjs
```

Expected: all pass.

- [ ] **Step 2: Run repository checks and build**

Run:

```powershell
Get-ChildItem scripts\check-*.mjs | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
npm run build
git diff --check
```

Expected: every check exits 0; Vite build succeeds; diff check emits nothing.

- [ ] **Step 3: Review scope and commit**

Stage only implementation, checks, and plan. Commit message:

```text
fix: sync watchlist and history archive state
```
