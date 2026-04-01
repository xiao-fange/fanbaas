const router = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const { pool } = require('../config/database');
const { logger } = require('../middlewares/logger');

// ─── /api/storage (别名，前端直接调用) ───────────────────────────────────────
router.get('/storage', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.id, b.name, b.description,
             COUNT(f.id)::int AS files,
             COALESCE(SUM(f.size_bytes), 0)::bigint AS total_size,
             pg_size_pretty(COALESCE(SUM(f.size_bytes), 0)) AS size
      FROM storage_buckets b
      LEFT JOIN storage_files f ON f.bucket_name = b.name
      GROUP BY b.id ORDER BY b.created_at DESC
    `);
    res.json({ buckets: result.rows });
  } catch (error) {
    logger.error('获取存储桶失败', { message: error.message });
    res.status(500).json({ error: '获取存储桶失败' });
  }
});

// ─── /api/services ────────────────────────────────────────────────────────────
router.get('/services', authMiddleware, async (req, res) => {
  const uptimeSec = process.uptime();
  const uptimeStr = uptimeSec < 60
    ? `${uptimeSec.toFixed(0)}s`
    : uptimeSec < 3600
      ? `${(uptimeSec / 60).toFixed(1)}m`
      : `${(uptimeSec / 3600).toFixed(1)}h`;

  const mem = process.memoryUsage();
  const memMB = (mem.rss / 1024 / 1024).toFixed(1);

  // 检测各服务实际状态
  let dbStatus = 'running', dbVersion = 'PostgreSQL 15';
  try {
    const r = await pool.query('SELECT version()');
    const v = r.rows[0].version.match(/PostgreSQL ([\d.]+)/);
    dbVersion = v ? `PostgreSQL ${v[1]}` : 'PostgreSQL';
  } catch { dbStatus = 'stopped'; }

  let redisStatus = 'unknown';
  try {
    const net = require('net');
    await new Promise((resolve, reject) => {
      const s = net.createConnection(6379, '127.0.0.1');
      s.on('connect', () => { s.destroy(); resolve(); });
      s.on('error', reject);
      setTimeout(() => { s.destroy(); reject(); }, 500);
    });
    redisStatus = 'running';
  } catch { redisStatus = 'stopped'; }

  let minioStatus = 'unknown';
  try {
    const net = require('net');
    await new Promise((resolve, reject) => {
      const s = net.createConnection(9000, '127.0.0.1');
      s.on('connect', () => { s.destroy(); resolve(); });
      s.on('error', reject);
      setTimeout(() => { s.destroy(); reject(); }, 500);
    });
    minioStatus = 'running';
  } catch { minioStatus = 'stopped'; }

  res.json({
    services: [
      {
        name: 'API Service',
        status: 'running',
        port: process.env.PORT || 3001,
        version: '1.0.0',
        uptime: uptimeStr,
        memory: `${memMB} MB`,
        pid: process.pid,
      },
      {
        name: 'Database (PostgreSQL)',
        status: dbStatus,
        port: process.env.DB_PORT || 5432,
        version: dbVersion,
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'baas_db',
      },
      {
        name: 'Redis',
        status: redisStatus,
        port: 6379,
        version: '7.2.13',
      },
      {
        name: 'MinIO',
        status: minioStatus,
        port: 9000,
        version: 'RELEASE.2025-09-07',
      },
      {
        name: 'Caddy Server',
        status: 'running',
        port: 8080,
        version: '2.10.2',
      },
      {
        name: 'Cloudflare Tunnel',
        status: 'unknown',
        version: '2025.11.1',
      },
    ]
  });
});

// ─── /api/data ────────────────────────────────────────────────────────────────
router.get('/data', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT collection, COUNT(*)::int AS count
      FROM realtime_data GROUP BY collection ORDER BY collection
    `);
    res.json({ collections: result.rows.map((r, i) => ({ id: i + 1, name: r.collection, count: r.count })) });
  } catch (error) {
    res.json({ collections: [] });
  }
});

// ─── /api/realtime/collections ────────────────────────────────────────────────
router.get('/realtime/collections', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  let userId = null;
  if (token) {
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.id;
    } catch {}
  }
  try {
    const query = userId
      ? 'SELECT DISTINCT collection FROM realtime_data WHERE user_id = $1 ORDER BY collection'
      : 'SELECT DISTINCT collection FROM realtime_data ORDER BY collection';
    const result = await pool.query(query, userId ? [userId] : []);
    res.json({ collections: result.rows.map(r => r.collection) });
  } catch (error) {
    res.json({ collections: [] });
  }
});

// 创建集合
router.post('/realtime/collections', authMiddleware, async (req, res) => {
  const { collection } = req.body;
  if (!collection) return res.status(400).json({ error: '集合名称不能为空' });
  try {
    const exists = await pool.query(
      'SELECT 1 FROM realtime_data WHERE collection = $1 AND user_id = $2 LIMIT 1',
      [collection, req.user.id]
    );
    if (exists.rows.length > 0) return res.status(409).json({ error: '集合已存在' });
    res.status(201).json({ collection, message: '集合已就绪' });
  } catch (error) {
    res.status(500).json({ error: '创建集合失败' });
  }
});

