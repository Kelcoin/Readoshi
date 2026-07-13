# Light Theme and iOS Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Reader 浅色主题、窄宽工具栏、筛选方案下拉入口、iOS 稳定性和主页首帧滚动恢复。

**Architecture:** 先把响应式和平台判断放入纯函数并用 Node 测试锁定，再以语义 CSS 变量替换 Reader/EH 的硬编码颜色。图片切换保留已解码旧图直到新图就绪；主页纵向滚动仅在布局阶段恢复一次。

**Tech Stack:** React 18、Vite 5、CSS variables、ResizeObserver、Node `node:test`

## Global Constraints

- 采用冷调瓷白浅色方案，保留现有蓝色主强调色。
- 沉浸阅读舞台保持纯黑；普通 Reader UI 必须跟随主题。
- 动画仅使用 `opacity`、`transform` 或必要的尺寸属性，并尊重 `prefers-reduced-motion`。
- 不新增运行时依赖，不重构无关页面。
- 当前会话内联实施，不派子代理。

---

### Task 1: Reader 自适应与 iOS 判定

**Files:** `src/lib/readerUiState.js`, `src/lib/readerUiState.test.mjs`, `src/pages/Reader.jsx`

**Interfaces:** `shouldUseCompactReaderToolbar({ isMobile, availableWidth, requiredWidth, tolerance }) => boolean`; `isIosWebKitPlatform(userAgent, platform, maxTouchPoints) => boolean`.

- [ ] 写失败测试：移动端强制紧凑、桌面溢出切换、宽度足够保留文字、iPadOS 桌面 UA。
- [ ] 运行 `node --test src/lib/readerUiState.test.mjs`，预期缺少导出而失败。
- [ ] 实现纯函数；Reader 用 `ResizeObserver` 测量工具栏并设置 `data-compact`。
- [ ] 所有支持紧凑显示的按钮同时渲染 SVG 与文字层，使用稳定尺寸。
- [ ] 重跑测试，预期通过。

### Task 2: Reader 与 EH 语义主题覆盖

**Files:** `src/index.css`, `src/pages/Reader.jsx`, `src/components/EhComments.jsx`, `src/lib/readerThemeCoverage.test.mjs`

**Interfaces:** 新增 `--reader-*`、`--comment-*` 语义变量及对应组件类。

- [ ] 写失败的源码回归测试：要求语义类，禁止已知破坏浅色主题的行内颜色。
- [ ] 运行 `node --test src/lib/readerThemeCoverage.test.mjs`，预期失败。
- [ ] 添加深浅主题变量，替换骨架、顶栏、换页、面板、抽屉、加载 UI 和 EH 评论硬编码颜色。
- [ ] 添加焦点、悬停、禁用、reduced-motion；移除 `transition: all`。
- [ ] 重跑主题覆盖及已有测试，预期通过。

### Task 3: 历史/待看筛选方案下拉

**Files:** `src/components/ArchiveSearchBox.jsx`, `src/index.css`, `src/lib/archiveSearchUi.test.mjs`

**Interfaces:** 保持现有 props；内部通过 `useId()` 关联菜单。

- [ ] 写失败测试：要求独立 `.archive-search-menu-button`、`aria-expanded`、`aria-controls` 和箭头。
- [ ] 运行测试，预期失败。
- [ ] 分离搜索执行与菜单展开；保留 Enter 搜索、预设增删应用。
- [ ] 窄屏保持同一行且按钮不可被压缩；展开时箭头旋转。
- [ ] 重跑测试，预期通过。

### Task 4: iOS 卡片与无闪屏图片替换

**Files:** `src/components/ArchiveCard.jsx`, `src/pages/Reader.jsx`, `src/index.css`, `src/lib/iosReaderRegression.test.mjs`

**Interfaces:** `PageImage` 加载期间保留旧 `imgSrc`，解码成功后原位替换。

- [ ] 写失败测试：移动标题不再强制 accent；PageImage 请求开始不清空 `imgSrc`。
- [ ] 运行测试，预期失败。
- [ ] 删除移动标题行内颜色并添加 WebKit 安全样式。
- [ ] 保留旧解码图；新图解码成功再替换；失败时保留旧页。
- [ ] 在 `data-ios="true"` 下添加稳定背景和合成层规则。
- [ ] 重跑测试，预期通过。

### Task 5: Home 首绘前滚动恢复

**Files:** `src/pages/Home.jsx`, `src/lib/homeScrollRestore.test.mjs`

**Interfaces:** 纵向恢复只在 `useLayoutEffect` 执行一次；横向列表挂载后独立恢复。

- [ ] 写失败测试：要求 `useLayoutEffect`，禁止双 RAF 纵向恢复，横向恢复不得调用 `window.scrollTo`。
- [ ] 运行测试，预期失败。
- [ ] 把纵向恢复移入一次性 layout effect，并立即标记已消费。
- [ ] 保留只处理三个横向列表的挂载恢复 effect。
- [ ] 重跑测试，预期通过。

### Task 6: 验证与复核

**Files:** `task_plan.md`, `findings.md`, `progress.md`

- [ ] 运行 `node --test src/lib/*.test.mjs`。
- [ ] 运行 `node scripts/theme-self-check.mjs`。
- [ ] 对修改的 JS helper/test 运行 `node --check`。
- [ ] 运行 `npm run build`。
- [ ] 运行 `git diff --check`，检查 `git diff --stat` 和相关 diff。
- [ ] 写入精确结果及仍需真机完成的 iOS 手动验收项。

