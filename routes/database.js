const router = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const { pool } = require('../config/database');
const { logger } = require('../middlewares/logger');

const VALID_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
const ALLOWED_TYPES = ['VARCHAR', 'TEXT', 'INTEGER', 'BIGINT', 'BOOLEAN', 'TIMESTAMP', 'NUMERIC', 'JSONB', 'FLOAT', 'DATE'];

// 获取或创建用户专属 schema
async function getUserSchema(userId, client) {
  const schema = `user_${userId}`;
  await (client || pool).query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  return schema;
}

// 获取表列表（用户自己 schema 内的表）
router.get('/tables', authMiddleware, async (req, res) => {
  try {
    const schema = await getUserSchema(req.user.id);
    const result = await pool.query(`
      SELECT table_name, pg_size_pretty(pg_total_relation_size($1 || '.' || table_name)) AS size
      FROM information_schema.tables
      WHERE table_schema = $1 ORDER BY table_name
    `, [schema]);
    res.json({ tables: result.rows.map(r => r.table_name), schema });
  } catch (error) {
    logger.error('获取表列表失败', { message: error.message });
    res.status(500).json({ error: '获取表列表失败' });
  }
});

// 获取表结构
router.get('/schema/:table', authMiddleware, async (req, res) => {
  const { table } = req.params;
  if (!VALID_NAME.test(table)) return res.status(400).json({ error: '无效的表名' });
  try {
    const schema = await getUserSchema(req.user.id);
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = $2
      ORDER BY ordinal_position
    `, [table, schema]);
    if (!result.rows.length) return res.status(404).json({ error: '表不存在' });
    res.json({ table, schema, columns: result.rows });
  } catch (error) {
    logger.error('获取表结构失败', { message: error.message });
    res.status(500).json({ error: '获取表结构失败' });
  }
});

// 获取表数据（分页）
router.get('/tables/:table/rows', authMiddleware, async (req, res) => {
  const { table } = req.params;
  if (!VALID_NAME.test(table)) return res.status(400).json({ error: '无效的表名' });
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  try {
    const schema = await getUserSchema(req.user.id);
    const result = await pool.query(
      `SELECT * FROM ${schema}.${table} ORDER BY id DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const count = await pool.query(`SELECT COUNT(*) FROM ${schema}.${table}`);
    res.json({ rows: result.rows, total: parseInt(count.rows[0].count), limit, offset });
  } catch (error) {
    res.status(400).json({ error: '查询失败', detail: error.message });
  }
});

// 插入一行数据
router.post('/tables/:table/rows', authMiddleware, async (req, res) => {
  const { table } = req.params;
  if (!VALID_NAME.test(table)) return res.status(400).json({ error: '无效的表名' });
  const data = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: '请提供行数据对象' });
  }
  try {
    const schema = await getUserSchema(req.user.id);
    const keys = Object.keys(data).filter(k => VALID_NAME.test(k));
    const vals = keys.map(k => data[k]);
    const cols = keys.join(', ');
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const result = await pool.query(
      `INSERT INTO ${schema}.${table} (${cols}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    res.status(201).json({ row: result.rows[0] });
  } catch (error) {
    res.status(400).json({ error: '插入失败', detail: error.message });
  }
});

// 更新一行数据
router.put('/tables/:table/rows/:id', authMiddleware, async (req, res) => {
  const { table, id } = req.params;
  if (!VALID_NAME.test(table)) return res.status(400).json({ error: '无效的表名' });
  const data = req.body;
  try {
    const schema = await getUserSchema(req.user.id);
    const keys = Object.keys(data).filter(k => VALID_NAME.test(k) && k !== 'id');
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const vals = [...keys.map(k => data[k]), id];
    const result = await pool.query(
      `UPDATE ${schema}.${table} SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`,
      vals
    );
    if (!result.rows[0]) return res.status(404).json({ error: '行不存在' });
    res.json({ row: result.rows[0] });
  } catch (error) {
    res.status(400).json({ error: '更新失败', detail: error.message });
  }
});

// 删除一行数据
router.delete('/tables/:table/rows/:id', authMiddleware, async (req, res) => {
  const { table, id } = req.params;
  if (!VALID_NAME.test(table)) return res.status(400).json({ error: '无效的表名' });
  try {
    const schema = await getUserSchema(req.user.id);
    const result = await pool.query(
      `DELETE FROM ${schema}.${table} WHERE id = $1 RETURNING id`, [id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: '行不存在' });
    res.json({ message: '已删除' });
  } catch (error) {
    res.status(400).json({ error: '删除失败', detail: error.message });
  }
});

// 创建表
router.post('/tables', authMiddleware, async (req, res) => {
  const { name, columns } = req.body;
  if (!name || !VALID_NAME.test(name)) return res.status(400).json({ error: '无效的表名' });
  if (!columns || !Array.isArray(columns) || !columns.length) {
    return res.status(400).json({ error: '至少需要一个列定义' });
  }
  for (const col of columns) {
    if (!col.name || !VALID_NAME.test(col.name)) return res.status(400).json({ error: `无效的列名: ${col.name}` });
    const baseType = col.type?.toUpperCase().split('(')[0];
    if (!ALLOWED_TYPES.includes(baseType)) return res.status(400).json({ error: `不支持的列类型: ${col.type}` });
  }
  try {
    const schema = await getUserSchema(req.user.id);
    const colDefs = columns.map(col =>
      `${col.name} ${col.type}${col.nullable === false ? ' NOT NULL' : ''}`
    ).join(', ');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.${name} (
        id SERIAL PRIMARY KEY,
        ${colDefs},
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    res.status(201).json({ message: '表创建成功', table: name, schema });
  } catch (error) {
    logger.error('创建表失败', { message: error.message });
    res.status(500).json({ error: '创建表失败' });
  }
});

// 删除表
router.delete('/tables/:table', authMiddleware, async (req, res) => {
  const { table } = req.params;
  if (!VALID_NAME.test(table)) return res.status(400).json({ error: '无效的表名' });
  try {
    const schema = await getUserSchema(req.user.id);
    await pool.query(`DROP TABLE IF EXISTS ${schema}.${table}`);
    res.json({ message: '表删除成功' });
  } catch (error) {
    logger.error('删除表失败', { message: error.message });
    res.status(500).json({ error: '删除表失败' });
  }
});

// SQL 查询（只在用户自己的 schema 内执行）
router.post('/query', authMiddleware, async (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== 'string') return res.status(400).json({ error: '缺少查询语句' });
  const trimmed = query.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT')) return res.status(403).json({ error: '只允许执行 SELECT 查询' });
  try {
    const schema = await getUserSchema(req.user.id);
    // 设置 search_path 到用户 schema，查询只能访问自己的表
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${schema}, public`);
      const result = await client.query(query);
      res.json({ rows: result.rows, rowCount: result.rowCount });
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('执行查询失败', { message: error.message });
    res.status(400).json({ error: '查询执行失败', detail: error.message });
  }
});

module.exports = router;
