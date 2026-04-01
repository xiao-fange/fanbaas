const router = require('express').Router();
const multer = require('multer');
const { getBuckets, createBucket, deleteBucket, getFiles, uploadFile, deleteFile, getDownloadUrl } = require('../controllers/storageController');
const { authMiddleware } = require('../middlewares/auth');
const { validate, schemas } = require('../middlewares/validate');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

router.get('/buckets', authMiddleware, getBuckets);
router.post('/buckets', authMiddleware, validate(schemas.createBucket), createBucket);
router.delete('/buckets/:name', authMiddleware, deleteBucket);
router.get('/buckets/:name/files', authMiddleware, getFiles);
router.post('/buckets/:name/upload', authMiddleware, upload.single('file'), uploadFile);
router.delete('/buckets/:name/files/:fileId', authMiddleware, deleteFile);
router.get('/buckets/:name/files/:fileId/url', authMiddleware, getDownloadUrl);

module.exports = router;
