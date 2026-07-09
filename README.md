# LRR Modern Reader

LRR Modern Reader 是一个面向 [LANraragi](https://github.com/Difegue/LANraragi) 的现代阅读器前端，支持 PWA、标签翻译、分类浏览、阅读历史、推荐和沉浸式翻页。

应用通过 LANraragi HTTP API 工作：首次打开页面时填写 LANraragi 地址和 API Key，之后配置保存在浏览器 `localStorage`。API 请求会发送到 `<LANraragi 地址>/api/*`，认证方式为 `Authorization: Bearer <base64(API Key)>`。

## 功能

- 仓库浏览：搜索归档，支持用逗号组合多个标签。
- 标签翻译：加载 [EhTagTranslation Database](https://github.com/EhTagTranslation/Database)，支持中文和拼音检索。
- 分类筛选：同步 LANraragi 分类，可与标签搜索叠加。
- 智能推荐：根据当前归档标签和分类推荐相似内容。
- 阅读器：无限滚动、左右翻页、键盘导航、页码跳转和图片预加载。
- 沉浸模式：全屏滑动翻页，支持移动端触控和自动翻页。
- 阅读历史：本地记录最近阅读和进度，可选通过 Cloudflare Worker 同步。
- E-Hentai 评论：可选通过 Cloudflare Worker 或开发代理读取评论。
- PWA：可安装到桌面，支持缓存和自动更新。

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

## Cloudflare Worker

项目根目录的 `worker.js` 可部署为 Cloudflare Worker，用于：

- 代理 E-Hentai / ExHentai 评论请求。
- 通过 KV 存储同步阅读历史、隐藏已读等状态。

部署后，在登录页或首页设置面板填写 Worker 地址，例如 `https://your-worker.example.workers.dev`。如果启用受保护接口，请在 Worker KV 中配置 `tokens`，并在前端填写同一个 Token。

## 常用操作

### 标签搜索

- 输入标签名，例如 `full color`
- 输入中文或拼音首字母查找翻译标签
- 使用 `namespace:value` 精确搜索，例如 `female:schoolgirl`
- 多个标签用逗号分隔

### 阅读器

| 操作 | 方式 |
|------|------|
| 上/下翻页 | 滚轮、Page Up/Down、方向键、空格键 |
| 打开缩略图面板 | 右键点击页面或使用工具栏按钮 |
| 跳页 | 在工具栏页码输入框回车 |
| 返回首页 | 工具栏返回按钮 |
| 切换阅读方式 | 工具栏设定中选择无限滚动、翻页和阅读方向 |
| 沉浸模式 | 工具栏沉浸模式按钮 |

## 许可

本项目采用 [MIT License](LICENSE) 许可。