// 添加实时数据
router.post('/realtime/data', authMiddleware, async (req, res) => {
  const { collection, data } = req.body;
  if (!collection || !data) return res.status(400).json({ error: '参数不完整' });
  try {
    const result = await pool.query(
      'INSERT INTO realtime_data (user_id, collection, data) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, collection, JSON.stringify(data)]
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: '添加数据失败' });
  }
});

// 更新实时数据
router.put('/realtime/data/:id', authMiddleware, async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: '数据不能为空' });
  try {
    const result = await pool.query(
      'UPDATE realtime_data SET data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *',
      [JSON.stringify(data), req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: '数据不存在' });
    res.json({ item: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除实时数据
router.delete('/realtime/data/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM realtime_data WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: '数据不存在' });
    res.json({ message: '已删除' });
  } catch (error) {
    res.status(500).json({ error: '删除失败' });
  }
});

router.get('/realtime/collection/:collection', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  let userId = null;
  if (token) {
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.id;
    } catch {}
  }
  try {
    const query = userId
      ? 'SELECT * FROM realtime_data WHERE collection = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 100'
      : 'SELECT * FROM realtime_data WHERE collection = $1 ORDER BY created_at DESC LIMIT 100';
    const params = userId ? [req.params.collection, userId] : [req.params.collection];
    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: '获取集合数据失败' });
  }
});

// ─── /api/teams ───────────────────────────────────────────────────────────────
// 内存存储（待接入数据库）
const teams = new Map([
  [1, { id: 1, name: '开发团队', description: '负责产品开发', owner: 'admin@example.com', members: ['admin@example.com'], memberCount: 1, createdAt: new Date().toISOString() }],
]);
let teamIdSeq = 2;

router.get('/teams', authMiddleware, (req, res) => {
  res.json({ teams: Array.from(teams.values()) });
});

router.get('/teams/:id', authMiddleware, (req, res) => {
  const team = teams.get(parseInt(req.params.id));
  if (!team) return res.status(404).json({ error: '团队不存在' });
  res.json({ team });
});

router.post('/teams', authMiddleware, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: '团队名称不能为空' });
  const id = teamIdSeq++;
  const team = { id, name, description: description || '', owner: req.user.email, members: [req.user.email], memberCount: 1, createdAt: new Date().toISOString() };
  teams.set(id, team);
  res.status(201).json({ team });
});

router.delete('/teams/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  if (!teams.has(id)) return res.status(404).json({ error: '团队不存在' });
  teams.delete(id);
  res.json({ message: '团队删除成功' });
});

router.post('/teams/:teamId/members', authMiddleware, (req, res) => {
  const team = teams.get(parseInt(req.params.teamId));
  if (!team) return res.status(404).json({ error: '团队不存在' });
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: '用户ID不能为空' });
  if (!team.members.includes(userId)) {
    team.members.push(userId);
    team.memberCount = team.members.length;
  }
  res.json({ team });
});

router.delete('/teams/:teamId/members/:userId', authMiddleware, (req, res) => {
  const team = teams.get(parseInt(req.params.teamId));
  if (!team) return res.status(404).json({ error: '团队不存在' });
  team.members = team.members.filter(m => m !== req.params.userId);
  team.memberCount = team.members.length;
  res.json({ team });
});

// ─── /api/scheduled-tasks ─────────────────────────────────────────────────────
const scheduledTasks = new Map([
  [1, { id: 1, name: 'Daily Backup', functionId: null, schedule: '0 0 * * *', status: 'active', createdAt: new Date().toISOString() }],
]);
let taskIdSeq = 2;

router.get('/scheduled-tasks', authMiddleware, (req, res) => {
  res.json({ tasks: Array.from(scheduledTasks.values()) });
});

router.post('/scheduled-tasks', authMiddleware, (req, res) => {
  const { name, functionId, schedule } = req.body;
  if (!name || !schedule) return res.status(400).json({ error: '任务名称和调度表达式不能为空' });
  const id = taskIdSeq++;
  const task = { id, name, functionId: functionId || null, schedule, status: 'active', createdAt: new Date().toISOString() };
  scheduledTasks.set(id, task);
  res.status(201).json({ task });
});

router.delete('/scheduled-tasks/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  if (!scheduledTasks.has(id)) return res.status(404).json({ error: '任务不存在' });
  scheduledTasks.delete(id);
  res.json({ message: '任务删除成功' });
});

// ─── /api/event-triggers ──────────────────────────────────────────────────────
const eventTriggers = new Map([
  [1, { id: 1, name: 'User Created', functionId: null, eventType: 'user.created', status: 'active', createdAt: new Date().toISOString() }],
]);
let triggerIdSeq = 2;

router.get('/event-triggers', authMiddleware, (req, res) => {
  res.json({ triggers: Array.from(eventTriggers.values()) });
});

router.post('/event-triggers', authMiddleware, (req, res) => {
  const { name, functionId, eventType } = req.body;
  if (!name || !eventType) return res.status(400).json({ error: '触发器名称和事件类型不能为空' });
  const id = triggerIdSeq++;
  const trigger = { id, name, functionId: functionId || null, eventType, status: 'active', createdAt: new Date().toISOString() };
  eventTriggers.set(id, trigger);
  res.status(201).json({ trigger });
});

router.delete('/event-triggers/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  if (!eventTriggers.has(id)) return res.status(404).json({ error: '触发器不存在' });
  eventTriggers.delete(id);
  res.json({ message: '触发器删除成功' });
});

module.exports = router;
