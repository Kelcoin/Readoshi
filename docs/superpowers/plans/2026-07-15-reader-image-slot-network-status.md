# Reader Image Slot and Network Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent stale immersive swipe previews, show loading UI only for slow network fetches, and predecode normal-mode adjacent pages.

**Architecture:** Keep existing global queue and three-image immersive renderer. Add page identity to each immersive image element, surface network-start only from the existing cache-miss fetcher, and extend existing background priming with browser decode.

**Tech Stack:** React 18, browser Cache API, `Image.decode()`, Node assertion scripts, Vite.

## Global Constraints

- No new dependencies or queue abstraction.
- Adjacent work starts only after current page is ready.
- Preserve LTR/RTL, double-page, Webtoon, cold-restore, layout, and animation behavior.
- Loading UI appears only when a real network request remains active for at least 180ms.

---

### Task 1: Add regression assertions

**Files:**
- Modify: `scripts/check-reader-loading-performance.mjs`

**Interfaces:**
- Consumes: `src/pages/Reader.jsx` source text.
- Produces: executable assertions for slot page identity, network-only status, and adjacent decode.

- [x] **Step 1: Add failing source-contract assertions**

Assert that immersive elements store/check `dataset.pageIndex`, `resolvePageImageSource` accepts `onNetworkStart`, loading timers depend on a network state, and `primePageImage` calls `decode()`.

- [x] **Step 2: Verify RED**

Run: `node scripts/check-reader-loading-performance.mjs`

Expected: failure naming the first missing slot/network/decode contract.

### Task 2: Guard immersive slots by page identity

**Files:**
- Modify: `src/pages/Reader.jsx:1527-1619`
- Modify: `src/pages/Reader.jsx:2193-2228`
- Test: `scripts/check-reader-loading-performance.mjs`

**Interfaces:**
- Consumes: target `pageIndex` for each slot load and swipe target.
- Produces: `img.dataset.pageIndex` only after valid decode.

- [x] **Step 1: Pass target page index into `loadImg`**

Hide and invalidate a slot before loading when its recorded page differs from target. After current load sequence validation and decode, record target page and show the element.

- [x] **Step 2: Require page identity during preview promotion**

Compute target index before `canPromotePreview`; require `previewImg.dataset.pageIndex === String(targetIndex)` and copy identity to the current image when promoted.

- [x] **Step 3: Verify focused check**

Run: `node scripts/check-reader-loading-performance.mjs`

Expected: slot assertions pass; later network/decode assertion may remain RED.

### Task 3: Restrict loading UI to slow network fetches

**Files:**
- Modify: `src/pages/Reader.jsx:81-99`
- Modify: `src/pages/Reader.jsx:249-430`
- Modify: `src/pages/Reader.jsx:1527-1619`
- Modify: `src/pages/Reader.jsx:2390-2401`
- Test: `scripts/check-reader-loading-performance.mjs`

**Interfaces:**
- `resolvePageImageSource(pageUrl, { onNetworkStart, ...options })` calls `onNetworkStart()` immediately before `fetch()` only.
- `PageImage` owns delayed network-status visibility and clears it when fetch resolution returns.
- Immersive current-page fetch arms parent status; adjacent fetches never do.

- [x] **Step 1: Add network-start callback at cache-miss fetch boundary**

Call optional `onNetworkStart` inside the fetcher passed to `getImage`, directly before `fetch(normalized)`.

- [x] **Step 2: Replace generic loading timer with network timer**

Track network pending separately. Start 180ms timer only after callback; clear pending and timer as soon as `resolvePageImageSource` returns or throws. Keep errors visible.

- [x] **Step 3: Apply same boundary to immersive current page**

Arm delayed UI from current-page fetcher only. Clear it at fetch completion; remove generic `pageLoadPhase` loading timer.

- [x] **Step 4: Verify focused check**

Run: `node scripts/check-reader-loading-performance.mjs`

Expected: slot and network assertions pass; decode assertion may remain RED.

### Task 4: Predecode normal-mode adjacent pages

**Files:**
- Modify: `src/pages/Reader.jsx:689-701`
- Test: `scripts/check-reader-loading-performance.mjs`

**Interfaces:**
- `primePageImage(pageUrl, priority)` returns `true` after cache fill and browser decode, otherwise `false`.

- [x] **Step 1: Resolve shared object URL during prime**

Use existing `getImage()` with the provided priority so the same cache/queue key is reused.

- [x] **Step 2: Decode temporary image**

Assign returned object URL to `new Image()`, await `decode()` or `load`, clear handlers, and return success. Swallow preheat failure at existing effect call site.

- [x] **Step 3: Verify GREEN**

Run: `node scripts/check-reader-loading-performance.mjs`

Expected: `reader loading/performance checks passed`.

### Task 5: Full verification and delivery

**Files:**
- Modify: `task_plan.md`
- Modify: `findings.md`
- Modify: `progress.md`

**Interfaces:** None.

- [x] **Step 1: Run all checks**

Run every `scripts/check-*.mjs`; expected exit code 0 for each.

- [x] **Step 2: Build**

Run: `npm run build`

Expected: Vite production build succeeds.

- [x] **Step 3: Review diff**

Run: `git diff --check` and inspect `git diff`; expected no whitespace errors or unrelated changes.

- [ ] **Step 4: Commit and push**

Commit with Conventional Commits message `fix(reader): stabilize page image loading`, then `git push origin dev`.
