const router = require('express').Router();
const { getFunctions, getFunction, createFunction, updateFunction, invokeFunction, deleteFunction } = require('../controllers/functionController');
const { authMiddleware } = require('../middlewares/auth');
const { validate, schemas } = require('../middlewares/validate');

router.get('/', authMiddleware, getFunctions);
router.get('/:id', authMiddleware, getFunction);
router.post('/', authMiddleware, validate(schemas.createFunction), createFunction);
router.put('/:id', authMiddleware, updateFunction);
router.post('/:id/invoke', authMiddleware, invokeFunction);
router.delete('/:id', authMiddleware, deleteFunction);

module.exports = router;
