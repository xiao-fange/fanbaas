// 轻量级输入验证，无需额外依赖

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(schema) {
  return (req, res, next) => {
    const errors = [];
    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];

      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} 不能为空`);
        continue;
      }
      if (value === undefined || value === null || value === '') continue;

      if (rules.type === 'string' && typeof value !== 'string') {
        errors.push(`${field} 必须是字符串`);
      }
      if (rules.minLength && typeof value === 'string' && value.length < rules.minLength) {
        errors.push(`${field} 长度不能少于 ${rules.minLength} 位`);
      }
      if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
        errors.push(`${field} 长度不能超过 ${rules.maxLength} 位`);
      }
      if (rules.email && !EMAIL_RE.test(value)) {
        errors.push(`${field} 格式不正确`);
      }
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push(`${field} 必须是以下值之一: ${rules.enum.join(', ')}`);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0], errors });
    }
    next();
  };
}

// 预定义常用 schema
const schemas = {
  login: {
    email: { required: true, type: 'string', email: true },
    password: { required: true, type: 'string', minLength: 1 },
  },
  register: {
    name: { required: true, type: 'string', minLength: 2, maxLength: 100 },
    email: { required: true, type: 'string', email: true },
    password: { required: true, type: 'string', minLength: 8, maxLength: 128 },
  },
  createFunction: {
    name: { required: true, type: 'string', minLength: 1, maxLength: 100 },
    code: { required: true, type: 'string', minLength: 1 },
    language: { type: 'string', enum: ['javascript'] },
  },
  createBucket: {
    name: { required: true, type: 'string', minLength: 1, maxLength: 63 },
  },
  changePassword: {
    currentPassword: { required: true, type: 'string', minLength: 1 },
    newPassword: { required: true, type: 'string', minLength: 8, maxLength: 128 },
  },
};

module.exports = { validate, schemas };
