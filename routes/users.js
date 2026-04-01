const router = require('express').Router();
const { getUsers, getCurrentUser, updateUser, changePassword, deleteUser, register } = require('../controllers/userController');
const { authMiddleware, roleMiddleware } = require('../middlewares/auth');
const { validate, schemas } = require('../middlewares/validate');

// GET /api/users — admin 看全部，普通用户只看自己
router.get('/', async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    // 无 token，返回公开列表
    return getUsers(req, res);
  }
  // 有 token，验证身份
  return authMiddleware(req, res, () => {
    if (req.user.role === 'admin') {
      return getUsers(req, res);
    }
    // 非 admin，只返回自己
    return getCurrentUser(req, res);
  });
});

// 前端 POST /api/users 是管理员创建用户（等同于注册）
router.post('/', authMiddleware, roleMiddleware('admin'), validate(schemas.register), register);

router.get('/me', authMiddleware, getCurrentUser);
router.put('/me', authMiddleware, updateUser);
router.put('/me/password', authMiddleware, validate(schemas.changePassword), changePassword);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), deleteUser);

module.exports = router;
