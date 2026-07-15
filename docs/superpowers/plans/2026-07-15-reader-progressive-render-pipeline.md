# Reader Progressive Render Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Reader's all-or-nothing boot skeleton with Reader-scoped progressive resource stages while preserving existing reading behavior and visuals.

**Architecture:** A small pure reducer owns metadata/manifest stages and derives capabilities. Reader keeps one stable shell, starts metadata and manifest concurrently with abortable request ownership, and lets existing PageImage/imageLoadQueue own image fetch and decode.

**Tech Stack:** React 18, JavaScript ES modules, Vite, repository `scripts/check-*.mjs` assertion style, CSS.

## Global Constraints

- Work on `dev`; do not push unless the user asks.
- Reuse `PageImage` and `imageLoadQueue`; no new dependency or app-wide Store.
- Keep normal, double-page, immersive, Webtoon, cold-restore, progress sync, drawer and panel behavior.
- No production code before its regression check has failed for the expected missing behavior.
- Animate only opacity/transform; honor iOS and `prefers-reduced-motion`.
- Do not start an interactive browser without new user permission.

---

### Task 1: Reader resource stage reducer

**Files:**
- Create: `scripts/check-reader-render-pipeline.mjs`
- Create: `src/lib/readerRenderPipeline.js`

**Interfaces:**
- Produces: `READER_STAGE_STATUS`, `createReaderRenderState({ hasMetadata, hasManifest, hasSelection })`, `readerRenderReducer(state, action)`, `getReaderCapabilities(state, pageCount)`.

- [ ] **Step 1: Write failing reducer check**

The script must import the real module and assert cold/snapshot initial states, independent `ready/error` transitions, reset behavior, and derived `canShowMetadata/canNavigate/canRenderPage`.

- [ ] **Step 2: Verify RED**

Run: `node scripts/check-reader-render-pipeline.mjs`

Expected: FAIL because `src/lib/readerRenderPipeline.js` does not exist.

- [ ] **Step 3: Implement minimal pure reducer**

Use a frozen status map, three resource keys (`metadata`, `manifest`, `selection`), generic `{ type: 'start'|'ready'|'error'|'reset', resource, error }` actions, and capability derivation from `ready` states plus `pageCount > 0`.

- [ ] **Step 4: Verify GREEN**

Run: `node scripts/check-reader-render-pipeline.mjs`

Expected: `Reader render pipeline checks passed`.

### Task 2: Abortable archive manifest API

**Files:**
- Modify: `src/lib/api.js`
- Create: `scripts/check-reader-bootstrap-api.mjs`

**Interfaces:**
- Produces: `lrrApi.getArchiveFiles(id, options = {})`, `lrrApi.extractArchive(id, options = {})`.

- [ ] **Step 1: Write failing source/behavior check**

Assert both wrappers accept `options = {}` and call `request(..., null, options)` with the original HTTP methods.

- [ ] **Step 2: Verify RED**

Run: `node scripts/check-reader-bootstrap-api.mjs`

Expected: FAIL on missing options forwarding.

- [ ] **Step 3: Add only options forwarding**

Do not change endpoint paths, authentication, parsing, or unrelated API methods.

- [ ] **Step 4: Verify GREEN**

Run: `node scripts/check-reader-bootstrap-api.mjs`

Expected: `Reader bootstrap API checks passed`.

### Task 3: Stable Reader shell and concurrent bootstrap

**Files:**
- Modify: `src/pages/Reader.jsx`
- Create: `scripts/check-reader-progressive-shell.mjs`

**Interfaces:**
- Consumes: reducer and abortable API wrappers from Tasks 1–2.
- Produces: persistent shell, `metadataReady`, `manifestReady`, `canNavigate`, `canRenderPage`, `secondaryContentReady`.

- [ ] **Step 1: Write failing integration check**

Assert Reader imports/uses the reducer, creates `AbortController`, starts metadata and manifest promises before awaiting their join, treats AbortError without extraction fallback, removes both top-level `if (loading...) return` branches, and gates downstream content on current target image readiness.

- [ ] **Step 2: Verify RED**

Run: `node scripts/check-reader-progressive-shell.mjs`

Expected: FAIL on missing reducer and retained whole-page skeleton returns.

- [ ] **Step 3: Replace boot booleans with resource stages**

Initialize reducer from snapshot. In the existing archive effect, dispatch reset, start metadata/manifest requests concurrently, update each slot independently, join settled results to calculate the maximum saved page, and abort on cleanup. Keep existing new-marker/progress behavior, snapshot restoration, refs and page-load identity logic.

- [ ] **Step 4: Render stable slots**

Keep the real toolbar/root mounted. Render title/page-count placeholders while their resource is loading. Render the existing stage skeleton inside the stage only until `canRenderPage`; on manifest error render a status and retry action. Replace `readerReady` consumers with the narrow capability they need.

- [ ] **Step 5: Gate secondary work**

Define `currentPageReady` from `pageLoadPhase.status === 'ready'` and target identity. Delay remote history/watchlist/server loading, adjacent preload, Recommendations and auto-Webtoon detection until that condition. Keep EH viewport-lazy.

- [ ] **Step 6: Verify GREEN and existing Reader checks**

Run: `node scripts/check-reader-progressive-shell.mjs; node scripts/check-reader-render-pipeline.mjs; node scripts/check-reader-cold-restore-stability.mjs`

Expected: all pass.

### Task 4: Progressive UI and motion safety

**Files:**
- Modify: `src/pages/Reader.jsx`
- Modify: `src/index.css`
- Extend: `scripts/check-reader-progressive-shell.mjs`

**Interfaces:**
- Consumes: stable resource slots from Task 3.
- Produces: `.reader-progressive-slot`, localized `role="status"`, reduced-motion/iOS overrides.

- [ ] **Step 1: Extend check and verify RED**

Assert async status semantics, one-shot slot class, explicit opacity/transform transitions, and reduced-motion rules covering Reader pulse/fade/slot selectors.

- [ ] **Step 2: Add minimal JSX/CSS**

Preserve existing colors, radii, spacing and responsive geometry. Add only slot reveal/error styles and missing reduced-motion coverage; never use `transition: all`.

- [ ] **Step 3: Verify GREEN**

Run: `node scripts/check-reader-progressive-shell.mjs`

Expected: pass with accessibility and motion assertions.

### Task 5: Full regression and review

**Files:**
- Modify if needed: only files changed in Tasks 1–4.

- [ ] **Step 1: Run all assertion scripts**

Run every `scripts/check-*.mjs`; expected zero failures.

- [ ] **Step 2: Run syntax/build checks**

Run: `node --check worker.js; npm run build; git diff --check`

Expected: exit 0; Vite production bundle completes.

- [ ] **Step 3: Review diff against spec and Web Interface Guidelines**

Check no whole-page boot return remains, no new global Store/dependency exists, image priority stays delegated, all touched icon buttons retain labels/focus, async statuses are polite, and all new motion has reduced-motion handling.

- [ ] **Step 4: Commit implementation**

Stage only Reader pipeline files and commit with a concise Conventional Commit. Do not push.
