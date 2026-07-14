# Reader and History Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复滚动宽卡补位、沉浸阅读遮挡与加载问题，并让本地/Worker/LRR 历史进度永久单调递增。

**Architecture:** 保留现有 Home 与 Reader 结构，只在各自根因位置分流行为。历史模块提供统一最大页合并函数，Worker 使用短周期节流队列，Reader 用最高已读/最高已同步双水位控制 LRR；视觉问题使用模式 CSS 和真实 DOM rect/load 事件处理。

**Tech Stack:** React 18、原生 Fetch/DOM/CSS Grid、Node.js `assert` 自检、Vite 5。

## Global Constraints

- 不新增依赖，不修改 Worker 协议，不启用未使用的 `src/lib/sync.js`。
- 本地、Worker、LRR 同一归档 page 永远取最大值；time 取最大值。
- LRR 每首次到达更高页立即同步；回看旧页不得发送回退值。
- 普通模式保留进入沉浸；沉浸模式用返回键退出，并把原退出按钮位置改为设封面。
- 不改变卡片尺寸、gap、宽卡公式、主题和现有翻页交互。
- 每项生产修改前必须运行对应失败检查；完成后运行全部 Node 自检、`npm run build`、`git diff --check`。

---

### Task 1: 单调历史合并规则

**Files:**
- Modify: `src/lib/historyProgressCache.js`
- Create: `scripts/check-history-monotonic-sync.mjs`

**Interfaces:**
- Produces: `mergeMonotonicHistoryItems(...lists) -> Array<{id,page,time}>`
- Produces: `mergeHistoryProgressCache(cache, items)` 永远保留最大 page/time。
- Produces: `mergeCachedHistoryProgress(items, cache)` 不允许 cached 或 item 使 page 回退。

- [ ] **Step 1: 写失败检查**

```js
import assert from 'node:assert/strict';
import {
  mergeCachedHistoryProgress,
  mergeHistoryProgressCache,
  mergeMonotonicHistoryItems,
} from '../src/lib/historyProgressCache.js';

assert.deepEqual(
  mergeMonotonicHistoryItems(
    [{ id: 'a', page: 80, time: 100 }],
    [{ id: 'a', page: 20, time: 200 }, { id: 'b', page: 3, time: 150 }],
  ),
  [{ id: 'a', page: 80, time: 200 }, { id: 'b', page: 3, time: 150 }],
);
assert.equal(mergeHistoryProgressCache({ a: { page: 80, time: 100 } }, [{ id: 'a', page: 20, time: 200 }]).a.page, 80);
assert.equal(mergeCachedHistoryProgress([{ id: 'a', page: 20, time: 200 }], { a: { page: 80, time: 100 } })[0].page, 80);
```

- [ ] **Step 2: 运行检查，确认 RED**

Run: `node scripts/check-history-monotonic-sync.mjs`

Expected: FAIL，`mergeMonotonicHistoryItems` 尚未导出，或 page 实际回退到 20。

- [ ] **Step 3: 实现最小纯函数**

```js
export function mergeMonotonicHistoryItems(...lists) {
  const byId = new Map();
  for (const item of lists.flatMap((list) => Array.isArray(list) ? list : [])) {
    const id = String(item?.id || item?.arcid || '').trim();
    if (!id) continue;
    const current = byId.get(id) || { id, page: 0, time: 0 };
    byId.set(id, {
      id,
      page: Math.max(current.page, Math.max(0, Number.parseInt(item.page, 10) || 0)),
      time: Math.max(current.time, Math.max(0, Number(item.time) || 0)),
    });
  }
  return Array.from(byId.values()).sort((a, b) => b.time - a.time);
}
```

调整两个 cache merge 函数：page、time、total 分别取最大值，不再让较新 time 携带较低 page 覆盖。

- [ ] **Step 4: 运行检查，确认 GREEN**

Run: `node scripts/check-history-monotonic-sync.mjs`

Expected: exit 0。

- [ ] **Step 5: 提交检查点**

```bash
git add src/lib/historyProgressCache.js scripts/check-history-monotonic-sync.mjs
git commit -m "fix: keep history progress monotonic"
```

### Task 2: Worker 拉取与节流同步

**Files:**
- Modify: `src/lib/history.js`
- Modify: `scripts/check-history-monotonic-sync.mjs`

**Interfaces:**
- Consumes: `mergeMonotonicHistoryItems(...lists)`。
- Produces: `saveHistory(archive, page)` 把当前 cache 与新记录按最大页合并。
- Produces: Worker GET 结果与当前 remote cache 合并；queued PUT 约 8 秒节流。

- [ ] **Step 1: 扩展失败检查**

```js
const historySource = fs.readFileSync(new URL('../src/lib/history.js', import.meta.url), 'utf8');
assert.match(historySource, /const HISTORY_SYNC_INTERVAL_MS = 8 \* 1000/);
assert.match(historySource, /if \(historyFlushTimer\) return/);
assert.match(historySource, /await flushHistorySync\(\)/);
assert.match(historySource, /mergeMonotonicHistoryItems\(remoteHistories, getStoredHistory\(\)\)/);
assert.doesNotMatch(historySource, /deferUntilExit/);
```

