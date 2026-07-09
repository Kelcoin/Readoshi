# LRR Modern Reader

LRR Modern Reader 是一个面向 [LANraragi](https://github.com/Difegue/LANraragi) 的现代阅读器前端，支持 PWA、标签翻译、分类浏览、阅读历史、智能推荐、EH 评论、重复归档检测和沉浸式阅读。

应用通过 LANraragi HTTP API 工作：首次打开页面时填写 LANraragi 地址和 API Key，之后配置保存在浏览器 `localStorage`。API 请求会发送到 `<LANraragi 地址>/api/*`，认证方式为 `Authorization: Bearer <base64(API Key)>`。

## 功能

- 仓库浏览：搜索归档，支持用逗号组合多个标签。
- 标签翻译：加载 [EhTagTranslation Database](https://github.com/EhTagTranslation/Database)，支持中文和拼音检索。
- 分类筛选：同步 LANraragi 分类，可与标签搜索叠加。
- 随机漫游：随机抽取归档并自动补齐横向列表宽度。
- 智能推荐：根据当前归档标签和分类推荐相似内容。
- 阅读器：无限滚动、翻页阅读、键盘导航、页码跳转、缩略图抽屉和图片预加载。
- 沉浸模式：全屏滑动翻页，支持移动端触控和自动翻页。
- 设为封面：在阅读器顶栏将当前页设置为归档封面，操作前会弹窗确认。
- 阅读历史：本地记录最近阅读和进度，可选通过 Cloudflare Worker 同步。
- 历史页：集中查看、筛选、批量选择和删除阅读历史。
- EH 评论区：可读取、排序、筛选、回复、编辑、投票 EH/EX 评论。
- 同步删除 E 站收藏夹：删除本地归档时，可按元数据中的 EH/EX 链接同步移除 E 站收藏。
- 重复归档检测：按 LRReader 风格的封面缩略图相似度规则查找疑似重复归档。
- Worker KV 管理：Worker 网页可按需导入/导出阅读历史与非重复记录。
- 主题：支持跟随系统、深色、浅色三种模式；浅色模式使用较柔和的低亮度配色。
- PWA：可安装到桌面，支持缓存和自动更新提示。

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
| `/eh/` | 代理到 `exhentai.org`，用于 EH/EX 评论的备选代理 |

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

## Cloudflare Worker

项目根目录的 `worker.js` 可部署为 Cloudflare Worker，用于：

- 代理 EH/EX 评论、评论提交、投票和收藏夹删除请求。
- 通过 KV 存储同步阅读历史、隐藏已读等状态。
- 保存重复归档检测中被标记为“非重复”的归档组合。
- 在 Worker 状态网页中导入/导出 KV 数据。

部署后，在登录页或首页设置面板填写 Worker 地址，例如 `https://your-worker.example.workers.dev`。

### KV 与认证

Worker 依赖名为 `HISTORY_KV` 的 KV 绑定。受保护接口会读取 KV 中的 `tokens` 字段，前端填写的访问 Token 必须与其中一个 Token 一致。

`tokens` 示例：

```json
["your-sync-token"]
```

KV 导入/导出功能需要额外配置 `adminApiKey`。如果 KV 中没有配置有效的 `adminApiKey`，Worker 会拒绝所有导入/导出 API 调用，并在 Worker 网页醒目提示。

`adminApiKey` 示例：

```text
your-admin-api-key
```

### Worker 网页

直接打开 Worker 根路径可以查看状态页：

- 服务状态、请求计数、同步用户数、阅读记录数。
- KV 绑定、KV 读取、Token 认证和 Admin API Key 状态。
- 非重复记录数量。
- KV 导入/导出工具。

KV 导入/导出可以选择：

- 阅读历史。
- 重复归档检测的非重复记录。
- 两者一起导入或导出。

### EH Cookie

EH 评论区和同步删除 E 站收藏夹需要合法 EH Cookie。同步删除收藏夹至少需要 `ipb_member_id` 与 `ipb_pass_hash`；未配置合法 Cookie 时，“同步删除 E 站收藏夹”开关会被锁定为关闭。

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
| 切换阅读方式 | 工具栏设定中选择无限滚动、翻页和阅读方向 |
| 沉浸模式 | 工具栏沉浸模式按钮 |
| 设为封面 | 工具栏“设为封面”按钮，确认后将当前页设为归档封面 |
| 阅读历史 | 工具栏阅读历史按钮 |

### 设置面板

首页右上角“设置”中可以配置：

- 裁剪封面。
- 隐藏已读完。
- EH 评论区与 EH Cookie。
- 同步删除 E 站收藏夹。
- Cloudflare Worker 端点与访问 Token。
- 进入重复归档检测。
- 导入/导出浏览器本地配置。

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
- 删除归档时如果启用了同步删除 E 站收藏夹，会根据元数据中的 EH/EX 链接同步移除收藏。

## 数据存储

浏览器本地会保存：

- LANraragi 地址和 API Key。
- Worker 地址和访问 Token。
- 主题模式、阅读器设置、EH Cookie。
- 阅读历史、本地筛选、随机漫游近期记录。
- 重复归档检测的本地保存结果。

Worker KV 会保存：

- `tokens`：允许访问受保护接口的 Token 列表。
- `history:<token>`：对应 Token 的远端阅读历史和设置。
- `dedupe:non-duplicates`：重复归档检测中标记为非重复的组合。
- `adminApiKey`：KV 导入/导出的管理 API Key。
- `stats:requests`：Worker 请求计数。

## 许可

本项目采用 [MIT License](LICENSE) 许可。
