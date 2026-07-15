# 临时 Android APK Workflow 设计

## 目标

新增独立 GitHub Actions workflow，手动构建可侧载 Debug APK。Capacitor、Android 工程、状态栏适配和安全区样式全部在 runner 内临时生成；仓库现有 React、PWA、Docker 源码与依赖声明保持不变。

## 已选方案

采用临时 Capacitor 8 工程。另两种方案不采用：TWA 依赖公网 HTTPS 与 Digital Asset Links，不适合局域网 LANraragi；提交完整 `android/` 工程维护更稳定，但违反“编译时临时更改”约束。

Capacitor 固定为 `8.4.1`，三件套 `@capacitor/core`、`@capacitor/cli`、`@capacitor/android` 使用同一精确版本。GitHub runner 使用 Node.js 22；这是 Capacitor 8 官方最低 Node.js 要求。

## Workflow 边界

唯一长期实现文件为 `.github/workflows/android-apk.yml`。workflow 仅由 `workflow_dispatch` 手动触发，执行以下数据流：

1. Checkout 当前 `dev` 提交。
2. 安装现有 Web 依赖，不提交 runner 产生的锁文件。
3. 临时安装固定版本 Capacitor。
4. 运行现有 `npm run build` 生成 `dist/`。
5. 临时生成 `capacitor.config.json` 和 Android 工程。
6. 对构建产物与原生工程应用可重复、带失败检查的补丁。
7. 执行 Gradle `assembleDebug`。
8. 上传带短提交 SHA 的 APK artifact。

任何预期锚点缺失都必须立即失败，不能继续产出半适配 APK。

## Android 网络配置

应用 ID 使用 `com.kelcoin.lanraragireader`，名称使用 `LANraragi Reader`，Web 目录使用 `dist`。为支持用户现有的局域网 `http://IP:3000` LANraragi，临时配置启用 Android cleartext 与 mixed content，并保留 `localhost` 作为 WebView 主机。

此设置只解决 Android WebView 的 HTTP 阻止；不会绕过 LANraragi CORS。API Key 仍由现有代码按 `Authorization: Bearer <base64-key>` 发送，workflow 不读取、写入或打包任何 API Key。

## 沉浸式状态栏与避让

采用 Android 15/16 的现代 edge-to-edge 模型，不使用已失效的 `overlaysWebView` 或状态栏背景色配置。Capacitor 8 内置 `SystemBars` 配置：

- 状态栏保持显示，背景由 edge-to-edge 页面自然延伸。
- 深色应用背景使用浅色系统栏图标。
- `insetsHandling: "css"` 注入可靠的 `--safe-area-inset-*`，兼容旧 Android WebView 的 `env(safe-area-inset-*)` 缺陷。
- 临时给构建产物加入 `viewport-fit=cover` 和 Android 专用安全区 CSS。
- 顶部应用壳与固定顶栏至少避让 `--safe-area-inset-top`；底部继续尊重项目已有 Reader/PWA safe-area 逻辑，避免重复叠加底部 inset。

状态栏区域视觉使用项目深色背景 `#0f1115`。不隐藏状态栏，保证时间、电量和通知仍可见。

## 本体隔离

workflow 不修改并提交 `package.json`、`index.html`、`src/`、`public/` 或 `android/`。所有临时文件只存在于 GitHub runner。现有 `docker-publish.yml` 的触发器、镜像构建和发布逻辑不变。

当前工作区已有其他未提交改动；本轮只按明确路径暂存设计文档和 workflow，禁止使用全量暂存。

## 错误处理与验证

提交前检查：

- YAML 可解析，顶层 `on`、`jobs` 和手动触发存在。
- workflow 固定 Capacitor 版本，并包含 build、Capacitor、状态栏/安全区、Gradle、artifact 步骤。
- 临时补丁脚本对样例构建产物先失败、再通过，证明锚点保护有效。
- `npm run build` 通过。
- `git diff --check` 通过。
- 暂存区只含本轮目标文件。

本地环境不承诺完整运行 Android SDK 构建；首次 GitHub Actions 实际运行才是 Android 工程与 Gradle 的端到端验证。workflow 失败时保留清晰步骤名和日志，不上传不存在的 APK。

## 非目标

- 不构建或签名 Release APK/AAB。
- 不配置 Google Play 发布。
- 不把 LANraragi 服务端打进 APK。
- 不解决目标 LANraragi 服务端的 CORS 配置。
- 不改 E-Hentai `/eh/` 代理行为；APK 仍建议配置现有 Cloudflare Worker。

## 官方依据

- [Capacitor 8 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Capacitor SystemBars 与安全区变量](https://capacitorjs.com/docs/apis/system-bars)
- [Capacitor Android 配置](https://capacitorjs.com/docs/android/configuration)
- [Capacitor 配置参考](https://capacitorjs.com/docs/config)
