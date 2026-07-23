# 归档卡片补位动画设计

## 目标

共享 `ArchiveGrid` 每次因补位、卡片宽度变化、追加或容器缩放而重排时，已有卡片用快速柔和动画移动到新位置。动画不改变现有 first-fit 补位结果，不影响卡片悬浮效果，也不增加依赖。

## 方案

采用 FLIP：`ArchiveGrid` 按卡片稳定 key 保存上一帧位置；布局提交后读取新位置，计算横纵偏移，再通过 Web Animations API 将独立 CSS `translate` 从旧位置过渡到零。

- 时长：220ms。
- 曲线：`cubic-bezier(0.22, 1, 0.36, 1)`。
- 只动画已存在且位置实际变化的卡片；首次出现的卡片不动画。
- 使用独立 `translate`，不覆盖 `ArchiveCard` 已有 hover `transform`。
- 新重排发生时取消该卡旧动画，再按最新坐标启动新动画。
- `prefers-reduced-motion: reduce`、Web Animations API 不可用或位移低于半像素时直接跳过。

## 组件与数据流

1. `ArchiveGrid` 克隆卡片时继续传稳定 grid key，并让卡片根节点输出对应 data 属性。
2. `ArchiveGrid` 的 layout effect 在每次打包顺序、容器尺寸或宽卡 revision 变化后读取直接子卡片位置。
3. 上一位置与新位置均存在时计算偏移并启动动画；随后保存新位置供下次重排。
4. 卸载时取消仍在运行的动画并清空位置缓存。

动画仅属于共享 `ArchiveGrid`，因此 Home、HistoryPage、WatchlistPage 自动获得相同行为，不建立页面级第二套逻辑。

## 异常与边界

- 新增和删除卡片只动画仍存在的旧卡片。
- 快速连续重排取消旧动画，避免多动画叠加。
- 卡片 portal 标签面板继续使用现有 layout version 重锚逻辑。
- 不恢复 Grid、`style.translate` 占位修补或行 wrapper。

## 测试

- 纯函数测试：相同位置不动画；横纵位置变化生成正确偏移。
- 源码契约：共享 `ArchiveGrid` 使用 Web Animations API、220ms 曲线、稳定 data key 与 reduced-motion 保护。
- 全量执行 `npm test`、`npm run lint`、`npm run check`、`npm run build`、`git diff --check`。
