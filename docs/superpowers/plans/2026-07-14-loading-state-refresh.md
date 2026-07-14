# Loading State and Refresh Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate cached-page loading flashes, reduce loading typography, unify recommendation refresh UI, and prevent StrictMode cold-start archive loading deadlocks.

**Architecture:** Keep existing Reader and Home state machines. Delay only loading-status presentation, and treat archive requests as fresh only after their result is successfully committed. Reuse existing `.btn` styling; add no dependencies or shared component abstraction.

**Tech Stack:** React 18, JavaScript/JSX, Vite, Node assert-based check scripts.

## Global Constraints

- Keep React `StrictMode` enabled.
- Keep global image queue concurrency and priorities unchanged.
- Show loading status after exactly 160ms; show errors immediately.
- Main loading text uses `clamp(18px, 2.2vw, 28px)`.
- Secondary loading text uses `clamp(13px, 1.4vw, 18px)`.
- Recommendation refresh reuses `.btn`, `6px 12px` padding, and `12px` font size.
- Add no dependency, timeout framework, retry framework, or shared button component.

---

### Task 1: Add focused RED checks

**Files:**
- Create: `scripts/check-loading-state-refresh.mjs`

**Interfaces:**
- Consumes: source text from `src/pages/Home.jsx`, `src/pages/Reader.jsx`, and `src/components/Recommendations.jsx`.
- Produces: one executable Node regression check with exit code 0 on success.

- [ ] **Step 1: Write the failing check**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const home = fs.readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8');
const reader = fs.readFileSync(new URL('../src/pages/Reader.jsx', import.meta.url), 'utf8');
const recommendations = fs.readFileSync(new URL('../src/components/Recommendations.jsx', import.meta.url), 'utf8');

assert.doesNotMatch(
  home,
  /lastFetchedFilterRef\.current = filterKey;\s*lastFetchedRef\.current = now;\s*archiveRequestInFlightRef\.current = true;/,
  'archive freshness must not be recorded before a request starts',
);
assert.equal((home.match(/markArchiveFetchCompleted\(\);/g) || []).length, 3, 'every successful archive result path must record freshness');

assert.match(reader, /const \[showLoadingStatus, setShowLoadingStatus\] = useState\(false\)/);
assert.match(reader, /setTimeout\(\(\) => setShowLoadingStatus\(true\), 160\)/);
assert.match(reader, /return \(\) => clearTimeout\(timer\)/);
assert.match(reader, /loadState === 'error' \|\| showLoadingStatus/);
assert.match(reader, /clamp\(18px, 2\.2vw, 28px\)/);
assert.match(reader, /clamp\(13px, 1\.4vw, 18px\)/);

assert.match(recommendations, /className="btn"[\s\S]*onClick=\{refreshCache\}[\s\S]*disabled=\{loading\}/);
assert.match(recommendations, /\{loading \? '刷新中' : '刷新'\}/);
assert.doesNotMatch(recommendations, /title="清理缓存并刷新">\s*<svg/);

console.log('loading state and refresh checks passed');
```

- [ ] **Step 2: Run check and verify RED**

Run: `node scripts/check-loading-state-refresh.mjs`

Expected: FAIL because pre-request freshness writes still match the forbidden block.

- [ ] **Step 3: Commit the RED check**

```bash
git add scripts/check-loading-state-refresh.mjs
git commit -m "test: cover loading state races"
```

---

### Task 2: Fix StrictMode archive freshness ownership

**Files:**
- Modify: `src/pages/Home.jsx:1045-1158`
- Test: `scripts/check-loading-state-refresh.mjs`

**Interfaces:**
- Consumes: existing `filterKey`, `lastFetchedFilterRef`, `lastFetchedRef`, and request sequence ownership.
- Produces: local `markArchiveFetchCompleted()` used by all three successful result paths.

- [ ] **Step 1: Remove pre-request freshness writes and add completion helper**

Replace:

```js
    lastFetchedFilterRef.current = filterKey;
    lastFetchedRef.current = now;
    archiveRequestInFlightRef.current = true;
```

with:

```js
    archiveRequestInFlightRef.current = true;
    const markArchiveFetchCompleted = () => {
      lastFetchedFilterRef.current = filterKey;
      lastFetchedRef.current = Date.now();
    };
```

- [ ] **Step 2: Mark each successful return path**

Immediately before each of the three `return true;` statements in `doFetch()`—empty untagged results, populated untagged results, and normal search results—insert:

```js
        markArchiveFetchCompleted();
