# Reader 渐进渲染管线设计

## 目标

Reader 打开后立即挂载稳定外壳。元数据、页清单、当前图片和下游内容独立完成、独立替换骨架，不再等待全部资源后整体切换。保持现有阅读模式、布局、交互和视觉结果。

## 根因

`Reader.jsx` 用 `loading`、`loadingPages` 两个整页早退返回独立 `ReaderStageSkeleton`。真实工具栏、舞台、`PageImage`、推荐和评论直到页清单完成才挂载。`readerReady` 又同时门控面板、封面操作、冷恢复、预加载和下游内容，导致页清单慢时整页长期停留骨架，也放大 StrictMode 重放与过期请求竞态。

## 架构

采用 Reader 实例级协调器，不建立跨页面 Store：

- `readerRenderPipeline.js` 提供纯 reducer、初始阶段和能力派生。
- `Reader` 固定挂载真实外壳，以 `metadata`、`manifest` 两个资源阶段控制槽位。
- `PageImage` 继续拥有网络、缓存、解码和可见图状态；现有全局 `imageLoadQueue` 继续负责图片并发与优先级。
- React 关键更新直接提交；当前页就绪后才允许低优先级副作用和下游内容。

阶段值统一为 `loading | ready | error`。`metadata` 与 `manifest` 独立落槽，`selection` 表示两者汇合并完成初始页选择。冷恢复快照直接初始化三阶段为 `ready`；普通冷启动初始化为 `loading`。

## 加载时序

1. 立即显示返回按钮、工具栏外壳、标题骨架、页数骨架和舞台骨架。
2. 同时请求 archive metadata 与 page manifest。
3. metadata 到达后立即显示标题及依赖元数据的操作，不等待 manifest。
4. manifest 到达后立即显示页数与导航能力。
5. metadata 与 manifest 汇合，取 LRR 进度和本地历史最大值，确定初始页，再挂当前 `PageImage`；不先展示第 1 页后跳转。
6. 当前页触发 `onReady` 后，放行邻页预载、远端 history/watchlist/server 同步、推荐和自动 Webtoon 检测。
7. EH 评论继续使用自身 IntersectionObserver，不抢首屏请求。

## 请求所有权

每次 archive 初始化创建一个 `AbortController` 和 generation。归档切换、组件卸载、StrictMode effect 清理时 abort；异步结果提交前同时检查 signal 与 generation。`getArchiveFiles`、`extractArchive` 最小扩展 `options` 参数以透传 `signal`。Abort 不显示错误，也不得触发 extract fallback。

## 能力与错误

能力从阶段派生，不再由单一 `readerReady` 决定：

- metadata ready：可打开归档信息。
- manifest ready：可显示页数；manifest 与 selection ready 且有 pages：可导航、设封面、渲染图片。
- 当前目标图片 ready：可启动低优先级任务。

metadata 失败只替换标题槽为简洁错误；manifest 失败保留已显示标题和工具栏，在舞台显示“页面列表加载失败”与重试按钮。图片错误沿用 `PageImage`。已成功槽位不因其他槽失败而回退。

## 渲染与可访问性

- 不做整页 DOM 树替换；骨架与真实槽位保留稳定尺寸，减少 CLS。
- 新增显现仅动画 `opacity/transform`，每槽一次。
- `prefers-reduced-motion: reduce` 与 iOS 禁用新增显现动画及现有遗漏的 Reader pulse/fade。
- 异步状态使用 `role="status"`、`aria-live="polite"`；错误按钮保持键盘焦点样式。
- 首图保持 `fetchpriority="high"`；非首屏图继续交由现有队列和懒加载策略。

## Webtoon 边界

首轮不重写虚拟列表或滚动定位。保留现有 Webtoon DOM/布局，只保证当前页 priority 最高、远页 priority 最低，并把自动版式检测推迟到当前页 ready 后，避免与首图争用请求和解码资源。

## 验证

- reducer：冷启动、快照、独立成功/失败、重置、能力派生。
- API：manifest/extract 透传 AbortSignal。
- Reader 接线：无整页 loading 早退；metadata/manifest 并行；abort 不 fallback；当前页 ready 门控下游任务；快照不回退。
- UI：稳定外壳、局部骨架、局部错误、reduced-motion、无障碍状态。
- 回归：全部 `scripts/check-*.mjs`、Worker syntax、Vite build、`git diff --check`。
