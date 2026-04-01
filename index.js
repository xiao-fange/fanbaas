require('dotenv').config();

// 启动前检查必要环境变量
const REQUIRED_ENV = ['JWT_SECRET', 'DB_USER', 'DB_HOST', 'DB_NAME', 'DB_PASSWORD'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`缺少必要环境变量: ${missing.join(', ')}`);
  process.exit(1);
}

const express = require('express');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const { Server } = require('socket.io');

const { logger, loggerMiddleware } = require('./middlewares/logger');
const rateLimitMiddleware = require('./middlewares/rateLimit');
const { authMiddleware } = require('./middlewares/auth');
const { initDatabase, connectWithRetry, pool } = require('./config/database');
const analytics = require('./services/analytics');
const { setupWebSocket } = require('./services/realtime');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const functionRoutes = require('./routes/functions');
const storageRoutes = require('./routes/storage');
const databaseRoutes = require('./routes/database');
const systemRoutes = require('./routes/system');
const appRoutes = require('./routes/apps');
const siteRoutes = require('./routes/sites');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3001;

// 安全头（对静态管理页面放开内联脚本限制）
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],   // 管理页面使用内联脚本
      scriptSrcAttr: ["'unsafe-inline'"],          // onclick 等内联事件
      styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],       // WebSocket 连接
      fontSrc: ["'self'", 'https:', 'data:'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));

// 基础中间件
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS
app.use((req, res, next) => {
  const origin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// 日志 & 限流
app.use(loggerMiddleware);
app.use(rateLimitMiddleware);

// 分析中间件
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => analytics.update(req.method, req.route?.path || req.path, res.statusCode, Date.now() - start));
  next();
});

// 静态文件
app.use('/baas', express.static('baas'));
app.use(express.static('public'));

// 控制台路由
app.get('/console', (req, res) => {
  res.sendFile('console.html', { root: path.join(__dirname, 'public') });
});

// 重置密码页面
app.get('/reset-password', (req, res) => {
  res.sendFile('reset-password.html', { root: path.join(__dirname, 'public') });
});

// 健康检查
app.get('/health', async (req, res) => {
  let dbStatus = 'ok';
  try {
    await pool.query('SELECT 1');
  } catch {
    dbStatus = 'error';
  }
  const uptimeSec = process.uptime();
  const uptimeStr = uptimeSec < 60
    ? `${uptimeSec.toFixed(0)}s`
    : uptimeSec < 3600
      ? `${(uptimeSec / 60).toFixed(1)}m`
      : `${(uptimeSec / 3600).toFixed(1)}h`;

  res.json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    message: dbStatus === 'ok'
      ? `服务运行正常，已运行 ${uptimeStr}`
      : `服务运行中，但数据库连接异常，已运行 ${uptimeStr}`,
    version: '1.0.0',
    name: 'FanBaaS',
    author: '歪歪',
    wechat: '小凡平凡',
    timestamp: new Date().toISOString(),
    uptime: uptimeStr,
    database: dbStatus,
  });
});

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/functions', functionRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/database', databaseRoutes);
app.use('/api', systemRoutes);
app.use('/api/apps', appRoutes);
app.use('/api/sites', siteRoutes);

// 静态网站托管：/sites/:userId/:slug/*
app.use('/sites', express.static(path.join(__dirname, 'public/sites'), {
  index: 'index.html',
  fallthrough: true,
}));
// SPA fallback：找不到文件时返回该网站的 index.html
app.get('/sites/:userId/:slug/*', (req, res) => {
  const indexFile = path.join(__dirname, 'public/sites', req.params.userId, req.params.slug, 'index.html');
  if (require('fs').existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(404).json({ error: '网站不存在或尚未部署' });
  }
});

// 分析接口
app.get('/api/analytics', authMiddleware, (req, res) => {
  res.json(analytics.getStats());
});

// 分析历史（从数据库读取最近500条）
app.get('/api/analytics/history', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT method, path, status_code, duration_ms, created_at FROM analytics_requests ORDER BY created_at DESC LIMIT 500'
    );
    res.json({ rows: result.rows });
  } catch (error) {
    res.json({ rows: [] });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 全局错误处理
app.use((err, req, res, next) => {
  logger.error('未处理的错误', { message: err.message, stack: err.stack });
  res.status(500).json({ error: '服务器内部错误' });
});

// WebSocket
setupWebSocket(io);

// 定期清理过期 token 黑名单
setInterval(async () => {
  try {
    await pool.query('DELETE FROM token_blacklist WHERE expires_at < NOW()');
  } catch (err) {
    logger.error('清理 token 黑名单失败', { message: err.message });
  }
}, 60 * 60 * 1000); // 每小时清理一次

async function start() {
  try {
    await connectWithRetry();
    await initDatabase();
    server.listen(PORT, () => {
      logger.info(`服务器启动成功，端口: ${PORT}`);
    });
  } catch (error) {
    logger.error('服务器启动失败', { message: error.message });
    process.exit(1);
  }
}

// 优雅退出
function gracefulShutdown(signal) {
  logger.info(`收到 ${signal}，正在关闭服务器...`);
  server.close(() => {
    pool.end(() => {
      logger.info('数据库连接池已关闭');
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 捕获未处理的异常，防止进程崩溃
process.on('unhandledRejection', (reason) => {
  logger.error('未处理的 Promise 拒绝', { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('未捕获的异常', { message: err.message, stack: err.stack });
  gracefulShutdown('uncaughtException');
});

start();
