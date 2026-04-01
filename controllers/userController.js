const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { pool } = require('../config/database');
const { logger } = require('../middlewares/logger');
const { sendWelcome } = require('../services/mailer');

const SALT_ROUNDS = 12;

const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: '邮箱或密码错误' });
    }

    const jti = `${user.id}_${Date.now()}`;
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, jti },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    logger.error('登录失败', { message: error.message });
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
};

const logout = async (req, res) => {
  try {
    const { jti, exp } = req.user;
    if (jti && exp) {
      await pool.query(
        'INSERT INTO token_blacklist (token_jti, expires_at) VALUES ($1, to_timestamp($2)) ON CONFLICT DO NOTHING',
        [jti, exp]
      );
    }
    res.json({ message: '已成功登出' });
  } catch (error) {
    logger.error('登出失败', { message: error.message });
    res.status(500).json({ error: '登出失败' });
  }
};

const register = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: '该邮箱已被注册' });
    }
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, created_at',
      [name, email, passwordHash, 'user']
    );
    // 异步发送欢迎邮件，不阻塞注册响应
    sendWelcome(email, name).catch(() => {});
    res.status(201).json({ user: result.rows[0] });
  } catch (error) {
    logger.error('注册失败', { message: error.message });
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
};

const getUsers = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ users: result.rows });
  } catch (error) {
    logger.error('获取用户列表失败', { message: error.message });
    res.status(500).json({ error: '获取用户列表失败' });
  }
};

const getCurrentUser = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: '用户不存在' });
    res.json({ user: result.rows[0] });
  } catch (error) {
    logger.error('获取用户信息失败', { message: error.message });
    res.status(500).json({ error: '获取用户信息失败' });
  }
};

const updateUser = async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: '姓名长度不能少于2位' });
  }
  try {
    const result = await pool.query(
      'UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, role',
      [name.trim(), req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: '用户不存在' });
    res.json({ user: result.rows[0] });
  } catch (error) {
    logger.error('更新用户信息失败', { message: error.message });
    res.status(500).json({ error: '更新用户信息失败' });
  }
};

const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: '用户不存在' });

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: '当前密码错误' });

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.id]);
    res.json({ message: '密码修改成功' });
  } catch (error) {
    logger.error('修改密码失败', { message: error.message });
    res.status(500).json({ error: '修改密码失败' });
  }
};

const deleteUser = async (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ error: '不能删除自己的账号' });
  }
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: '用户不存在' });
    res.json({ message: '用户删除成功' });
  } catch (error) {
    logger.error('删除用户失败', { message: error.message });
    res.status(500).json({ error: '删除用户失败' });
  }
};

module.exports = { login, logout, register, getUsers, getCurrentUser, updateUser, changePassword, deleteUser };
