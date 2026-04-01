# FanBaaS

[中文](./README.md) | English

> An open-source Backend as a Service (BaaS) platform built with Node.js.
>
> Developed by **YaiYai** · WeChat Public Account: **XiaoFanPingFan**

🌐 **Demo Page**: [https://xiao-fange.github.io/fanbaas/](https://xiao-fange.github.io/fanbaas/)
🚀 **Live Service**: [https://ai.mmuc.cn](https://ai.mmuc.cn)

![Node.js](https://img.shields.io/badge/Node.js-22+-green)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-blue)
![MinIO](https://img.shields.io/badge/MinIO-Object_Storage-red)
![Platform](https://img.shields.io/badge/Platform-Windows-0078d4)
![License](https://img.shields.io/badge/License-MIT-yellow)

> ⚠️ **System Requirement: This project currently supports Windows only.**
> The start/stop scripts (`start-baas.ps1` / `stop-baas.ps1`) are written in PowerShell and depend on Windows path conventions.
> Linux/macOS users need to adapt the service startup methods and paths manually.

---

## Features

| Module | Description |
|--------|-------------|
| 🔐 Authentication | Register, login, JWT tokens, role-based access, forgot password, token blacklist |
| 🗄 Database | Per-user isolated PostgreSQL Schema, visual table management, data browsing, SQL query |
| ⚡ Realtime Database | WebSocket + REST, real-time data push, search & filter support |
| 📦 File Storage | MinIO object storage, multi-bucket management, upload/download/preview, presigned URLs |
| λ Cloud Functions | Sandboxed execution (vm isolation), 3-second timeout, scheduled & event triggers |
| 📊 Analytics | API call stats, response time trends, error rates, persistent to database |
| 🌐 Website Hosting | Static site deployment, SPA support, drag-and-drop upload, instant access |
| 🔑 App Integration | API Key management, auto-generated code examples for JS/Swift/Kotlin/cURL |
| 🛡 Security | Helmet headers, per-user/IP rate limiting, multi-tenant data isolation |

---

## Tech Stack

- **Runtime**: Node.js 22+
- **Framework**: Express 4
- **Database**: PostgreSQL 15
- **Object Storage**: MinIO
- **Real-time**: Socket.IO 4
- **Reverse Proxy**: Caddy 2 (auto HTTPS)
- **Tunnel**: Cloudflare Tunnel (optional, for public access)
- **Email**: Nodemailer (QQ / 163 / Gmail / SMTP)

---

## Quick Start

### Requirements

- Node.js 18+
- PostgreSQL 15+
- MinIO (optional, for file storage)

### 1. Clone the repository

```bash
git clone https://github.com/xiao-fange/fanbaas.git
cd fanbaas/api
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example config:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Database
DB_USER=baas_user
DB_HOST=localhost
DB_NAME=baas_db
DB_PASSWORD=your_strong_password
DB_PORT=5432

# JWT Secret (use a strong random string, at least 32 chars)
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=replace_with_strong_random_secret

# Server
PORT=3001
NODE_ENV=development

# App URL
APP_URL=http://localhost:8080

# MinIO
MINIO_HOST=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# SMTP Email (optional — dev mode returns reset token directly if not configured)
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=465
# SMTP_USER=your@gmail.com
# SMTP_PASS=your_app_password
# SMTP_FROM=your@gmail.com
```

### 4. Initialize the database

```bash
psql -U postgres -c "CREATE USER baas_user WITH LOGIN SUPERUSER PASSWORD 'your_password';"
psql -U postgres -c "CREATE DATABASE baas_db OWNER baas_user;"
```

Database tables are created automatically on first startup.

### 5. Create admin account

```bash
node seed-admin.js
```

Default credentials: `admin@example.com` / `admin123` — **change immediately after login.**

### 6. Start the service

```bash
# Production
npm start

# Development (auto-restart on file change)
npm run dev
```

Access:
- Homepage: http://localhost:3001
- Console: http://localhost:3001/console
- Health check: http://localhost:3001/health

---

## Windows Quick Start (PowerShell Scripts)

Start all services at once:

```powershell
.\start-baas.ps1
```

Stop all services:

```powershell
.\stop-baas.ps1
```

The scripts automatically detect running services and skip them.

---

## Caddy Reverse Proxy (Recommended)

Caddy provides automatic HTTPS and reverse proxy.

### Install Caddy

Download from [caddyserver.com](https://caddyserver.com/docs/install).

### Caddyfile

```caddyfile
# Local development (HTTP)
:8080 {
    reverse_proxy http://localhost:3001
}

# Production (auto HTTPS — replace with your domain)
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

---

## Cloudflare Tunnel (No Public IP Required)

### 1. Install cloudflared

```bash
# Windows
winget install Cloudflare.cloudflared

# Linux
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
```

### 2. Login and create tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create fanbaas-tunnel
```

### 3. Route DNS

```bash
cloudflared tunnel route dns fanbaas-tunnel your-domain.com
```

### 4. Config file `~/.cloudflared/config.yml`

```yaml
tunnel: fanbaas-tunnel
credentials-file: ~/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: your-domain.com
    service: http://localhost:8080
  - service: http_status:404
```

### 5. Run

```bash
cloudflared tunnel run fanbaas-tunnel
```

---

## Email Service

### Gmail

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your@gmail.com
SMTP_PASS=your_app_password
```

### QQ Mail

```env
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=your_qq@qq.com
SMTP_PASS=your_smtp_authorization_code
```

> If SMTP is not configured, the forgot-password feature runs in dev mode and returns the reset token directly in the API response.

---

## MinIO File Storage

```bash
# Docker
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"
```

MinIO Console: http://localhost:9001

---

## API Reference

All authenticated endpoints require:

```
Authorization: Bearer <token>
```

### Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| POST | `/api/auth/forgot-password` | Forgot password |
| POST | `/api/auth/reset-password` | Reset password |
| GET | `/api/users/me` | Get current user |
| GET | `/api/database/tables` | List tables |
| POST | `/api/database/tables` | Create table |
| POST | `/api/database/query` | Execute SQL (SELECT only) |
| GET | `/api/storage/buckets` | List buckets |
| POST | `/api/storage/buckets` | Create bucket |
| POST | `/api/storage/buckets/:name/upload` | Upload file |
| GET | `/api/functions` | List cloud functions |
| POST | `/api/functions` | Create function |
| POST | `/api/functions/:id/invoke` | Invoke function |
| GET | `/api/analytics` | Get analytics |
| GET | `/api/apps` | List apps |
| POST | `/api/apps` | Create app (get API Key) |
| GET | `/api/apps/:id/docs` | Get integration code examples |
| GET | `/api/sites` | List hosted sites |
| POST | `/api/sites` | Create site |
| POST | `/api/sites/:id/deploy` | Deploy site files |

### WebSocket Realtime Database

```javascript
const socket = io('http://localhost:3001', {
  auth: { token: 'your_jwt_token' }
});

// Subscribe to a collection
socket.emit('subscribe', 'messages');

// Listen for changes
socket.on('dataAdded',   (e) => console.log('Added:', e.item));
socket.on('dataUpdated', (e) => console.log('Updated:', e.item));
socket.on('dataDeleted', (e) => console.log('Deleted:', e.id));

// Add data
socket.emit('addData', { collection: 'messages', data: { text: 'Hello' } });
```

---

## Project Structure

```
api/
├── config/
│   └── database.js          # DB connection & table init
├── controllers/
│   ├── userController.js
│   ├── functionController.js
│   └── storageController.js
├── middlewares/
│   ├── auth.js              # JWT auth
│   ├── rateLimit.js         # Rate limiting
│   ├── validate.js          # Input validation
│   └── logger.js            # Logging
├── routes/
│   ├── auth.js
│   ├── users.js
│   ├── database.js
│   ├── storage.js
│   ├── functions.js
│   ├── system.js            # Realtime DB, teams, etc.
│   ├── apps.js              # App integration
│   └── sites.js             # Website hosting
├── services/
│   ├── analytics.js
│   ├── mailer.js
│   ├── minio.js
│   └── realtime.js          # WebSocket service
├── public/
│   ├── index.html           # Homepage
│   ├── console.html         # Admin console
│   ├── reset-password.html
│   └── sites/               # User-deployed static sites
├── .env.example
├── index.js                 # Entry point
├── seed-admin.js            # Init admin account
└── package.json
```

---

## Security

- Passwords hashed with bcrypt (12 rounds)
- JWT tokens support active revocation (blacklist)
- All DB queries use parameterized statements (SQL injection prevention)
- Cloud functions run in Node.js `vm` sandbox — no access to `require`/`process`/`global`, 3s timeout
- Per-user isolated PostgreSQL Schema
- Helmet security headers
- Rate limiting: login 10 req/min, register 5 req/min, others 200 req/min

---

## Production Checklist

- [ ] Set a strong random `JWT_SECRET`
- [ ] Change database password
- [ ] Set `NODE_ENV=production`
- [ ] Configure HTTPS (Caddy or Cloudflare Tunnel)
- [ ] Configure SMTP email service
- [ ] Change default admin password
- [ ] Set MinIO credentials
- [ ] Set `APP_URL` to your real domain

---

## Contributing

Contributions are welcome! Feel free to submit a Pull Request or open an Issue.

1. Fork this repository
2. Create your branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "feat: describe your change"`
4. Push the branch: `git push origin feature/your-feature`
5. Open a Pull Request on GitHub

For questions or suggestions, follow the WeChat Public Account **XiaoFanPingFan**.

---

## License

MIT © 2026 FanBaaS · Developed by **YaiYai** · WeChat: **XiaoFanPingFan**
