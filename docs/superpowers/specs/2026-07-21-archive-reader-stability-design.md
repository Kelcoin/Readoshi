# 档案列表与阅读器稳定性设计

## 范围

本次只处理五项已确认问题：标签建议框定位、档案数量位置、阅读器翻页残影、图片解码并发设置、全部档案刷新及封面队列卡死。复用现有 API、缓存、队列和 Reader 状态模块，不新增依赖。

## 根因

- 标签建议框使用 portal 和 fixed 坐标。向上展开时以 `maxHeight` 推算 `top`，实际内容较短便远离输入框；可用空间不足时强制最小高度又可能覆盖输入框。
- 窄屏 CSS 把档案标题与数量改为纵向排列。
- `PageImage` 在新页解码期间保留旧 `imgSrc`，`getPendingSpreadRenderState` 又保留旧 slot 数，导致 page1 位图出现在 page2 布局内。
- Reader decode queue 是模块级固定配置，设置无法改变并发；当前实际默认值为 2，用户期望默认 3。
- 滚动浏览每 60 秒及长时间失焦后会清 LANraragi 搜索缓存并重取列表，造成偶发整体刷新。封面共享队列没有超时或取消；两个普通请求挂起即可永久阻塞后续封面。

## UI 与 Reader 行为

### 标签建议框

继续 portal 到 `document.body`。统一使用 fixed 定位：向下展开用 `top` 锚定输入框底部，向上展开用 `bottom` 锚定输入框顶部。最大高度只取该方向真实可用空间，不设置会侵入输入框的强制最小高度。resize 和任意祖先滚动时重新定位。删除未再使用的移动端位移和 absolute fallback。

### 档案数量

“共 N 个档案”或“筛选结果 N 个”始终紧跟“全部档案”右侧。窄屏保持横向，允许整个摘要区域收缩；不再把数量放到下一行。

### 翻页过渡

非 webtoon 阅读模式切换目标页时立即隐藏旧位图。目标页未准备好时显示深色占位和“正在切换到第 N 页…”；双页模式等待目标 spread 全部页准备好再结束切换态。已预解码目标允许直接显示，不人为增加延迟。webtoon 连续滚动行为不变。

### 最大解码并发

Reader 设置新增 `maxConcurrentDecodes`，接受整数 1-6，默认 3。设置变更立即影响后续排队任务；已开始的解码不强制中断。该配置只控制 Reader decode queue，不改变缩略图网络请求并发。

## 档案分页与筛选缓存

### 普通档案分页

2026-07-22 回归修订：普通“全部档案”恢复使用 `GET /api/search`。初载、加载更多和翻页分别传入当前 `start`、`sortby`、`order`，只接收 LANraragi 服务端页大小对应的数据。`recordsFiltered` 用作当前结果总数，`recordsTotal` 仅作服务端全库参考。

不再让 Home 调用 `GET /api/archives`。该端点没有分页参数，完整返回数据库内所有档案；大型库会让每次首载或强制重取承担全库传输与解析成本。

无标签模式继续先取 `/api/archives/untagged` 的 ID，但只为当前页或当前加载段调用 metadata API，不再为映射当前页而加载全库。

### 档案网格

ArchiveGrid 使用原生 Flex 换行：`display: flex; flex-wrap: wrap; justify-content: center`。普通卡保持 150px，横向封面卡保持 316px；每个视觉行由浏览器原生居中。删除 `grid-auto-flow: dense`、逐行 `style.translate`、ResizeObserver 和 MutationObserver，避免绘制位置脱离布局占位后发生卡片重叠。

### 短期筛选缓存

有搜索词或分类条件时仍调用 `/api/search`，不复刻 LANraragi 搜索语法。客户端缓存每次搜索响应 60 秒，最多保留最近 30 个条目。缓存键包含服务器作用域、规范化后的筛选文本、sort、order 和 start；相同条件与页段在 TTL 内直接返回缓存响应。并发相同请求共享 Promise。

以下情况清空筛选缓存：手动刷新、档案删除、上传、元数据编辑、插件写入元数据，以及服务器配置切换。阅读进度和设置封面不会影响标签/标题搜索结果，不清筛选缓存。

### 写操作后的同步

服务端 API 始终是写操作权威。成功后再修改客户端缓存：

- 删除：从当前 UI 移除并清筛选缓存；
- 元数据编辑：更新现有 metadata cache 并清筛选缓存；
- 阅读进度：更新现有 metadata cache 中的 progress/lastreadtime；
- 上传：清筛选缓存，让下次分页请求读取服务端结果；
- 设置封面：只失效对应图片缓存。

手动“刷新”会清 LANraragi 搜索缓存和客户端筛选缓存，再强制重取当前第一页。删除一分钟定时刷新和聚焦刷新；页面内导航继续复用已有 Home 快照，不主动替换列表。

## 封面队列恢复

共享图片加载队列为任务创建 AbortController，并给网络阶段设置 20 秒上限。超时会中断 fetch、释放队列槽并让卡片进入“封面不可用”状态；用户或后续重新挂载可再次请求。现有优先级和同 key 请求去重保留。

## 错误处理

- 分页请求失败时保留当前可见数据并显示现有重试 UI，不用空数组覆盖。
- 筛选缓存只保存成功响应；失败 Promise 立即移除。
- 过期缓存不作为错误回退，避免把已删除或已编辑档案重新显示。
- AbortError 不显示为服务器错误；真正超时转为可重试封面错误。

## 验证

- 纯函数测试：建议框上下锚点、缓存键/TTL/容量、Reader 设置 1-6 归一化。
- 队列测试：并发 1、动态调到 6、超时释放槽、同 key 去重。
- Reader 回归：切页 pending 时旧位图不可见且提示目标页；目标 spread 全部 ready 后显示。
- Home 契约：无一分钟/聚焦全量刷新；未筛选走 `/api/search` 分页；相同筛选 60 秒内不重复请求。
- ArchiveGrid 契约：Flex 原生换行和逐行居中；无 JS translate/DOM observer；宽卡保持 316px。
- 完整运行 `npm test`、`npm run lint`、`npm run check`、`npm run build`、`git diff --check`，并在浏览器检查移动端建议框、标题计数及慢速翻页。
