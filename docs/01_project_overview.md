# MailMail 项目总览与架构

## 背景与动机

目标：构建一个极轻量、极快速、注重隐私的 Windows 11 专属多账户邮件客户端。

现有方案的不足：
1. **臃肿**：Mailspring、新版 Outlook 均基于 Electron，内存占用大、启动缓慢。
2. **隐私风险**：新版 Outlook 强制将邮件同步至微软云，对自建邮件服务器用户不可接受。
3. **功能冗余**：Smart filter、日历同步、Snooze 等功能增加了不必要的复杂性。

## 核心设计原则

- **极简 UX**：类 Apple Mail.app 的清爽设计，结合 Windows 11 美学（Mica 效果、圆角、干净的排版）。
- **统一收件箱**：将所有账户邮件聚合到一个视图。
- **同步限额**：默认 30 天同步窗口（可调整到 60/90 天），防止历史数据膨胀。
- **完全本地化**：无中间服务器，直接与用户自定义的 IMAP/SMTP 服务器通信。
- **应用专用密码**：仅支持 IMAP/SMTP 原生认证，不引入 OAuth2 依赖。

## 技术栈

### 前端

| 层 | 技术 |
|---|---|
| 框架 | React 19 + TypeScript + Vite 8 |
| 状态管理 | Zustand 5（`src/store.ts`） |
| UI 组件 | Lucide-React（图标）、react-resizable-panels v4（可拖拽三栏布局） |
| 插件系统 | 自研 TypeScript/React 插件架构（详见 `docs/06_plugin_architecture.md`） |
| Tauri 接口 | `@tauri-apps/api`（invoke + events） |

**插件核心模块：**
- `src/core/event-bus.ts` — 类型安全的发布/订阅（17 种事件类型）
- `src/core/slot-registry.tsx` — UI 槽位注册 + `<Slot>` React 组件
- `src/core/plugin-manager.ts` — 插件加载/卸载/生命周期管理
- `src/core/permissions.ts` — 权限声明 + 运行时检查

**内置插件：** `theme-switcher`、`image-toggle`、`signature`（完整签名 CRUD）

### 后端（Rust / Tauri v2）

| 依赖 | 说明 |
|---|---|
| `async-imap` + `tokio-native-tls` | IMAP 收信；`tokio-native-tls` 替代 `async-native-tls` 以解决 Windows SChannel 握手失败问题 |
| `lettre` | SMTP 发信 |
| `sqlx` (SQLite) | 持久层；启用 `PRAGMA foreign_keys = ON` |
| `mailparse` v0.14 | 邮件解析（含附件、RFC 2047 头部编码处理） |
| `ammonia` v4 | HTML 净化（Rust 层去除恶意脚本和追踪像素），`Builder` 模式允许 `style` 属性和 `<img>` 标签进白名单 |
| `keyring` v3 | 系统凭据存储（Windows Credential Manager，`windows-native` feature） |
| `chrono` | 时间戳处理 |

## 关键实现细节

### Windows TLS 握手

Windows SChannel 的特殊行为会导致 IMAP 握手时出现 "unexpected EOF"。解决方案：使用 `tokio-native-tls` 直连，而非 tokio-util 的 compat 层。

### 邮件解析

`imap.rs` 中的 `extract_body_recursive()` 递归遍历 `multipart/mixed` 和 `multipart/alternative` 结构，定位最佳 HTML/纯文本内容；同时提取附件元数据（`Content-Disposition: attachment`）。

RFC 2047 编码头（Subject/From 等）由 `decode_rfc2047()` 处理，支持 Q-encoding、B-encoding 及 GBK/Big5/ISO 等多字节字符集（通过 mailparse 二次解析）。

### HTML 安全净化

1. **Rust 层**：`ammonia::Builder` 允许 `style` 属性（保留邮件样式），图片标签进白名单。
2. **JS 层**：前端 `sanitizeEmailHtml()` 在用户未开启"显示图片"时从 DOM 层剥除 `<img>` 标签（CSS `display:none` 无法阻止 HTTP 请求，会导致隐私泄露）。

### 同步逻辑

- IMAP `SEARCH SINCE <Date>` 强制执行同步限额
- 每次同步截断到最新 50 封（内存安全）
- 启动时先从 SQLite 读取缓存即时渲染，再后台执行 `sync_folder` 刷新最新数据
- IMAP IDLE：Rust 后台 task 维持长连接，新邮件通过 Tauri `app_handle.emit("mail:new", ...)` 推送前端

### 密码安全

账号凭据存入系统 Keychain（Windows Credential Manager），SQLite 中仅保留占位符。由 `keyring` v3 crate（`windows-native` feature）实现。

### camelCase 规范

所有 Rust 侧 `serde` 序列化均启用 `#[serde(rename_all = "camelCase")]`，确保 JSON 字段与 TypeScript 接口兼容。
