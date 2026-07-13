# Lanraragi React Reader

Lanraragi React Reader 是一个面向 [LANraragi](https://github.com/Difegue/LANraragi) 的现代阅读器前端，支持 PWA、标签翻译、分类浏览、阅读历史、智能推荐、归档上传、元数据编辑、E-Hentai 评论、重复归档检测和沉浸式阅读。

应用通过 LANraragi HTTP API 工作：首次打开页面时填写 LANraragi 地址和 API Key，之后配置保存在浏览器 `localStorage`。API 请求会发送到 `<LANraragi 地址>/api/*`，认证方式为 `Authorization: Bearer <base64(API Key)>`。

## 功能

- 仓库浏览：搜索归档，支持用逗号组合多个标签；全部档案可选择滚动自动加载或分页浏览。
- 标签翻译：加载 [EhTagTranslation Database](https://github.com/EhTagTranslation/Database)，支持中文和拼音检索。
- 分类筛选：同步 LANraragi 分类，可与标签搜索叠加。
- 随机漫游：随机抽取归档并自动补齐横向列表宽度。
- 智能推荐：根据当前归档标签和分类推荐相似内容。
- 阅读器：单页/双页/Webtoon 布局、翻页阅读、键盘导航、页码跳转、缩略图抽屉和图片预加载。
- 智能阅读布局：自动检测连续长条 Webtoon，依据相邻图片连接处的色度连续性判断，并排除接近纯白的边界。
- 沉浸模式：全屏滑动翻页，支持移动端触控、自动翻页和独立的页码指示器显示策略。
- 设为封面：在阅读器顶栏将当前页设置为归档封面，操作前会弹窗确认。
- 阅读器设置：可调整翻页方向、页码指示器、阅读布局、缩放模式、裁白边、拆分/旋转宽页、预加载数量和自动翻页间隔。
- 阅读器加载体验：切换归档时自动关闭自动翻页；桌面端和移动端骨架顶栏按实际按钮数量与尺寸占位。
- 上传归档：从设置面板进入上传页，可拖放/批量上传本地归档，或按行提交 URL。
- 下载插件匹配：URL 下载默认读取 LANraragi 下载插件声明的匹配正则，按插件顺序选择首个匹配项，也可手动指定插件。
- 上传任务队列：文件和 URL 按顺序独立执行，单项失败不会中断整批，并以进度条和状态点显示每项处理状态。
- 元数据编辑：编辑标题、摘要和标签，支持标签翻译、命名空间显示、原始标签悬浮切换、快捷删除、标签建议和元数据插件。
- 阅读历史：优先使用 LANraragi 自带阅读进度并逐页更新；可选通过 Cloudflare Worker 同步，展示元数据按 arcid 从 LANraragi 实时获取。
- 待看归档：可从右键菜单加入待看，首页组件和待看页支持刷新校验、搜索、批量选择和删除。
- 历史页与待看页：集中查看、标签搜索、通用筛选方案、批量选择和删除对应记录。
- E-Hentai 评论区：接近评论区域时按需加载，可读取、排序、筛选、回复、编辑、投票 E-Hentai 评论。
- 同步删除 E-Hentai 收藏夹：删除本地归档时，可按元数据中的 E-Hentai 链接同步移除收藏。
- 重复归档检测：按 LRReader 风格的封面缩略图相似度规则查找疑似重复归档。
- Worker KV 管理：Worker 网页可按需导入/导出阅读历史与非重复记录。
- 主题：支持跟随系统、深色、浅色三种模式；浅色模式使用较柔和的低亮度配色。
- PWA：可安装到桌面，支持缓存和自动更新提示。
- 缓存管理：支持最大缓存限制、按使用情况智能清理、手动清空缓存和图片预加载。

## Docker 部署

推荐直接使用镜像：

### Docker 镜像标签

| 分支 | Docker 标签 | 说明 |
|------|-------------|------|
| `main` | `latest` | 稳定分支镜像 |
| `dev` | `beta` | 开发分支镜像，包含最新测试功能 |

如果要部署 `dev` 分支，请把下面示例中的 `kelcoin/lanraragi-react-reader:latest` 改为 `kelcoin/lanraragi-react-reader:beta`。

```bash
docker run -d \
  --name lanraragi-react-reader \
  -p 8080:80 \
  -e LRR_SERVER_HOST=host.docker.internal \
  -e LRR_SERVER_PORT=3000 \
  kelcoin/lanraragi-react-reader:latest
```

打开 `http://localhost:8080`，在页面中填写 LANraragi 地址和 API Key 即可开始使用。

### Docker Compose

```yaml
services:
  reader:
    image: kelcoin/lanraragi-react-reader:latest
    container_name: lanraragi-react-reader
    ports:
      - "8080:80"
    environment:
      LRR_SERVER_HOST: host.docker.internal
      LRR_SERVER_PORT: 3000
      NGINX_PORT: 80
    restart: unless-stopped
```

如果 LANraragi 也在同一个 Compose 文件里，可以把 `LRR_SERVER_HOST` 改成 LANraragi 服务名：

```yaml
services:
  lanraragi:
    image: difegue/lanraragi:latest
    container_name: lanraragi
    ports:
      - "3000:3000"
    restart: unless-stopped

  reader:
    image: kelcoin/lanraragi-react-reader:latest
    container_name: lanraragi-react-reader
    ports:
      - "8080:80"
    environment:
      LRR_SERVER_HOST: lanraragi
      LRR_SERVER_PORT: 3000
      NGINX_PORT: 80
    depends_on:
      - lanraragi
    restart: unless-stopped
```

### Docker 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NGINX_PORT` | `80` | 容器内 Nginx 监听端口，通常保持 `80`，通过 `-p 主机端口:80` 暴露 |
| `LRR_SERVER` | 自动生成 | LANraragi 完整地址；设置后会覆盖下面三个拆分变量 |
| `LRR_SERVER_PROTO` | `http` | LANraragi 协议 |
| `LRR_SERVER_HOST` | `host.docker.internal` | LANraragi 主机名或 Compose 服务名 |
| `LRR_SERVER_PORT` | `3000` | LANraragi 端口 |

镜像内置 Nginx 路由：

| 路径 | 说明 |
|------|------|
| `/` | 前端页面 |
| `/api/` | 代理到 `$LRR_SERVER/api/` |
| `/eh/` | 代理到 `exhentai.org`，用于 E-Hentai 评论的备选代理 |

### 自行发布镜像

如果你 fork 后想发布自己的 Docker 镜像，在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 添加 `DOCKERHUB_USERNAME` 和 `DOCKERHUB_TOKEN`，然后手动运行 `Publish Docker image` workflow。

## 本地开发

需要 Node.js 18+ 和 npm 9+。

```bash
npm install
npm run dev
```

开发服务器默认监听 `http://localhost:27789`。

复制 `.env.example` 为 `.env.local` 后可配置 Vite 开发服务器：

```env
VITE_ALLOWED_HOSTS=reader.example.com,lanraragi.example.com
VITE_FORCE_IPV4=false
```

`VITE_ALLOWED_HOSTS` 用于反向代理访问开发服务器。`VITE_FORCE_IPV4=true` 可在 IPv6 不可达时强制使用 IPv4。

生产静态构建：

```bash
npm run build
```

构建产物输出到 `dist/`。

### 版本规则

当前版本为 `1.2.1`。项目遵循 SemVer：`fix:` 与文档/维护更新提升 patch，`feat:` 提升 minor，提交主题含 `!` 或正文含 `BREAKING CHANGE` 时提升 major。页面版本号附带 7 位 Git Hash，便于确认实际构建。

## Cloudflare Worker

项目根目录的 `worker.js` 可部署为 Cloudflare Worker，用于：

- 代理 E-Hentai 评论、评论提交、投票和收藏夹删除请求。
- 通过 KV 存储同步阅读进度、待看归档 ID、隐藏已读等最小状态；标题与标签不写入 Worker。
- 保存重复归档检测中被标记为“非重复”的归档组合。
- 在 Worker 状态网页中导入/导出 KV 数据。

Worker 状态页底部会显示项目名、版本号和 GitHub 链接。可选配置 Worker 文本变量 `APP_VERSION` 覆盖内置版本号，建议使用与前端一致的 `v<SemVer>+<7位Git Hash>` 格式。

部署后，在登录页或首页设置面板填写 Worker 地址，例如 `https://your-worker.example.workers.dev`。

### KV 与认证

Worker 依赖名为 `HISTORY_KV` 的 KV 绑定。受保护接口会读取 KV 中的 `tokens` 字段，前端填写的访问 Token 必须与其中一个 Token 一致。

`tokens` 示例：

```json
["your-sync-token"]
```

KV 导入/导出功能不需要额外的管理 API Key。打开 Worker 网页后，点击“打开导入 / 导出菜单”，输入 KV `tokens` 中配置的合法 Token 并验证通过，即可导入或导出该 Token 对应的 KV 数据。

### Worker 网页

直接打开 Worker 根路径可以查看状态页：

- 服务状态、请求计数、同步用户数、阅读记录数。
- KV 绑定、KV 读取和 Token 认证状态。
- 非重复记录数量。
- KV 导入/导出工具。

KV 导入/导出可以选择：

- 阅读历史。
- 待看归档。
- 重复归档检测的非重复记录。
- 多类数据一起导入或导出。

### E-Hentai Cookie

E-Hentai 评论区和同步删除 E-Hentai 收藏夹需要合法 E-Hentai Cookie。同步删除收藏夹至少需要 `ipb_member_id` 与 `ipb_pass_hash`；未配置合法 Cookie 时，“同步删除 E-Hentai 收藏夹”开关会被锁定为关闭。

## 常用操作

### 标签搜索

- 输入标签名，例如 `full color`。
- 输入中文或拼音首字母查找翻译标签。
- 使用 `namespace:value` 精确搜索，例如 `female:schoolgirl`。
- 多个标签用逗号分隔。

### 阅读器

| 操作 | 方式 |
|------|------|
| 上/下翻页 | 滚轮、Page Up/Down、方向键、空格键 |
| 打开缩略图面板 | 右键点击页面或使用工具栏按钮 |
| 跳页 | 在工具栏页码输入框回车 |
| 返回首页 | 工具栏返回按钮 |
| 切换阅读方式 | 阅读设定中选择单页、双页、Webtoon 或自动检测，并调整翻页方向 |
| 沉浸模式 | 工具栏沉浸模式按钮 |
| 设为封面 | 工具栏“设为封面”按钮，确认后将当前页设为归档封面 |
| 阅读历史 | 工具栏阅读历史按钮 |

当归档阅读进度超过 80% 时，如果该归档存在于待看列表，会自动从待看中移除。

### 设置面板

首页右上角“设置”中可以配置：

- 裁剪封面。
- 历史记录中隐藏已读完。
- 档案浏览模式：滚动模式滑到底部自动加载更多；分页模式按当前屏幕列数计算每页数量，最少显示 20 个，并用页码手动切换。
- E-Hentai 评论区与 E-Hentai Cookie。Cookie 和访问 Token 默认以模糊方式显示，鼠标悬浮或聚焦时显示原文。
- 同步删除 E-Hentai 收藏夹。
- Cloudflare Worker 端点与访问 Token。
- 进入重复归档检测。
- 上传归档：进入本地文件/URL 上传页。
- 导入/导出所有可配置项，包括服务器、Worker、主题、阅读器、E-Hentai、缓存、筛选条件和筛选预设。

### 上传归档

首页右上角“设置”→“上传归档”进入上传页。上传页包含两个独立区域：

- 本地添加：支持拖放或一次选择多个 ZIP、CBZ、RAR、CBR、7Z、PDF 文件。文件会按名称、大小和修改时间去重，并逐项调用 LANraragi `PUT /api/archives/upload`。
- 从互联网添加：文本框按“一行一个 URL”解析，只接受 HTTP/HTTPS。默认“自动匹配”会使用 LANraragi 下载插件返回的 URL 正则逐个匹配；没有匹配结果时可手动选择插件。
- 每个任务显示等待、处理中、成功或失败状态；任务行背景会作为实时进度条，左侧光点表示当前状态。任务全部结束后会清理 LANraragi 搜索缓存，便于主页显示新归档。
- 上传或下载执行期间页面会阻止重复提交；离开页面或刷新时会提示任务仍在进行。

上传页使用当前登录的 LANraragi 地址和 API Key，不会把本地文件内容或 URL 写入 Worker KV。

### 待看归档

待看归档用于临时保存之后想读的归档：

- 在归档卡片右键菜单中选择“加入待看”。
- 对待看归档再次打开右键菜单可取消待看。
- 首页待看组件位于继续阅读和随机漫游之间，可刷新校验归档是否仍存在于 LANraragi，也可展开或收起。
- 待看页支持标签搜索、标签补全、通用筛选方案、批量选择和批量删除待看记录。
- 待看数据可通过 Cloudflare Worker 按 Token 同步，不同 Token 之间互相独立。

### 元数据编辑

可从归档右键菜单、阅读器顶栏或归档卡片操作中进入“编辑元数据”。页面支持：

- 修改标题、摘要和逗号分隔标签；保存前会检查服务器元数据是否被其他操作修改。
- 标签胶囊优先显示翻译后的命名空间和标签，鼠标悬浮时切换为原始标签，点击标签复制原始值，点击叉号删除。
- 输入标签时支持中文、拼音和标签建议；输入 `artist:`、`uploader:`、`source:`、`date_added:` 等命名空间时保留命名空间显示。
- 元数据插件只负责把返回标签合并到当前编辑内容，必须点击“保存元数据”才会写回服务器；未填写插件参数或 URL 时会自动使用当前标题作为参数。
- 页面提供阅读归档、删除归档和返回上一界面操作；删除确认可按本次选择同步移除 E-Hentai 收藏夹。

### 重复归档检测

重复归档检测会读取归档封面缩略图，按 LRReader 风格算法生成低分辨率签名并比较相似度。

主要特性：

- 可选择检测时间范围，默认从 `2000-01-01` 到今天；起始日期为 `2000-01-01` 或更早时视为处理全部归档。
- 没有添加日期的归档会被纳入检测。
- 缺失封面的归档会被排除。
- 检测过程分阶段显示读取封面、比较封面和疑似重复组数量。
- 疑似重复按两本一组显示；同一本与多本相似时显示为多个独立组合。
- 可点击归档卡片选择要删除的归档，也可点击分组背景将该组合标记为非重复。
- 可保存、载入和删除本地检测结果，避免退出页面后丢失选择状态。
- 智能选择会优先保留包含 `other:uncensored` 的归档，优先删除包含 `other:extraneous ads` 的归档；条件相同时优先删除体积较小的归档。
- 标记为非重复的组合会写入 Worker KV，下次检测时自动忽略。
- 删除归档时如果启用了同步删除 E-Hentai 收藏夹，会根据元数据中的 E-Hentai 链接同步移除收藏。

### 图片缓存

设置面板中的“图片缓存”区域显示当前缓存占用和上限，支持调整最大缓存限制、智能清理和手动清空。智能清理优先移除最久未使用且不在当前阅读任务中的缓存项，避免缓存无限增长。

## 数据存储

浏览器本地会保存：

- LANraragi 地址和 API Key。
- Worker 地址和访问 Token。
- 主题模式、阅读器设置、E-Hentai Cookie。
- 图片缓存上限和阅读器增强开关。
- 阅读历史、待看归档、本地筛选、随机漫游近期记录。
- 重复归档检测的本地保存结果。

Worker KV 会保存：

- `tokens`：允许访问受保护接口的 Token 列表。
- `history:<token>`：对应 Token 的远端阅读历史和设置。
- `watchlist:<token>`：对应 Token 的待看归档。
- `dedupe:non-duplicates`：重复归档检测中标记为非重复的全局组合；读取、写入、导入和导出都必须携带合法 Token。
- `stats:requests`：Worker 请求计数。

同步数据使用 schema v2：历史项只保存 `id`、`page`、`time`，待看项只保存 `id`、`addedAt`。Worker 在读取或写入旧数据时会自动移除标题、标签、页数等冗余元数据并回写新格式；前端根据 arcid 从 LANraragi 获取展示元数据，确认归档不存在时自动清理对应记录。

Worker 的 `history_retention_days` 控制历史记录保留时间。Worker 会按记录时间清理超过该天数的历史，不再使用固定条数作为历史上限；同步请求失败时前端保留本地状态并显示离线提示。

历史与待看同步统一发送普通 JSON。Worker 仍兼容旧版前端发送的 gzip JSON 请求体。

首次登录会读取并缓存 LANraragi `/api/info`；进度策略以 `server_tracks_progress` 为准，并兼容旧版返回的 `0`/`1`。LANraragi 启用自带进度记录时，阅读器每页只提交一次 LANraragi 进度；带 `new` 标记的归档先提交第 1 页以移除标记。Worker 进度只在离开阅读器、页面进入后台或关闭页面时合并提交，刷新历史时以 LANraragi 进度校准且仅在不一致时回写。LANraragi 未启用进度记录时，Worker 恢复按 30 秒窗口合并提交。历史与待看 GET 在短时间内复用请求结果；归档存在性清理仅在页面可见时每 6 小时检查一次；Worker 状态页全量统计缓存 5 分钟。

## 许可

本项目采用 [MIT License](LICENSE) 许可。
