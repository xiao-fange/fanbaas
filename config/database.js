const { Pool } = require('pg');
const { logger } = require('../middlewares/logger');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT) || 5432,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('数据库连接池错误', { message: err.message });
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS cloud_functions (
        id VARCHAR(100) PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        code TEXT NOT NULL,
        language VARCHAR(50) DEFAULT 'javascript',
        trigger_type VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS storage_buckets (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        minio_bucket VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(name, user_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS storage_files (
        id SERIAL PRIMARY KEY,
        bucket_name VARCHAR(255) NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255),
        size_bytes BIGINT DEFAULT 0,
        mime_type VARCHAR(100),
        minio_object VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS realtime_data (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        collection VARCHAR(255) NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_realtime_collection ON realtime_data(user_id, collection)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS token_blacklist (
        token_jti VARCHAR(255) PRIMARY KEY,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(64) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_requests (
        id SERIAL PRIMARY KEY,
        method VARCHAR(10),
        path VARCHAR(500),
        status_code INTEGER,
        duration_ms INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_requests(created_at DESC)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) NOT NULL,
        bucket_name VARCHAR(255),
        index_file VARCHAR(255) DEFAULT 'index.html',
        status VARCHAR(20) DEFAULT 'active',
        custom_domain VARCHAR(255),
        deploy_count INTEGER DEFAULT 0,
        last_deployed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, slug)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS apps (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        api_key VARCHAR(64) UNIQUE NOT NULL,
        permissions JSONB DEFAULT '["auth","database","storage","functions","realtime"]',
        status VARCHAR(20) DEFAULT 'active',
        created_by INTEGER,
        last_used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    logger.info('数据库表初始化完成');

    // 迁移：给旧表加新字段（幂等）
    await client.query(`ALTER TABLE storage_buckets ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
    await client.query(`ALTER TABLE storage_buckets ADD COLUMN IF NOT EXISTS minio_bucket VARCHAR(255)`);
    await client.query(`ALTER TABLE storage_files ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
    await client.query(`ALTER TABLE storage_files ADD COLUMN IF NOT EXISTS minio_object VARCHAR(500)`);
    await client.query(`ALTER TABLE cloud_functions ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
    await client.query(`ALTER TABLE realtime_data ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_realtime_user_collection ON realtime_data(user_id, collection)`);
    logger.info('数据库迁移完成');
  } finally {
    client.release();
  }
}

// 带重试的数据库连接检查
async function connectWithRetry(retries = 5, delay = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      logger.info('数据库连接成功');
      return;
    } catch (err) {
      logger.warn(`数据库连接失败 (${i}/${retries})`, { message: err.message });
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

module.exports = { pool, initDatabase, connectWithRetry };
