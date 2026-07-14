# Reader and History Stability Design

## Goal

修复滚动模式宽卡补位、沉浸阅读页码遮挡、沉浸工具栏与加载白框，以及本地/Worker/LRR 历史进度竞态。保留现有主题、卡片尺寸、分页稳定布局和阅读交互。

## Confirmed Progress Semantics

- 本地、Worker、LRR 三源进度取最大已读页，永久单调递增。
- 从第 80 页返回阅读第 20 页时，记录仍为第 80 页。
- LRR 进度可用时，每首次到达一个更大的页码立即同步一次。
- Worker 同步不因 LRR 可用而推迟到退出。

## Design

### 1. Scroll Grid Backfill

仅滚动模式启用 CSS Grid dense placement，使后续单列标准卡补入宽卡留下的单格。分页模式继续使用普通 DOM 顺序，避免动态宽卡引起分页重排和闪烁。卡片宽度、列宽、gap、宽卡跨度公式不变。

### 2. Page Indicator Avoidance

自动模式使用图片与页码胶囊最终绘制后的实际矩形判断遮挡。图片 `load` 后必须重新检查，因为 natural size 变化不会改变全屏 `<img>` 元素盒，ResizeObserver 无法感知。判断采用实际 `getBoundingClientRect()`，包含 safe-area 和 transform；任意部分交叠及现有安全边距都视为遮挡。翻页瞬时提示仍可短暂出现，随后按最终遮挡结果隐藏。

### 3. Immersive Toolbar and Loading

- 普通模式保留“进入沉浸”按钮。
- 沉浸模式不显示“退出沉浸”按钮；返回按钮负责退出。
- 沉浸模式原按钮位置改为“将当前页设为封面”，复用现有确认框、成功态和错误处理。
- 三个沉浸原生图片元素首帧隐藏；图片取得并解码后才显示。初次进入可显示纯黑背景；慢翻页继续使用现有 180ms 延迟进度条。不得显示空 `src` 的全屏破图边框。

### 4. Monotonic History Synchronization

统一历史项合并规则：同一 archive ID 的 page 取最大值，time 取最大值。`saveHistory`、进度缓存、Worker 拉取合并和同步队列均使用该规则。

Worker GET 不再无条件覆盖本地 remote cache。拉取前先 flush 已排队写入；响应与当前本地记录按 ID 合并，防止飞行中的旧快照删除刚阅读记录。显式本机删除仍同时删除本地和 Worker。

Worker 写入从 30 秒重置式 debounce 改为约 8 秒节流：首个待同步项启动 timer，后续翻页更新同一队列但不延后 timer；页面隐藏、卸载、返回主页时立即 flush。失败继续保留最新最大页并重试。

Reader 分别维护每个 archive 的最高已读页和最高已成功同步至 LRR 的页。每次阅读仍更新 history time，但 page 与旧值取最大；只有最高已读页增长时才立即调用 LRR progress API，回看旧页不发送回退值。Worker 队列可更新时间，但 page 永远取最大值。

## Error Handling

- LRR 单页同步失败：不提升“最高已成功同步页”；下一次保存、页面隐藏或退出时重试当前最高已读页。若随后读到更高页，直接同步更高值即可覆盖旧失败，不允许发送更低页。
- Worker PUT 失败：最大页记录留在队列，按既有重试策略重发。
- Worker GET 失败：继续使用本地缓存，不清空历史。
- 图片失败：保持黑色沉浸背景并使用现有错误状态，不展示破图边框。

## Tests

- CSS/源码检查：dense 仅存在于非分页网格；沉浸工具栏按钮映射正确；沉浸图片首帧隐藏并在成功后显示。
- `pageIndicatorLayout` 纯函数：轻微部分交叠、边距接触、完全分离三种矩形。
- 历史纯函数：80 后读 20 仍为 80；本地 80 + Worker 20 为 80；Worker 响应缺少飞行中新记录时仍保留；同步队列同 ID 只保留最大页。
- Reader 源码链路：LRR 仅更大页立即发送；Worker 使用节流而非连续重置 debounce。
- 最终运行全部 Node 自检、Vite 生产构建和 `git diff --check`。

## Scope Limits

- 不启用未使用的旧 `src/lib/sync.js`。
- 不重写 Reader 状态机、不引入依赖、不修改 Worker 协议。
- 不增加新的 UI 设置项。
