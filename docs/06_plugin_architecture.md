# 插件架构设计

> 最后更新：2026-05
> 状态：Phase 1–4 已全部实施完成（内置插件：theme-switcher、image-toggle、signature）

---

## 设计目标

将 MailMail 重构为「极简核心 + 插件生态」架构。核心仅保留 IMAP/SMTP 通信、本地缓存、账户管理、基础 UI Shell 四大模块。其他一切功能（主题、星标、垃圾邮件、打印、签名、通知…）均通过 **TypeScript 前端插件 + Rust trait 后端钩子** 的双层插件系统实现。

### 技术路线选型

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **JS/TS WebView 插件（采用）** | 开发者门槛最低；React 生态无缝；Obsidian/VS Code 已验证 | 无沙箱隔离 | 绝大多数 UI 增强插件 |
| WASM 模块 | 真沙箱；接近原生性能 | 学习曲线陡；UI 扩展困难 | 后期性能敏感插件（可选） |
| Rust dylib | 原生速度 | 平台相关；安全风险极高 | 不推荐用户插件 |
| 子进程 IPC | 进程隔离；多语言支持 | 进程管理复杂；通信开销 | 特殊场景 |

---

## 一、核心 vs 插件化功能边界

### 核心功能（Core — 必须内置）

| 模块 | 不可插件化原因 |
|------|---------------|
| IMAP 连接 & 同步引擎 | TCP/TLS 长连接，需 Rust 原生处理，所有插件的数据源头 |
| SMTP 发送引擎 | 同上 |
| SQLite 缓存 & 查询 | 所有插件的数据基础设施 |
| 账户 CRUD | 凭据安全——插件不应直接接触密码 |
| 邮件解析 (mailparse + ammonia) | HTML 安全净化必须在核心层完成 |
| UI Shell (三栏布局 + 路由框架) | 插件需要稳定的宿主 DOM 结构来挂载 |
| 插件管理器 (PluginManager) | 元系统 |
| 事件总线 (EventBus) | 插件间通信 + 核心→插件分发的基础设施 |
| 权限与能力声明系统 | 安全模型 |

### 插件化功能（Plugin — 全部外置）

| 功能 | 插件名示例 | 复杂度 |
|------|-----------|--------|
| 暗/亮主题切换 | `@mm/theme-switcher` | 低 |
| 自定义主题包 | `@mm/theme-nord` | 低 |
| 星标/收藏 | `@mm/star` | 低 |
| 邮件标签/分类 | `@mm/labels` | 中 |
| 垃圾邮件过滤 | `@mm/spam-filter` | 高 |
| 邮件打印 | `@mm/print` | 低 |
| 邮件签名 | `@mm/signature` | 低 |
| 桌面通知 | `@mm/notifications` | 中 |
| 快捷键自定义 | `@mm/keybindings` | 中 |
| 右键菜单扩展 | `@mm/context-menu` | 低 |
| 邮件模板 | `@mm/templates` | 中 |
| 日历/会议邀请 | `@mm/calendar` | 高 |
| 联系人管理 | `@mm/contacts` | 中 |
| 附件预览 | `@mm/attachment-preview` | 中 |
| PGP 加密 | `@mm/pgp` | 高(后端) |
| 阅读回执 | `@mm/read-receipt` | 低 |
| 自动回复/OOO | `@mm/auto-reply` | 中 |
| AI 摘要/分类 | `@mm/ai-assist` | 高 |
| 延迟发送(撤回) | `@mm/undo-send` | 中 |
| Markdown 编辑器 | `@mm/markdown-compose` | 中 |
| 统一收件箱 | `@mm/unified-inbox` | 中 |
| 多语言 i18n | `@mm/i18n-zh` | 低 |
| 数据导入/导出 | `@mm/import-export` | 中 |

---

## 二、架构设计

### 双层插件系统

