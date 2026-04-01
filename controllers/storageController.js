const { pool } = require('../config/database');
const { logger } = require('../middlewares/logger');
const minio = require('../services/minio');
const path = require('path');
const crypto = require('crypto');

// MinIO bucket 名称规范：全小写，只含字母数字和连字符
function minioBucketName(userId, bucketName) {
  return `user-${userId}-${bucketName}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

const getBuckets = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*, COUNT(f.id)::int AS file_count,
             COALESCE(SUM(f.size_bytes), 0)::bigint AS total_size
      FROM storage_buckets b
      LEFT JOIN storage_files f ON f.bucket_name = b.name AND f.user_id = b.user_id
      WHERE b.user_id = $1
      GROUP BY b.id ORDER BY b.created_at DESC
    `, [req.user.id]);
    res.json({ buckets: result.rows });
  } catch (error) {
    logger.error('获取存储桶列表失败', { message: error.message });
    res.status(500).json({ error: '获取存储桶列表失败' });
  }
};

const createBucket = async (req, res) => {
  const { name, description } = req.body;
  if (!/^[a-z0-9-]+$/.test(name)) {
    return res.status(400).json({ error: '存储桶名称只能包含小写字母、数字和连字符' });
  }
  try {
    // 检查该用户是否已有同名桶
    const exists = await pool.query(
      'SELECT id FROM storage_buckets WHERE name = $1 AND user_id = $2',
      [name, req.user.id]
    );
    if (exists.rows.length > 0) return res.status(409).json({ error: '存储桶名称已存在' });

    // 在 MinIO 创建对应 bucket
    const minioBucket = minioBucketName(req.user.id, name);
    await minio.ensureBucket(minioBucket);

    const result = await pool.query(
      'INSERT INTO storage_buckets (name, description, user_id, minio_bucket) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, description || null, req.user.id, minioBucket]
    );
    res.status(201).json({ bucket: result.rows[0] });
  } catch (error) {
    logger.error('创建存储桶失败', { message: error.message });
    res.status(500).json({ error: '创建存储桶失败' });
  }
};

const deleteBucket = async (req, res) => {
  try {
    const bucket = await pool.query(
      'SELECT * FROM storage_buckets WHERE name = $1 AND user_id = $2',
      [req.params.name, req.user.id]
    );
    if (!bucket.rows[0]) return res.status(404).json({ error: '存储桶不存在' });

    // 删除 MinIO 中的 bucket 及文件
    if (bucket.rows[0].minio_bucket) {
      await minio.deleteBucket(bucket.rows[0].minio_bucket).catch(e =>
        logger.warn('MinIO bucket 删除失败', { message: e.message })
      );
    }

    await pool.query('DELETE FROM storage_buckets WHERE name = $1 AND user_id = $2', [req.params.name, req.user.id]);
    res.json({ message: '存储桶删除成功' });
  } catch (error) {
    logger.error('删除存储桶失败', { message: error.message });
    res.status(500).json({ error: '删除存储桶失败' });
  }
};

const getFiles = async (req, res) => {
  try {
    const bucket = await pool.query(
      'SELECT * FROM storage_buckets WHERE name = $1 AND user_id = $2',
      [req.params.name, req.user.id]
    );
    if (!bucket.rows[0]) return res.status(404).json({ error: '存储桶不存在' });

    const result = await pool.query(
      'SELECT * FROM storage_files WHERE bucket_name = $1 AND user_id = $2 ORDER BY created_at DESC',
      [req.params.name, req.user.id]
    );
    res.json({ files: result.rows });
  } catch (error) {
    logger.error('获取文件列表失败', { message: error.message });
    res.status(500).json({ error: '获取文件列表失败' });
  }
};

const uploadFile = async (req, res) => {
  const { name } = req.params;
  if (!req.file) return res.status(400).json({ error: '未收到文件' });

  try {
    const bucket = await pool.query(
      'SELECT * FROM storage_buckets WHERE name = $1 AND user_id = $2',
      [name, req.user.id]
    );
    if (!bucket.rows[0]) return res.status(404).json({ error: '存储桶不存在' });

    const ext = path.extname(req.file.originalname);
    const objectName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const minioBucket = bucket.rows[0].minio_bucket || minioBucketName(req.user.id, name);

    // 上传到 MinIO
    await minio.uploadFile(minioBucket, objectName, req.file.buffer, req.file.mimetype, req.file.size);

    const result = await pool.query(
      `INSERT INTO storage_files
         (bucket_name, user_id, filename, original_name, size_bytes, mime_type, minio_object)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, req.user.id, objectName, req.file.originalname, req.file.size, req.file.mimetype, objectName]
    );
    res.status(201).json({ file: result.rows[0] });
  } catch (error) {
    logger.error('文件上传失败', { message: error.message });
    res.status(500).json({ error: '文件上传失败' });
  }
};

const deleteFile = async (req, res) => {
  const { name, fileId } = req.params;
  try {
    const file = await pool.query(
      'SELECT f.*, b.minio_bucket FROM storage_files f JOIN storage_buckets b ON b.name = f.bucket_name AND b.user_id = f.user_id WHERE f.id = $1 AND f.bucket_name = $2 AND f.user_id = $3',
      [fileId, name, req.user.id]
    );
    if (!file.rows[0]) return res.status(404).json({ error: '文件不存在' });

    // 从 MinIO 删除
    if (file.rows[0].minio_object && file.rows[0].minio_bucket) {
      await minio.deleteFile(file.rows[0].minio_bucket, file.rows[0].minio_object).catch(e =>
        logger.warn('MinIO 文件删除失败', { message: e.message })
      );
    }

    await pool.query('DELETE FROM storage_files WHERE id = $1 AND user_id = $2', [fileId, req.user.id]);
    res.json({ message: '文件删除成功' });
  } catch (error) {
    logger.error('删除文件失败', { message: error.message });
    res.status(500).json({ error: '删除文件失败' });
  }
};

// 获取文件下载链接（预签名 URL）
const getDownloadUrl = async (req, res) => {
  const { name, fileId } = req.params;
  try {
    const file = await pool.query(
      'SELECT f.*, b.minio_bucket FROM storage_files f JOIN storage_buckets b ON b.name = f.bucket_name AND b.user_id = f.user_id WHERE f.id = $1 AND f.bucket_name = $2 AND f.user_id = $3',
      [fileId, name, req.user.id]
    );
    if (!file.rows[0]) return res.status(404).json({ error: '文件不存在' });

    const url = await minio.getDownloadUrl(file.rows[0].minio_bucket, file.rows[0].minio_object);
    res.json({ url, expires_in: 3600 });
  } catch (error) {
    logger.error('获取下载链接失败', { message: error.message });
    res.status(500).json({ error: '获取下载链接失败' });
  }
};

module.exports = { getBuckets, createBucket, deleteBucket, getFiles, uploadFile, deleteFile, getDownloadUrl };
