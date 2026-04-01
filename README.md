# FanBaaS

[English](./README_EN.md) | 中文

> 一个基于 Node.js 的开源后端即服务（BaaS）平台，提供数据库、实时数据、文件存储、云函数、用户认证、网站部署等完整后端能力。
>
> 由 **歪歪** 开发 · 公众号：**小凡平凡**

![Node.js](https://img.shields.io/badge/Node.js-22+-green)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-blue)
![MinIO](https://img.shields.io/badge/MinIO-Object_Storage-red)
![Platform](https://img.shields.io/badge/Platform-Windows-0078d4)
![License](https://img.shields.io/badge/License-MIT-yellow)

> ⚠️ **系统要求：本项目当前仅支持 Windows 系统。**
> 启动/停止脚本（`start-baas.ps1` / `stop-baas.ps1`）使用 PowerShell 编写，依赖 Windows 路径结构。
> Linux/macOS 用户需自行调整服务启动方式和路径配置。

---

## 功能特性

| 模块 | 功能 |
|------|------|
| 🔐 用户认证 | 注册、登录、JWT 令牌、角色权限、忘记密码、登出黑名单 |
| 🗄 数据库管理 | 每用户独立 PostgreSQL Schema，可视化建表、浏览数据、SQL 查询 |
| ⚡ 实时数据库 | WebSocket + REST，数据变更实时推送，支持搜索过滤 |
| 📦 文件存储 | MinIO 对象存储，多存储桶，文件上传/下载/预览，预签名 URL |
| λ 云函数 | 沙箱执行（vm 隔离），3秒超时，支持定时触发和事件触发 |
| 📊 分析监控 | API 调用统计、响应时间趋势、错误率，数据持久化到数据库 |
| 🌐 网站部署 | 静态网站托管，支持 SPA，拖拽上传，即时访问 |
| 🔑 应用接入 | API Key 管理，自动生成 JS/Swift/Kotlin/cURL 代码示例 |
| 🛡 安全 | Helmet 安全头、速率限制（按用户/IP分级）、多租户数据隔离 |

---

## 技术栈

- **运行时**：Node.js 22+
- **框架**：Express 4
- **数据库**：PostgreSQL 15
- **对象存储**：MinIO
- **实时通信**：Socket.IO 4
- **反向代理**：Caddy 2（支持自动 HTTPS）
- **隧道**：Cloudflare Tunnel（可选，用于公网访问）
- **邮件**：Nodemailer（支持 QQ/163/Gmail/SMTP）

---

## 快速开始

### 环境要求

- Node.js 18+
- PostgreSQL 15+
- MinIO（可选，用于文件存储）

### 1. 克隆项目

```bash
git clone https://github.com/xiao-fange/fanbaas.git
cd fanbaas/api
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制示例配置文件：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# 数据库配置
DB_USER=baas_user
DB_HOST=localhost
DB_NAME=baas_db
DB_PASSWORD=your_strong_password
DB_PORT=5432

# JWT 密钥（请使用强随机字符串，至少32位）
# 生成方式: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=replace_with_strong_random_secret

# 服务器配置
PORT=3001
NODE_ENV=development

# 应用访问地址
APP_URL=http://localhost:8080

# MinIO 配置（可选）
MINIO_HOST=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# SMTP 邮件配置（可选，不配置则使用开发模式）
# SMTP_HOST=smtp.qq.com
# SMTP_PORT=465
# SMTP_USER=your@qq.com
# SMTP_PASS=your_smtp_authorization_code
# SMTP_FROM=your@qq.com
```

### 4. 初始化数据库

```bash
# 创建数据库用户和数据库
psql -U postgres -c "CREATE USER baas_user WITH LOGIN SUPERUSER PASSWORD 'your_password';"
psql -U postgres -c "CREATE DATABASE baas_db OWNER baas_user;"
```

数据库表结构会在服务启动时自动创建。

### 5. 创建管理员账号

```bash
node seed-admin.js
```

默认账号：`admin@example.com` / `admin123`（**请立即修改密码**）

### 6. 启动服务

```bash
# 生产模式
npm start

# 开发模式（文件变更自动重启）
npm run dev
```

服务启动后访问：
- 官网：http://localhost:3001
- 控制台：http://localhost:3001/console
- API 健康检查：http://localhost:3001/health

---

## 配置 Caddy 反向代理（推荐）

Caddy 提供自动 HTTPS 和反向代理。

### 安装 Caddy

从 [caddyserver.com](https://caddyserver.com/docs/install) 下载安装。

### Caddyfile 配置

```caddyfile
# 本地开发（HTTP）
:8080 {
    reverse_proxy http://localhost:3001
}

# 生产环境（自动 HTTPS，替换为你的域名）
your-domain.com {
    reverse_proxy http://localhost:3001
}

# Socket.IO 需要特殊处理
your-domain.com {
    @socketio path /socket.io/*
    reverse_proxy @socketio http://localhost:3001 {
        transport http {
            read_buffer 4096
        }
    }
    reverse_proxy http://localhost:3001
}
```

启动 Caddy：

```bash
caddy run --config Caddyfile
```

---

## 配置 Cloudflare Tunnel（无需公网 IP）

如果服务器没有公网 IP，可以使用 Cloudflare Tunnel 实现 HTTPS 访问。

### 1. 安装 cloudflared

```bash
# Windows
winget install Cloudflare.cloudflared

# Linux
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
```

### 2. 登录并创建 Tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create baas-tunnel
```

### 3. 配置路由

```bash
cloudflared tunnel route dns baas-tunnel your-domain.com
cloudflared tunnel route dns baas-tunnel www.your-domain.com
```

### 4. 创建配置文件 `~/.cloudflared/config.yml`

```yaml
tunnel: baas-tunnel
credentials-file: ~/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: your-domain.com
    service: http://localhost:8080
  - hostname: www.your-domain.com
    service: http://localhost:8080
  - service: http_status:404
```

### 5. 启动 Tunnel

```bash
cloudflared tunnel run baas-tunnel
```

---

## 配置邮件服务

### QQ 邮箱

1. 登录 QQ 邮箱 → 设置 → 账户 → 开启 SMTP 服务
2. 获取授权码（不是登录密码）
3. 在 `.env` 中配置：

```env
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=your_qq@qq.com
SMTP_PASS=your_authorization_code
SMTP_FROM=your_qq@qq.com
APP_URL=https://your-domain.com
```

### 163 邮箱

```env
SMTP_HOST=smtp.163.com
SMTP_PORT=465
SMTP_USER=your@163.com
SMTP_PASS=your_authorization_code
```

### Gmail

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your@gmail.com
SMTP_PASS=your_app_password
```

> 未配置 SMTP 时，忘记密码功能会在开发模式下直接返回重置 token，方便本地调试。

---

## MinIO 文件存储

### 启动 MinIO

```bash
# Docker
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"

# 直接运行
minio server ./data
```

MinIO 控制台：http://localhost:9001

---

## API 文档

### 认证

所有需要认证的接口需在请求头中携带 JWT Token：

```
Authorization: Bearer <token>
```

### 主要接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出 |
| POST | `/api/auth/forgot-password` | 忘记密码 |
| POST | `/api/auth/reset-password` | 重置密码 |
| GET | `/api/users/me` | 获取当前用户 |
| GET | `/api/database/tables` | 获取数据表列表 |
| POST | `/api/database/tables` | 创建数据表 |
| POST | `/api/database/query` | 执行 SQL 查询 |
| GET | `/api/storage/buckets` | 获取存储桶列表 |
| POST | `/api/storage/buckets` | 创建存储桶 |
| POST | `/api/storage/buckets/:name/upload` | 上传文件 |
| GET | `/api/functions` | 获取云函数列表 |
| POST | `/api/functions` | 创建云函数 |
| POST | `/api/functions/:id/invoke` | 调用云函数 |
| GET | `/api/analytics` | 获取分析数据 |
| GET | `/api/apps` | 获取应用列表 |
| POST | `/api/apps` | 创建应用（获取 API Key） |
| GET | `/api/apps/:id/docs` | 获取接入代码示例 |
| GET | `/api/sites` | 获取网站列表 |
| POST | `/api/sites` | 创建网站 |
| POST | `/api/sites/:id/deploy` | 部署网站文件 |

### WebSocket 实时数据库

```javascript
const socket = io('http://localhost:3001', {
  auth: { token: 'your_jwt_token' }
});

// 订阅集合
socket.emit('subscribe', 'messages');

// 监听数据变更
socket.on('dataAdded',   (e) => console.log('新增:', e.item));
socket.on('dataUpdated', (e) => console.log('更新:', e.item));
socket.on('dataDeleted', (e) => console.log('删除:', e.id));

// 添加数据
socket.emit('addData', { collection: 'messages', data: { text: 'Hello' } });
```

---

## 项目结构

```
api/
├── config/
│   └── database.js          # 数据库连接和表初始化
├── controllers/
│   ├── userController.js    # 用户管理
│   ├── functionController.js # 云函数
│   └── storageController.js # 文件存储
├── middlewares/
│   ├── auth.js              # JWT 认证
│   ├── rateLimit.js         # 速率限制
│   ├── validate.js          # 输入验证
│   └── logger.js            # 日志
├── routes/
│   ├── auth.js              # 认证路由
│   ├── users.js             # 用户路由
│   ├── database.js          # 数据库路由
│   ├── storage.js           # 存储路由
│   ├── functions.js         # 云函数路由
│   ├── system.js            # 系统路由（实时数据库等）
│   ├── apps.js              # 应用接入路由
│   └── sites.js             # 网站部署路由
├── services/
│   ├── analytics.js         # 分析数据服务
│   ├── mailer.js            # 邮件服务
│   ├── minio.js             # MinIO 对象存储
│   └── realtime.js          # WebSocket 实时服务
├── public/
│   ├── index.html           # 官网首页
│   ├── console.html         # 管理控制台
│   ├── reset-password.html  # 重置密码页
│   └── sites/               # 用户部署的静态网站
├── .env.example             # 环境变量示例
├── index.js                 # 应用入口
├── seed-admin.js            # 初始化管理员账号
└── package.json
```

---

## 安全说明

- 所有密码使用 bcrypt（12轮）加密存储
- JWT Token 支持主动吊销（黑名单机制）
- 数据库操作使用参数化查询，防止 SQL 注入
- 云函数在 Node.js `vm` 沙箱中执行，禁止访问 `require`/`process`/`global`，3秒超时
- 每用户独立 PostgreSQL Schema，数据完全隔离
- Helmet 安全头防止常见 Web 攻击
- 速率限制：登录 10次/分钟，注册 5次/分钟，其他接口 200次/分钟

---

## 生产部署检查清单

- [ ] 修改 `.env` 中的 `JWT_SECRET` 为强随机字符串
- [ ] 修改数据库密码
- [ ] 将 `NODE_ENV` 设置为 `production`
- [ ] 配置 HTTPS（Caddy 或 Cloudflare Tunnel）
- [ ] 配置 SMTP 邮件服务
- [ ] 修改默认管理员密码
- [ ] 配置 MinIO 访问密钥
- [ ] 设置 `APP_URL` 为真实域名

---
## 参与贡献

欢迎提交 Pull Request 或 Issue！

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交修改：`git commit -m "feat: 描述你的改动"`
4. 推送分支：`git push origin feature/your-feature`
5. 在 GitHub 上发起 Pull Request

如有问题或建议，欢迎关注公众号 **小凡平凡** 联系作者。

## 参与贡献

欢迎提交 Pull Request 或 Issue！

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交修改：`git commit -m "feat: 描述你的改动"`
4. 推送分支：`git push origin feature/your-feature`
5. 在 GitHub 上发起 Pull Request

如有问题或建议，欢迎关注公众号 **小凡平凡** 联系作者。

---

## License

MIT © 2026 FanBaaS · 由 **歪歪** 开发 · 公众号：**小凡平凡**

