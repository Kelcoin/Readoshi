# Metadata, PWA, and Category State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 平滑收起元数据提示、居中 PWA 更新文字，并让分类状态在主页恢复与后台刷新中保持一致。

**Architecture:** 复用元数据状态现有 `closing` 阶段驱动 CSS Grid 收缩，在卸载前保留内容高度。将 `selectedCategory` 纳入现有主页快照，使 UI 高亮、归档数据和后台刷新共享同一状态源。

**Tech Stack:** React 18、CSS Grid/Flexbox、Node.js assert、Vite

## Global Constraints

- 元数据提示收缩时长保持 `260ms`，并继续尊重 `prefers-reduced-motion`。
- PWA 自动激活、刷新延时、live region 和安全区布局不变。
- 普通筛选、取消分类、清空筛选、分页和无标签 API 不变。
- 不新增依赖、状态库或 DOM 高度测量。

---

### Task 1: 元数据提示收缩与 PWA 文字居中

**Files:**
- Modify: `scripts/check-metadata-plugin-result.mjs`
- Modify: `src/pages/MetadataPage.jsx:98`
- Modify: `src/components/PwaStatus.jsx:106-110`

**Interfaces:**
- Consumes: `status.closing`、现有 `metadata-status-wrap`、`primary.message`。
- Produces: 提示 DOM 保留期间的关闭态布局；居中的 PWA 文本。

- [x] **Step 1: 添加失败回归断言**

在 `scripts/check-metadata-plugin-result.mjs` 读取 PWA 组件，并加入：

```js
const pwaStatus = fs.readFileSync(new URL('../src/components/PwaStatus.jsx', import.meta.url), 'utf8');

assert.match(metadataPage, /data-open=\{status && !status\.closing \? 'true' : 'false'\}/);
assert.match(pwaStatus, /textAlign:\s*'center'/);
```

- [x] **Step 2: 运行测试确认正确失败**

Run: `node scripts/check-metadata-plugin-result.mjs`

Expected: FAIL，指出 `data-open` 关闭条件或 `textAlign` 缺失。

- [x] **Step 3: 实现最小 UI 修复**

元数据提示容器改为：

```jsx
<div className="metadata-status-wrap" data-open={status && !status.closing ? 'true' : 'false'} aria-live="polite">
```

PWA 文本样式加入：

```jsx
textAlign: 'center'
```

- [x] **Step 4: 运行回归检查**

Run: `node scripts/check-metadata-plugin-result.mjs`

Expected: PASS，退出码 `0`。

---

### Task 2: 分类状态快照恢复

**Files:**
- Modify: `scripts/check-archive-render-pipeline.mjs`
- Modify: `src/pages/Home.jsx:454,534-552`

**Interfaces:**
- Consumes: `homeSnapshot.selectedCategory`、`buildHomeStateSnapshot`。
- Produces: 恢复后的 `selectedCategory`，供按钮高亮与 `archiveBrowseStateRef` 后台刷新读取。

- [x] **Step 1: 添加失败回归断言**

在 `scripts/check-archive-render-pipeline.mjs` 加入：

```js
assert.match(home, /const \[selectedCategory, setSelectedCategory\] = useState\(\(\) => homeSnapshot\?\.selectedCategory \|\| null\)/);
assert.match(section('const buildHomeStateSnapshot', 'const saveCurrentHomeForNavigation'), /selectedCategory,/);
```

- [x] **Step 2: 运行测试确认正确失败**

Run: `node scripts/check-archive-render-pipeline.mjs`

Expected: FAIL，指出分类状态未从快照恢复。

- [x] **Step 3: 实现快照保存与恢复**

初始化分类状态：

```jsx
const [selectedCategory, setSelectedCategory] = useState(() => homeSnapshot?.selectedCategory || null);
```

在 `buildHomeStateSnapshot` 返回值中加入：

```js
selectedCategory,
```

并将 `selectedCategory` 加入该 `useCallback` 依赖数组。

- [x] **Step 4: 运行分类与无标签检查**

```powershell
node scripts/check-archive-render-pipeline.mjs
node scripts/check-untagged-archives.mjs
```

Expected: 两项均 PASS，退出码 `0`。

---

### Task 3: 全量验证、规范复审与提交推送

**Files:**
- Verify: `src/pages/MetadataPage.jsx`
- Verify: `src/components/PwaStatus.jsx`
- Verify: `src/pages/Home.jsx`
- Verify: `src/index.css`

**Interfaces:**
- Consumes: Task 1 与 Task 2 修改。
- Produces: 已验证的 `dev` 提交并推送到 `origin/dev`。

- [x] **Step 1: 运行全部现有回归检查**

```powershell
$failed=@(); Get-ChildItem -LiteralPath 'scripts' -Filter 'check-*.mjs' | Sort-Object Name | ForEach-Object { & node $_.FullName; if ($LASTEXITCODE -ne 0) { $failed += $_.Name } }; if ($failed.Count -gt 0) { exit 1 }
```

Expected: 所有检查退出码 `0`。

- [x] **Step 2: 运行生产构建与差异检查**

```powershell
npm run build
git diff --check
```

Expected: Vite 构建成功；差异检查退出码 `0`。

- [x] **Step 3: 按最新 Web Interface Guidelines 复审**

确认：动画存在 reduced-motion 处理；状态使用 `aria-live="polite"`；PWA 文本支持窄屏和安全区；未加入 `transition: all` 或同步布局测量。

- [ ] **Step 4: 提交并推送**

```powershell
git add src/pages/MetadataPage.jsx src/components/PwaStatus.jsx src/pages/Home.jsx scripts/check-metadata-plugin-result.mjs scripts/check-archive-render-pipeline.mjs docs/superpowers/plans/2026-07-14-metadata-pwa-category-state.md
git commit -m "fix(home): preserve category refresh state"
git push origin dev
```