```
┌──────────────────────────────────────────────────────┐
│                    Frontend (WebView)                 │
│  ┌─────────────────────────────────────────────────┐ │
│  │  Plugin A (TS)   Plugin B (TS)   Plugin C (TS)  │ │
│  │       │               │               │         │ │
│  │       ▼               ▼               ▼         │ │
│  │  ┌─────────────────────────────────────────┐    │ │
│  │  │          PluginAPI (核心暴露)             │    │ │
│  │  │  EventBus │ SlotRegistry │ Permissions  │    │ │
│  │  └─────────────────────────────────────────┘    │ │
│  │             │                                    │ │
│  │  ┌──────────▼──────────────────────────────┐    │ │
│  │  │     Core UI Shell (App.tsx + Slots)      │    │ │
│  │  │  Sidebar │ List │ Reading │ Settings     │    │ │
│  │  └─────────────────────────────────────────┘    │ │
│  └─────────────────────────────────────────────────┘ │
│                         │ Tauri invoke/emit           │
├─────────────────────────▼────────────────────────────┤
│                    Backend (Rust)                     │
│  ┌─────────────────────────────────────────────────┐ │
│  │  MailPlugin trait (中间件管道)                    │ │
│  │  IMAP Engine │ SMTP Engine │ SQLite │ Accounts  │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 核心事件总线 (EventBus)

| 事件 | 触发时机 | 数据 |
|------|---------|------|
| `email:received` | sync 完成，有新邮件 | `Email[]` |
| `email:before-display` | 渲染邮件前 | `Email`（可修改 HTML） |
| `email:selected` | 用户选中邮件 | `Email` |
| `email:before-send` | 发送前拦截 | `Draft`（可修改/取消） |
| `email:sent` | 发送完成 | `Email` |
| `email:deleted` | 邮件删除 | `string` (emailId) |
| `email:moved` | 邮件移动 | `{ emailId, fromFolder, toFolder }` |
| `folder:changed` | 文件夹切换 | `string` (folder) |
| `account:added` | 新账户添加 | `Account` |
| `account:removed` | 账户删除 | `string` (accountId) |
| `sync:start` | 同步开始 | `string` (accountId) |
| `sync:complete` | 同步完成 | `{ accountId, emails }` |
| `compose:open` | 打开写信 | `ComposeState?` |
| `compose:close` | 关闭写信 | — |
| `app:ready` | 应用启动完成 | — |
| `app:before-quit` | 应用即将退出 | — |
| `settings:changed` | 设置变更 | `{ key, value }` |

### UI 槽位系统 (Slot System)

核心 UI Shell 在关键位置预留 `<Slot id="xxx" />` 占位组件，插件向这些槽位注册 React 组件：

```
sidebar:top          — 侧边栏顶部（New Mail 按钮行旁）
sidebar:bottom       — 侧边栏底部
toolbar:actions      — 阅读面板工具栏（当前邮件 email prop 可用）
email-detail:header  — 邮件头信息之后（email prop 可用）
email-detail:footer  — 邮件正文之后（email prop 可用）
settings:sections    — 设置页追加新分区
compose:footer       — 写信面板底部（body/setBody prop 可用，签名插件使用）
```

> **注意**：`list-item:badge`、`context-menu:*`、`status-bar` 等槽位已在设计文档预留但尚未在代码中放置 `<Slot>`，后续功能扩展时可按需添加。

### 插件 Manifest (manifest.json)

```json
{
  "id": "com.mailmail.spam-filter",
  "name": "Spam Filter",
  "version": "1.0.0",
  "description": "Automatic spam detection and filtering",
  "author": "MailMail Community",
  "main": "index.tsx",
  "permissions": [
    "email:read",
    "email:move",
    "email:modify-metadata",
    "settings:read-write",
    "ui:list-item:badge",
    "ui:context-menu:email"
  ],
  "hooks": [
    "email:received",
    "email:before-display"
  ],
  "settings": {
    "sensitivity": {
      "type": "range",
      "min": 0,
      "max": 100,
      "default": 70,
      "label": "Detection Sensitivity"
    }
  },
  "contributes": {
    "contextMenu": [
      {
        "slot": "context-menu:email",
        "label": "Mark as Spam",
        "command": "spam-filter.markSpam"
      }
    ]
  }
}
```

### 插件 API 接口 (PluginAPI)

```typescript
interface PluginAPI {
  // 事件系统
  on(event: string, handler: (...args: any[]) => void): Disposable;
  emit(event: string, data?: unknown): void;