```

Use the current indentation of each branch. Do not call it from abort, error, or stale-sequence paths.

- [ ] **Step 3: Run focused check**

Run: `node scripts/check-loading-state-refresh.mjs`

Expected: still FAIL at missing Reader delay; archive freshness assertions pass.

- [ ] **Step 4: Run archive pipeline regression**

Run: `node scripts/check-archive-render-pipeline.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Home.jsx
git commit -m "fix(home): complete archive fetch freshness"
```

---

### Task 3: Delay and resize Reader loading status

**Files:**
- Modify: `src/pages/Reader.jsx:263-430`
- Test: `scripts/check-loading-state-refresh.mjs`

**Interfaces:**
- Consumes: existing `loadState`, `pageUrl`, `isReady`, and PageImage lifecycle.
- Produces: local boolean state `showLoadingStatus`; no exported API.

- [ ] **Step 1: Add delayed visibility state**

After `loadState` state declaration add:

```js
  const [showLoadingStatus, setShowLoadingStatus] = useState(false);
```

- [ ] **Step 2: Reset delay synchronously on every page request**

At the start of the existing PageImage `useLayoutEffect`, after incrementing `requestSeqRef`, add:

```js
    setShowLoadingStatus(false);
```

This prevents the previous slow page's visible status from flashing during the next layout pass.

- [ ] **Step 3: Add timer with cleanup and immediate error handling**

After the PageImage `useLayoutEffect`, add:

```js
  useEffect(() => {
    if (loadState !== 'loading') {
      setShowLoadingStatus(false);
      return undefined;
    }
    const timer = setTimeout(() => setShowLoadingStatus(true), 160);
    return () => clearTimeout(timer);
  }, [loadState, pageUrl]);
```

- [ ] **Step 4: Gate status rendering and shrink typography**

Replace:

```jsx
      {!isReady && (
```

with:

```jsx
      {!isReady && (loadState === 'error' || showLoadingStatus) && (
```

Change status layout and typography to:

```jsx
          gap: '10px',
```

```jsx
          <div style={{ fontSize: 'clamp(18px, 2.2vw, 28px)', fontWeight: 750, letterSpacing: '0.3px', textWrap: 'balance' }}>
```

```jsx
          <div style={{ fontSize: 'clamp(13px, 1.4vw, 18px)', fontWeight: 600, color: loadState === 'error' ? 'rgba(255,180,180,0.84)' : 'var(--text-sub)' }}>
```

- [ ] **Step 5: Run focused check**

Run: `node scripts/check-loading-state-refresh.mjs`

Expected: still FAIL at recommendation refresh button; Reader assertions pass.

- [ ] **Step 6: Run Reader regression**

Run: `node scripts/check-reader-loading-performance.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Reader.jsx
git commit -m "fix(reader): suppress fast loading flashes"
```

---

### Task 4: Unify recommendation refresh button

**Files:**
- Modify: `src/components/Recommendations.jsx:393-397`
- Test: `scripts/check-loading-state-refresh.mjs`

**Interfaces:**
- Consumes: existing `refreshCache`, `loading`, and global `.btn` class.
- Produces: no new interface.

- [ ] **Step 1: Replace the SVG-only button**

Replace the recommendation refresh button with:

```jsx
            <button
              className="btn"
              onClick={refreshCache}
              disabled={loading}
              style={{ padding: '6px 12px', fontSize: '12px', opacity: loading ? 0.72 : 1 }}
              title="清理缓存并刷新"
            >
              {loading ? '刷新中' : '刷新'}
            </button>
```

Keep collapse control unchanged.

- [ ] **Step 2: Run focused check and verify GREEN**

Run: `node scripts/check-loading-state-refresh.mjs`

Expected output: `loading state and refresh checks passed`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Recommendations.jsx
git commit -m "style(reader): unify recommendation refresh"
```

---

### Task 5: Full verification

**Files:**
- Verify only; no production edits expected.

**Interfaces:**
- Consumes: all completed tasks.
- Produces: fresh completion evidence.

- [ ] **Step 1: Run every Node regression check**

```powershell
$checks = Get-ChildItem scripts/check-*.mjs | Sort-Object Name
foreach ($check in $checks) {
  node $check.FullName
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Expected: exit 0; focused output includes `loading state and refresh checks passed`.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: Vite build succeeds with no transform or render error.

- [ ] **Step 3: Check diff and repository state**

```powershell
git diff --check
git status --short --branch
```

Expected: `git diff --check` exits 0; status shows only intended plan/test/source changes and the previously committed spec/plan history.

- [ ] **Step 4: Final implementation commit if execution combined tasks**

Only when task commits were intentionally squashed or omitted:

```bash
git add scripts/check-loading-state-refresh.mjs src/pages/Home.jsx src/pages/Reader.jsx src/components/Recommendations.jsx docs/superpowers/plans/2026-07-14-loading-state-refresh.md
git commit -m "fix: stabilize loading states"
```
