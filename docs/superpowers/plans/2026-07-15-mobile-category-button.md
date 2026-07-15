# Mobile Category Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve narrow-screen category-button proportions and remove sticky touch hover without affecting desktop hover or active state.

**Architecture:** Change only category-specific CSS. Extend the existing source-level Node check before implementation, then verify the complete repository and Vite build.

**Tech Stack:** CSS media queries, Node `assert`, Vite.

## Global Constraints

- Narrow-screen button minimum height is exactly `36px`.
- Touch-only hover reset applies only to `.archive-category-button` under `@media (hover: none)`.
- Desktop hover, active inline styles, theme colors, category behavior, and all other buttons remain unchanged.
- No new dependency or JavaScript interaction handler.

---

### Task 1: Category button responsive and touch styles

**Files:**
- Modify: `scripts/check-reader-lifecycle-cosplay.mjs`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: existing `.archive-category-button` and `.btn:hover` styles.
- Produces: narrow-screen 36px pill and touch-only hover reset.

- [ ] **Step 1: Add failing CSS source checks**

```js
assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.archive-category-button\s*\{[\s\S]*?min-height:\s*36px/);
assert.match(css, /@media \(hover: none\)[\s\S]*?\.archive-category-button:hover:not\(:disabled\)/);
assert.match(css, /@media \(hover: none\)[\s\S]*?background:\s*var\(--button-bg\)/);
assert.match(css, /@media \(hover: none\)[\s\S]*?transform:\s*none/);
```

- [ ] **Step 2: Run check and verify RED**

Run: `node scripts/check-reader-lifecycle-cosplay.mjs`

Expected: fail because mobile rule still contains `min-height: 44px`.

- [ ] **Step 3: Implement minimum CSS**

```css
@media (max-width: 640px) {
  .archive-category-button {
    min-height: 36px;
    padding-block: 3px;
    padding-inline: 8px;
    border-radius: 16px !important;
    font-size: 11.5px;
  }
}

@media (hover: none) {
  .archive-category-button:hover:not(:disabled) {
    background: var(--button-bg);
    border-color: var(--glass-border);
    color: var(--text-main);
    transform: none;
    box-shadow: var(--button-shadow);
  }
}
```

- [ ] **Step 4: Run check and verify GREEN**

Run: `node scripts/check-reader-lifecycle-cosplay.mjs`

Expected: `reader lifecycle and cosplay checks passed`.

- [ ] **Step 5: Run full verification**

```powershell
Get-ChildItem scripts\check-*.mjs | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
npm run build
git diff --check
```

Expected: all checks exit 0, Vite build succeeds, diff check emits nothing.

- [ ] **Step 6: Commit**

```text
fix(ui): refine mobile category buttons
```
