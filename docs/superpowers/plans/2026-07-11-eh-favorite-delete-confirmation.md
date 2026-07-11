# EH 收藏夹同步删除确认 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为首页单删、首页批量删除和重复归档页批量删除增加默认勾选的本次 EH/EX 收藏夹同步确认。

**Architecture:** 复用 `ConfirmDialog` 的 React `children` 内容槽显示原生复选框。全局开关与本次确认值通过一个纯函数合并判断，删除流程显式接收本次选择，不持久化临时状态。

**Tech Stack:** React 18、Vite 5、Node.js 内置 `node:test`。

## Global Constraints

- 只覆盖首页单个删除、首页批量删除和重复归档页批量删除。
- 每次打开确认弹窗时复选框默认勾选。
- 全局同步开关关闭时不显示复选框，也不调用 EH Worker。
- EH 同步失败时不继续删除对应 LANraragi 归档。
- 不新增依赖，不修改 Worker 协议，不持久化本次选择。

---

### Task 1: 可测试的同步决策

**Status:** complete

**Files:**
- Modify: `src/lib/ehFavoriteSync.js:1-16`
- Create: `src/lib/ehFavoriteSync.test.js`

**Interfaces:**
- Consumes: `globalEnabled: boolean`、`confirmationEnabled: boolean`
- Produces: `shouldSyncEhFavorite(globalEnabled, confirmationEnabled): boolean`

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSyncEhFavorite } from './ehFavoriteSync.js';

