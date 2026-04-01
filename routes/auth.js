const router = require('express').Router();
const crypto = require('crypto');
const { login, logout, register } = require('../controllers/userController');
const { authMiddleware } = require('../middlewares/auth');
const { validate, schemas } = require('../middlewares/validate');
const { pool } = require('../config/database');
const { logger } = require('../middlewares/logger');
const bcrypt = require('bcrypt');
const { sendPasswordReset } = require('../services/mailer');

router.post('/login', validate(schemas.login), login);
router.post('/register', validate(schemas.register), register);
router.post('/logout', authMiddleware, logout);

// 忘记密码 — 生成重置 token（实际项目应发邮件，这里直接返回 token 供测试）
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: '请提供邮箱' });
  try {
    const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    // 无论用户是否存在都返回成功（防止枚举攻击）
    if (!result.rows[0]) {
      return res.json({ message: '如果该邮箱已注册，重置链接已发送' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1小时
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET token=$2, expires_at=$3`,
      [result.rows[0].id, token, expires]
    );

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const mailResult = await sendPasswordReset(email, token, baseUrl);

    res.json({
      message: '如果该邮箱已注册，重置链接已发送到你的邮箱',
      // 开发模式（未配置SMTP）直接返回 token
      ...(mailResult?.dev ? { dev_reset_token: token, dev_reset_url: mailResult.url } : {}),
    });
  } catch (error) {
    logger.error('忘记密码失败', { message: error.message });
    res.status(500).json({ error: '操作失败' });
  }
});

// 重置密码
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: '参数不完整' });
  if (newPassword.length < 8) return res.status(400).json({ error: '密码长度不能少于8位' });
  try {
    const result = await pool.query(
      `SELECT user_id FROM password_reset_tokens
       WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );
    if (!result.rows[0]) return res.status(400).json({ error: '重置链接无效或已过期' });
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [hash, result.rows[0].user_id]);
    await pool.query('DELETE FROM password_reset_tokens WHERE token = $1', [token]);
    res.json({ message: '密码重置成功，请重新登录' });
  } catch (error) {
    logger.error('重置密码失败', { message: error.message });
    res.status(500).json({ error: '重置失败' });
  }
});

module.exports = router;
