// 按 IP + 用户 ID 分级限流，防止内存泄漏
const limits = new Map();
const WINDOW_MS = 60 * 1000;

// 不同端点的限制
const RULES = {
  '/api/auth/login':    { max: 10,  window: 60 * 1000 },   // 登录：10次/分钟
  '/api/auth/register': { max: 5,   window: 60 * 1000 },   // 注册：5次/分钟
  default:              { max: 200, window: 60 * 1000 },   // 其他：200次/分钟
};

// 定期清理过期记录
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of limits.entries()) {
    if (now >= entry.resetTime) limits.delete(key);
  }
}, WINDOW_MS);

const rateLimitMiddleware = (req, res, next) => {
  const rule = RULES[req.path] || RULES.default;
  // 优先用用户 ID，其次用 IP
  const identity = req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
  const key = `${identity}:${req.path}`;
  const now = Date.now();

  const entry = limits.get(key);
  if (!entry || now >= entry.resetTime) {
    limits.set(key, { count: 1, resetTime: now + rule.window });
    return next();
  }

  entry.count++;
  if (entry.count > rule.max) {
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
    res.setHeader('Retry-After', retryAfter);
    res.setHeader('X-RateLimit-Limit', rule.max);
    res.setHeader('X-RateLimit-Remaining', 0);
    return res.status(429).json({
      error: '请求过于频繁，请稍后再试',
      retryAfter,
    });
  }

  res.setHeader('X-RateLimit-Limit', rule.max);
  res.setHeader('X-RateLimit-Remaining', rule.max - entry.count);
  next();
};

module.exports = rateLimitMiddleware;