test('only syncs when global setting and this deletion are both enabled', () => {
  assert.equal(shouldSyncEhFavorite(true, true), true);
  assert.equal(shouldSyncEhFavorite(true, false), false);
  assert.equal(shouldSyncEhFavorite(false, true), false);
  assert.equal(shouldSyncEhFavorite(false, false), false);
});
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test src/lib/ehFavoriteSync.test.js`

Expected: FAIL，提示 `ehFavoriteSync.js` 尚未导出 `shouldSyncEhFavorite`。

- [ ] **Step 3: 写最小实现**

在 `src/lib/ehFavoriteSync.js` 中加入：

```js
export function shouldSyncEhFavorite(globalEnabled, confirmationEnabled) {
  return !!globalEnabled && !!confirmationEnabled;
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --test src/lib/ehFavoriteSync.test.js`

Expected: PASS，1 test、0 failures。

### Task 2: 共享弹窗与首页单删/批量删除

**Status:** complete

**Files:**
- Modify: `src/components/ConfirmDialog.jsx:4-75`
- Modify: `src/pages/Home.jsx:1-20,381-637,1316-1343,1938,2430-2461`
- Test: `src/lib/ehFavoriteSync.test.js`

**Interfaces:**
- Consumes: `ConfirmDialog` 的标准 React `children`、`shouldSyncEhFavorite(globalEnabled, confirmationEnabled)`
- Produces: `deleteArchiveWithSync(archive, confirmationEnabled)`；首页两个弹窗的本次同步选择

- [ ] **Step 1: 扩展现有测试，锁定默认值决策**

在测试文件追加：

```js
test('a newly opened delete confirmation defaults to syncing', () => {
  const confirmationEnabled = true;
  assert.equal(shouldSyncEhFavorite(true, confirmationEnabled), true);
});
```

- [ ] **Step 2: 运行测试，确认现有纯逻辑仍通过**

Run: `node --test src/lib/ehFavoriteSync.test.js`

Expected: PASS，2 tests、0 failures。该步骤先固定调用方采用 `true` 作为打开弹窗时的默认状态。

- [ ] **Step 3: 给 `ConfirmDialog` 增加原生内容槽**

在参数中接收 `children`，并在消息与按钮之间渲染：

```jsx
{children}
```

不改动现有按钮、遮罩、Escape 或禁用行为。

- [ ] **Step 4: 首页加入本次选择状态与打开函数**

加入两个布尔状态：

```js
const [archiveDeleteSyncConfirmed, setArchiveDeleteSyncConfirmed] = useState(true);
const [bulkDeleteSyncConfirmed, setBulkDeleteSyncConfirmed] = useState(true);
```

打开单删或批量弹窗前分别重置为 `true`。把当前直接调用 `setArchiveDeleteTarget` 和 `setBulkDeletePending(true)` 的位置改为调用对应打开函数。

- [ ] **Step 5: 显式传递本次选择**

把同步函数改为接收 `confirmationEnabled`：

```js
if (!shouldSyncEhFavorite(ehFavoriteDeleteSync, confirmationEnabled)) {
  return { skipped: true, reason: 'disabled' };
}
```

`deleteArchiveWithSync(archive, confirmationEnabled)` 把该参数传下去；单删传 `archiveDeleteSyncConfirmed`，批量逐项传 `bulkDeleteSyncConfirmed`。

- [ ] **Step 6: 在两个首页弹窗中显示复选框**

仅当 `ehFavoriteDeleteSync` 为真时传入：

```jsx
<label className="confirm-option">
  <input
    type="checkbox"
    checked={archiveDeleteSyncConfirmed}
    onChange={(event) => setArchiveDeleteSyncConfirmed(event.target.checked)}
    disabled={archiveDeleting}
  />
  <span>同时从 EH/EX 收藏夹移除</span>
</label>
```

批量弹窗使用 `bulkDeleteSyncConfirmed`。若项目没有合适的现有样式，使用最少的内联 flex/gap 样式，避免新增全局 CSS。

- [ ] **Step 7: 运行测试与构建**

Run: `node --test src/lib/ehFavoriteSync.test.js`

Expected: PASS，2 tests、0 failures。

Run: `npm run build`

Expected: Vite build exit 0，无 JSX 或导入错误。

### Task 3: 重复归档页统一确认弹窗

**Status:** complete

**Files:**
- Modify: `src/pages/DeduplicatePage.jsx:1-20,306-320,542-591,717,730-end`
- Test: `src/lib/ehFavoriteSync.test.js`

**Interfaces:**
- Consumes: `ConfirmDialog`、`shouldSyncEhFavorite(globalEnabled, confirmationEnabled)`
- Produces: 重复归档页的 `deletePending` 和 `deleteSyncConfirmed` 状态

- [ ] **Step 1: 导入共享组件与决策函数**

```js
import ConfirmDialog from '../components/ConfirmDialog';
import {
  extractEhGalleryUrl,
  getEhCookie,
  getEhFavoriteDeleteSync,
  removeEhFavorite,
  shouldSyncEhFavorite,
} from '../lib/ehFavoriteSync';
```

- [ ] **Step 2: 用状态替代 `window.confirm`**

加入：

```js
const [deletePending, setDeletePending] = useState(false);
const [deleteSyncConfirmed, setDeleteSyncConfirmed] = useState(true);
const ehFavoriteDeleteSync = getEhFavoriteDeleteSync();
```

删除按钮只负责把 `deleteSyncConfirmed` 重置为 `true` 并打开 `deletePending`。`deleteSelectedArchives` 移除 `window.confirm`；开始执行时保留当前选择，完成后关闭弹窗。

- [ ] **Step 3: 把本次选择传入同步步骤**

```js
if (!shouldSyncEhFavorite(ehFavoriteDeleteSync, confirmationEnabled)) return;
```

调用时传 `deleteSyncConfirmed`，并更新 hooks 依赖列表。

- [ ] **Step 4: 渲染统一确认弹窗**

在页面末尾加入 `ConfirmDialog`，标题为“确认批量删除归档”，正文包含选中数量；全局同步开启时显示默认勾选的同款复选框。运行中禁用取消、确认和复选框。

- [ ] **Step 5: 运行所有验证**

Run: `node --test src/lib/ehFavoriteSync.test.js`

Expected: PASS，2 tests、0 failures。

Run: `node scripts/theme-self-check.mjs`

Expected: exit 0。

Run: `npm run build`

Expected: Vite build exit 0。

Run: `git diff --check`

Expected: exit 0，无空白错误。

- [ ] **Step 6: 检查最终差异**

Run: `git diff -- src/components/ConfirmDialog.jsx src/lib/ehFavoriteSync.js src/lib/ehFavoriteSync.test.js src/pages/Home.jsx src/pages/DeduplicatePage.jsx`

Expected: 仅包含设计范围内的复选框、临时状态、决策函数和测试；不包含 `worker.js` 的既有用户改动。