- [ ] **Step 2: 运行检查，确认 RED**

Run: `node scripts/check-history-monotonic-sync.mjs`

Expected: FAIL，仍存在 30 秒 debounce、GET 覆盖及 deferUntilExit。

- [ ] **Step 3: 改为 8 秒节流并保护 GET**

```js
const HISTORY_SYNC_INTERVAL_MS = 8 * 1000;

function scheduleHistoryFlush(delay = HISTORY_SYNC_INTERVAL_MS) {
  if (historyFlushTimer) return;
  historyFlushTimer = setTimeout(() => {
    historyFlushTimer = null;
    flushHistorySync().catch(() => {});
  }, delay);
}

function queueHistorySync(item) {
  // 保留现有 scope 检查
  const queued = pendingHistorySync.get(item.id);
  pendingHistorySync.set(item.id, mergeMonotonicHistoryItems(
    queued ? [queued] : [],
    [item],
  )[0]);
  scheduleHistoryFlush();
}
```

远端 GET 前执行 `await flushHistorySync()`；响应转为 `remoteHistories` 后用 `mergeMonotonicHistoryItems(remoteHistories, getStoredHistory())` 合并再写 cache。`saveHistory` 用相同函数合并旧记录与新记录，删除 `deferRemote/deferUntilExit` 分支。失败 PUT 重新入队时也用最大页合并。

- [ ] **Step 4: 运行检查，确认 GREEN**

Run: `node scripts/check-history-monotonic-sync.mjs`

Expected: exit 0。

- [ ] **Step 5: 提交检查点**

```bash
git add src/lib/history.js scripts/check-history-monotonic-sync.mjs
git commit -m "fix: serialize worker history sync"
```

### Task 3: Reader 的 LRR 双水位同步

**Files:**
- Modify: `src/pages/Reader.jsx`
- Modify: `scripts/check-history-monotonic-sync.mjs`

**Interfaces:**
- Reader 内部 `highestObservedPageRef: Map<archiveId, number>`。
- Reader 内部 `highestLrrSyncedPageRef: Map<archiveId, number>`。
- Consumes: `saveHistory(archive, page)` 单调合并；`lrrApi.updateProgress(id, page)`。

- [ ] **Step 1: 扩展失败检查**

```js
const readerSource = fs.readFileSync(new URL('../src/pages/Reader.jsx', import.meta.url), 'utf8');
assert.match(readerSource, /highestObservedPageRef/);
assert.match(readerSource, /highestLrrSyncedPageRef/);
assert.match(readerSource, /page > highestObservedPage/);
assert.doesNotMatch(readerSource, /deferRemote:/);
```

- [ ] **Step 2: 运行检查，确认 RED**

Run: `node scripts/check-history-monotonic-sync.mjs`

Expected: FAIL，Reader 仍按 `${archiveId}:${page}` 去重且会发送回看的低页。

- [ ] **Step 3: 实现最高页同步**

用两个 `Map` ref 替代 `lrrProgressSentRef`。archive/meta 初始化时把 LRR 当前 progress 写入两个水位。每次 currentIndex 变化：

```js
const observed = highestObservedPageRef.current.get(archiveId) || 0;
const highestPage = Math.max(observed, page);
highestObservedPageRef.current.set(archiveId, highestPage);
saveHistory(archive, highestPage).catch(() => {});

const synced = highestLrrSyncedPageRef.current.get(archiveId) || 0;
if (serverTracksProgress && highestPage > synced) {
  lrrApi.updateProgress(archiveId, highestPage).then(() => {
    highestLrrSyncedPageRef.current.set(archiveId, highestPage);
  }).catch(() => {});
}
```

页面隐藏、卸载、返回主页继续调用 `flushHistorySync()`；LRR 失败不提升 synced 水位，后续 effect/退出处理重试最高 observed。

- [ ] **Step 4: 运行检查，确认 GREEN**

Run: `node scripts/check-history-monotonic-sync.mjs`

Expected: exit 0。

- [ ] **Step 5: 提交检查点**

```bash
git add src/pages/Reader.jsx scripts/check-history-monotonic-sync.mjs
git commit -m "fix: prevent reader progress rollback"
```

### Task 4: 滚动模式补位

**Files:**
- Modify: `src/index.css`
- Modify: `scripts/check-archive-render-pipeline.mjs`

**Interfaces:**
- `.archive-grid:not(.is-paged)` 启用 dense；`.archive-grid.is-paged` 保持普通顺序。

- [ ] **Step 1: 修改现有检查形成 RED**

```js
assert.match(css, /\.archive-grid:not\(\.is-paged\)\s*\{[^}]*grid-auto-flow:\s*dense/s);
assert.doesNotMatch(css, /\.archive-grid\s*\{[^}]*grid-auto-flow:\s*dense/s);
```

- [ ] **Step 2: 运行检查，确认 RED**

Run: `node scripts/check-archive-render-pipeline.mjs`

Expected: FAIL，滚动模式 dense 规则不存在。

- [ ] **Step 3: 添加模式限定 CSS**