  // 邮件操作（受权限控制）
  emails: {
    getById(id: string): Promise<Email | null>;
    getByFolder(folder: string, limit?: number): Promise<Email[]>;
    search(query: string): Promise<Email[]>;
    move(emailId: string, toFolder: string): Promise<void>;
    setMetadata(emailId: string, key: string, value: unknown): Promise<void>;
    getMetadata(emailId: string, key: string): Promise<unknown>;
  };

  // 账户（只读——插件不可修改凭据）
  accounts: {
    list(): Account[];
    getActive(): Account | null;
  };

  // 设置
  settings: {
    get(key: string): unknown;
    set(key: string, value: unknown): Promise<void>;
    onChanged(key: string, handler: (value: unknown) => void): Disposable;
  };

  // UI 扩展
  ui: {
    registerSlot(slotId: string, component: React.ComponentType<any>): Disposable;
    registerContextMenuItem(slot: string, item: ContextMenuItem): Disposable;
    registerCommand(id: string, handler: (...args: any[]) => void): Disposable;
    showNotification(message: string, type?: 'info' | 'warn' | 'error'): void;
    showModal(component: React.ComponentType<any>): Disposable;
  };

  // 插件专属 KV 存储
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
}
```

### 插件生命周期

```typescript
// plugins/star/index.tsx
import type { PluginAPI, PluginContext } from '@mailmail/plugin-api';

export function activate(api: PluginAPI, ctx: PluginContext): void {
  // 注册事件监听
  ctx.subscriptions.push(
    api.on('email:selected', (email) => { /* ... */ })
  );
  // 注册 UI 组件
  ctx.subscriptions.push(
    api.ui.registerSlot('list-item:badge', StarBadge)
  );
  // 注册命令
  ctx.subscriptions.push(
    api.ui.registerCommand('star.toggle', (emailId) => { /* ... */ })
  );
}

export function deactivate(): void {
  // 清理资源（ctx.subscriptions 会自动 dispose）
}
```

---

## 三、安全模型

1. 每个插件通过 `manifest.json` 声明所需权限
2. `PluginManager` 在 `activate` 时校验权限集合
3. API 调用时二次检查（如无 `email:move` 权限则 `api.emails.move()` 抛 `PermissionDenied`）
4. 用户安装第三方插件时弹出权限确认对话框
5. 官方插件仓库需代码审核

---

## 四、实施状态（已完成）

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/core/event-bus.ts` | ✅ 已创建 | 类型安全的发布/订阅（17 种事件类型） |
| `src/core/plugin-api.ts` | ✅ 已创建 | PluginAPI / PluginContext / Disposable 类型定义 |
| `src/core/permissions.ts` | ✅ 已创建 | 权限枚举 + 运行时检查 |
| `src/core/slot-registry.tsx` | ✅ 已创建 | SlotRegistry + `<Slot>` React 组件 |
| `src/core/plugin-manager.ts` | ✅ 已创建 | 加载/卸载/启用/禁用/生命周期管理 |
| `src/App.tsx` | ✅ 已集成 | 7 处 `<Slot />` 占位；state 变更 emit 事件 |
| `src/store.ts` | ✅ 已集成 | action 触发 EventBus 事件 |
| `src/plugins/theme-switcher/` | ✅ 已创建 | 明/暗主题切换内置插件 |
| `src/plugins/image-toggle/` | ✅ 已创建 | 显示/隐藏图片内置插件 |
| `src/plugins/signature/` | ✅ 已创建 | 签名 CRUD，`compose:footer` 槽位注入，设置页 UI |

**Phase 5（规划中）**：插件 registry、一键安装/更新 UI、社区贡献指南。

---

## 五、文件清单

| 文件 | 说明 |
|------|------|
| `src/core/event-bus.ts` | 类型安全事件总线 |
| `src/core/plugin-api.ts` | API 类型 + Disposable |
| `src/core/permissions.ts` | 权限枚举 + 检查 |
| `src/core/slot-registry.tsx` | `<Slot>` 组件 + 注册表 |
| `src/core/plugin-manager.ts` | 插件生命周期管理 |
| `src/plugins/theme-switcher/` | 内置插件：主题切换 |
| `src/plugins/image-toggle/` | 内置插件：图片显示开关 |
| `src/plugins/signature/` | 内置插件：邮件签名 |

