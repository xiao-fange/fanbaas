require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT) || 5432,
});

async function seed() {
  const hash = await bcrypt.hash('admin123', 12);
  await pool.query('DELETE FROM users WHERE email = $1', ['admin@example.com']);
  await pool.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)",
    ['Admin', 'admin@example.com', hash, 'admin']
  );
  console.log('管理员账号创建成功: admin@example.com / admin123');
  await pool.end();
}

seed().catch(e => { console.error(e); process.exit(1); });
