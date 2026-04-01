const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middlewares/auth');
const { logger } = require('../middlewares/logger');
const minio = require('../services/minio');
const multer = require('multer');
const crypto = require('crypto');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// 网站静态文件存放目录
const SITES_DIR = path.join(__dirname, '../public/sites');
if (!fs.existsSync(SITES_DIR)) fs.mkdirSync(SITES_DIR, { recursive: true });

// slug 规范化
function toSlug(str) {
  return str.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// 获取网站列表
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM sites WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ sites: result.rows });
  } catch (error) {
    logger.error('获取网站列表失败', { message: error.message });
    res.status(500).json({ error: '获取网站列表失败' });
  }
});

// 创建网站
router.post('/', authMiddleware, async (req, res) => {
  const { name, slug: rawSlug } = req.body;
  if (!name) return res.status(400).json({ error: '网站名称不能为空' });
  const slug = toSlug(rawSlug || name);
  if (!slug) return res.status(400).json({ error: '无效的网站标识符' });

  try {
    const result = await pool.query(
      `INSERT INTO sites (user_id, name, slug) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.id, name, slug]
    );
    // 创建网站目录
    const siteDir = path.join(SITES_DIR, String(req.user.id), slug);
    fs.mkdirSync(siteDir, { recursive: true });
    // 写入默认 index.html
    fs.writeFileSync(path.join(siteDir, 'index.html'),
      `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${name}</title></head><body><h1>${name}</h1><p>网站已创建，请上传你的文件。</p></body></html>`
    );
    res.status(201).json({
      site: result.rows[0],
      url: `/sites/${req.user.id}/${slug}/`,
    });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: '该标识符已被使用' });
    logger.error('创建网站失败', { message: error.message });
    res.status(500).json({ error: '创建网站失败' });
  }
});

// 上传文件到网站（支持多文件，保持目录结构）
router.post('/:id/deploy', authMiddleware, upload.array('files', 100), async (req, res) => {
  try {
    const site = await pool.query(
      'SELECT * FROM sites WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!site.rows[0]) return res.status(404).json({ error: '网站不存在' });
    const s = site.rows[0];
    const siteDir = path.join(SITES_DIR, String(req.user.id), s.slug);
    fs.mkdirSync(siteDir, { recursive: true });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: '未收到文件' });

    const deployed = [];
    for (const file of files) {
      // 文件路径来自 originalname（前端可传 relative path）
      const relativePath = file.originalname.replace(/\.\./g, '').replace(/^\//, '');
      const filePath = path.join(siteDir, relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.buffer);
      deployed.push(relativePath);
    }

    await pool.query(
      'UPDATE sites SET deploy_count = deploy_count + 1, last_deployed_at = NOW(), updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );

    res.json({
      message: `成功部署 ${deployed.length} 个文件`,
      files: deployed,
      url: `/sites/${req.user.id}/${s.slug}/`,
    });
  } catch (error) {
    logger.error('部署网站失败', { message: error.message });
    res.status(500).json({ error: '部署失败' });
  }
});

// 获取网站文件列表
router.get('/:id/files', authMiddleware, async (req, res) => {
  try {
    const site = await pool.query(
      'SELECT * FROM sites WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!site.rows[0]) return res.status(404).json({ error: '网站不存在' });
    const s = site.rows[0];
    const siteDir = path.join(SITES_DIR, String(req.user.id), s.slug);

    function listFiles(dir, base = '') {
      if (!fs.existsSync(dir)) return [];
      const items = [];
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const rel = base ? `${base}/${name}` : name;
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          items.push(...listFiles(full, rel));
        } else {
          items.push({ path: rel, size: stat.size, modified: stat.mtime });
        }
      }
      return items;
    }

    res.json({ files: listFiles(siteDir), siteDir: `${req.user.id}/${s.slug}` });
  } catch (error) {
    res.status(500).json({ error: '获取文件列表失败' });
  }
});

// 删除网站文件
router.delete('/:id/files', authMiddleware, async (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: '请提供文件路径' });
  try {
    const site = await pool.query(
      'SELECT * FROM sites WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!site.rows[0]) return res.status(404).json({ error: '网站不存在' });
    const s = site.rows[0];
    const safe = filePath.replace(/\.\./g, '').replace(/^\//, '');
    const full = path.join(SITES_DIR, String(req.user.id), s.slug, safe);
    if (fs.existsSync(full)) fs.unlinkSync(full);
    res.json({ message: '文件已删除' });
  } catch (error) {
    res.status(500).json({ error: '删除失败' });
  }
});

// 删除网站
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const site = await pool.query(
      'DELETE FROM sites WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.user.id]
    );
    if (!site.rows[0]) return res.status(404).json({ error: '网站不存在' });
    const s = site.rows[0];
    const siteDir = path.join(SITES_DIR, String(req.user.id), s.slug);
    if (fs.existsSync(siteDir)) fs.rmSync(siteDir, { recursive: true, force: true });
    res.json({ message: `网站「${s.name}」已删除` });
  } catch (error) {
    logger.error('删除网站失败', { message: error.message });
    res.status(500).json({ error: '删除失败' });
  }
});

// 更新网站设置
router.put('/:id', authMiddleware, async (req, res) => {
  const { name, index_file, status } = req.body;
  try {
    const result = await pool.query(
      `UPDATE sites SET name=COALESCE($1,name), index_file=COALESCE($2,index_file),
       status=COALESCE($3,status), updated_at=NOW()
       WHERE id=$4 AND user_id=$5 RETURNING *`,
      [name, index_file, status, req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: '网站不存在' });
    res.json({ site: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: '更新失败' });
  }
});

module.exports = router;
