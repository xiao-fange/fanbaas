const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 检查 token 是否已被吊销
    if (decoded.jti) {
      const blacklisted = await pool.query(
        'SELECT 1 FROM token_blacklist WHERE token_jti = $1 AND expires_at > NOW()',
        [decoded.jti]
      );
      if (blacklisted.rows.length > 0) {
        return res.status(401).json({ error: '令牌已失效，请重新登录' });
      }
    }

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: '无效或已过期的令牌' });
  }
};

const roleMiddleware = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: '未授权' });
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: '权限不足' });
  }
  next();
};

module.exports = { authMiddleware, roleMiddleware };
