# EH Comments and PWA Reader Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct EH comment-page classification, standardize two-line errors, and prevent iOS PWA reload loops and Reader image reloading flashes.

**Architecture:** Extract EH response classification and presentation into one small pure module so the Worker attachment case can be regression-tested without a browser DOM. Keep PWA activation deterministic: a waiting worker activates once, first control acquisition never reloads, and a version-keyed session guard permits at most one update reload. Preserve a ready `PageImage` when cold-restore cache policy relaxes, while unresolved images may retry with network access.

**Tech Stack:** React 18, Vite 5, native Service Worker APIs, Node assertion scripts, existing CSS variables.

## Global Constraints

- Preserve existing Reader features and visual design.
- EH errors use two centered lines: main cause first, possible detail second.
- Preserve a trimmed original Worker detail only for unknown/unexpected failures.
- Change page loading copy from “正在切换到” to “正在加载”.
- No new runtime dependencies or speculative loading abstractions.

---

### Task 1: EH response classification and error presentation

**Files:**
- Create: `src/lib/ehCommentsState.js`
- Modify: `src/components/EhComments.jsx`
- Modify: `src/index.css`
- Modify: `worker.js`
- Create: `scripts/check-eh-comments-state.mjs`

**Interfaces:**
- Produces: `classifyEhGalleryPage(html, status)` returning `available`, `unavailable`, or `blocked`.
- Produces: `presentEhError(code, detail, context)` returning `{ title, detail, needsCookie }`.

- [ ] **Step 1: Write the failing regression script**

Cover accessible HTML containing `Visible: No (Expunged)`, true unavailable pages, HTTP 403/404, merged Worker errors, unknown-detail trimming, and Worker source recognition of `id="cdiv"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/check-eh-comments-state.mjs`
Expected: FAIL because `src/lib/ehCommentsState.js` does not exist.

- [ ] **Step 3: Implement the minimal classifier and presenter**

Strong gallery structure wins over metadata words. Only HTTP 404/410 or explicit unavailable-page wording means removed. Map duplicate failures into token, login/cookie, access-block, unavailable, network, and unexpected-response presentations.

- [ ] **Step 4: Integrate component and Worker**

Use the structured presentation state in `EhComments`, render title/detail centered, and validate successful Worker HTML with real structural markers (`id="cdiv"`, comment container, or gallery variables).

- [ ] **Step 5: Run focused verification**

Run: `node scripts/check-eh-comments-state.mjs`
Expected: PASS.

### Task 2: PWA activation and reload-loop guard

**Files:**
- Create: `src/lib/pwaReloadGuard.js`
- Modify: `src/main.jsx`
- Modify: `public/sw.js`
- Create: `scripts/check-pwa-reload-guard.mjs`

**Interfaces:**
- Produces: `getServiceWorkerVersion(scriptURL)` and `claimPwaReload(storage, version, now)`.

- [ ] **Step 1: Write the failing regression script**

Assert first claim succeeds, the same version is rejected in the guard window, a new version succeeds, and Service Worker install no longer calls unconditional `skipWaiting()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/check-pwa-reload-guard.mjs`
Expected: FAIL because guard module is absent and install still activates automatically.

- [ ] **Step 3: Implement minimal activation control**

Capture whether the page had a controller before registration; ignore first control acquisition. On an update controller change, reload only if the version-keyed session claim succeeds. Remove install-time `skipWaiting`; retain the existing waiting-worker message path.

- [ ] **Step 4: Run focused verification**

Run: `node scripts/check-pwa-reload-guard.mjs`
Expected: PASS.

### Task 3: Reader ready-image preservation and loading copy

**Files:**
- Modify: `src/pages/Reader.jsx`
- Create: `scripts/check-reader-cold-restore-stability.mjs`

**Interfaces:**
- Existing `PageImage` keeps its ready source when only `cacheOnly` changes from true to false for the same page.

- [ ] **Step 1: Write the failing regression script**

Assert loading labels contain `正在加载第 … 页`, no `正在切换到`, and source contains a ready-image preservation gate before clearing `imgSrc`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/check-reader-cold-restore-stability.mjs`
Expected: FAIL on the old copy and unconditional `setImgSrc(null)` behavior.

- [ ] **Step 3: Implement minimal preservation logic**

Track the page URL represented by the ready image. When cache-only relaxes for that same URL, keep the decoded source; unresolved cache misses still retry through the network.

- [ ] **Step 4: Run focused and project verification**

Run: `node scripts/check-reader-cold-restore-stability.mjs`, `npm run lint`, `npm run build`.
Expected: all PASS with zero lint warnings.