```css
.archive-grid:not(.is-paged) {
  grid-auto-flow: dense;
}
```

- [ ] **Step 4: 运行检查，确认 GREEN**

Run: `node scripts/check-archive-render-pipeline.mjs`

Expected: exit 0。

- [ ] **Step 5: 提交检查点**

```bash
git add src/index.css scripts/check-archive-render-pipeline.mjs
git commit -m "fix: restore scroll grid backfill"
```

### Task 5: 页码指示器最终矩形复测

**Files:**
- Modify: `src/lib/pageIndicatorLayout.js`
- Modify: `src/pages/Reader.jsx`
- Create: `scripts/check-reader-immersive.mjs`

**Interfaces:**
- Consumes: `rectsOverlap(imageRect, indicatorRect, margin)`。
- Reader `checkIndicatorOverlap()` 使用 `indicator.getBoundingClientRect()` 和最终 contain image rect。
- 图片 `load` 事件触发一次合批 overlap check。

- [ ] **Step 1: 写失败检查**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rectsOverlap } from '../src/lib/pageIndicatorLayout.js';

assert.equal(rectsOverlap(
  { left: 0, right: 200, top: 0, bottom: 45 },
  { left: 80, right: 150, top: 35, bottom: 65 },
  6,
), true);
assert.equal(rectsOverlap(
  { left: 0, right: 200, top: 0, bottom: 20 },
  { left: 80, right: 150, top: 35, bottom: 65 },
  6,
), false);

const reader = fs.readFileSync(new URL('../src/pages/Reader.jsx', import.meta.url), 'utf8');
assert.match(reader, /indicator\.getBoundingClientRect\(\)/);
assert.match(reader, /addEventListener\('load', scheduleOverlapCheck\)/);
```

- [ ] **Step 2: 运行检查，确认 RED**

Run: `node scripts/check-reader-immersive.mjs`

Expected: FAIL，Reader 仍手算 indicator bottom 且未监听图片 load。

- [ ] **Step 3: 使用最终 DOM rect**

`checkIndicatorOverlap` 直接读取当前 indicator rect；为 base/lowered 模式先设置 mode，下一帧复测实际 rect。ResizeObserver 保留；effect 同时监听当前图片 `load`，cleanup 时移除。图片 load 后调用 `scheduleOverlapCheck`，确保 natural size 生效后重新计算 contain rect。

- [ ] **Step 4: 运行检查，确认 GREEN**

Run: `node scripts/check-reader-immersive.mjs`

Expected: exit 0。

- [ ] **Step 5: 提交检查点**

```bash
git add src/lib/pageIndicatorLayout.js src/pages/Reader.jsx scripts/check-reader-immersive.mjs
git commit -m "fix: recheck page indicator overlap"
```

### Task 6: 沉浸工具栏与黑屏加载态

**Files:**
- Modify: `src/pages/Reader.jsx`
- Modify: `scripts/check-reader-immersive.mjs`

**Interfaces:**
- 普通模式 fullscreen 按钮仅进入沉浸。
- 沉浸模式同槽位调用现有 `handleSetCover`。
- 三个 raw immersive img 初始 `display: 'none'`；现有 loader 解码成功后设为可见。

- [ ] **Step 1: 扩展失败检查**

```js
assert.match(reader, /viewMode !== 'immersive'[\s\S]*title="沉浸模式"/);
assert.match(reader, /viewMode === 'immersive'[\s\S]*onClick=\{handleSetCover\}/);
assert.doesNotMatch(reader, /退出沉浸/);
assert.equal((reader.match(/display:\s*'none'/g) || []).length >= 3, true);
```

- [ ] **Step 2: 运行检查，确认 RED**

Run: `node scripts/check-reader-immersive.mjs`

Expected: FAIL，仍有“退出沉浸”按钮且 raw img 首帧可见。

- [ ] **Step 3: 最小 JSX 调整**

把 fullscreen 按钮包在 `viewMode !== 'immersive'` 条件中；沉浸分支渲染与普通模式相同的 cover button，复用 `handleSetCover`、`coverSetting`、`coverSetPage`。给 `imgLeftRef`、`imgRightRef`、`imgCurrRef` 三个 `<img>` 的初始 inline style 加 `display: 'none'`；现有 `loadImg` 在 decode 后继续执行 `style.display = ''`。

- [ ] **Step 4: 运行检查，确认 GREEN**

Run: `node scripts/check-reader-immersive.mjs`

Expected: exit 0。

- [ ] **Step 5: 最终验证**

Run:

```bash
node scripts/check-history-monotonic-sync.mjs
node scripts/check-reader-immersive.mjs
node scripts/check-archive-render-pipeline.mjs
node scripts/check-untagged-archives.mjs
node scripts/check-metadata-plugin-result.mjs
node scripts/check-tag-panel-alignment.mjs
node scripts/check-watchlist-glow.mjs
npm run build
git diff --check
```

Expected: 全部 exit 0；Vite 生产构建完成，无新错误。

- [ ] **Step 6: 提交检查点**

```bash
git add src/pages/Reader.jsx scripts/check-reader-immersive.mjs
git commit -m "fix: polish immersive reader controls"
```
