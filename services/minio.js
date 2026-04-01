const Minio = require('minio');
const { logger } = require('../middlewares/logger');

const client = new Minio.Client({
  endPoint: process.env.MINIO_HOST || 'localhost',
  port: parseInt(process.env.MINIO_PORT) || 9000,
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY || 'baas_minio_access_key_2026',
  secretKey: process.env.MINIO_SECRET_KEY || 'baas_minio_secret_key_2026',
});

// 确保 bucket 存在
async function ensureBucket(bucketName) {
  const exists = await client.bucketExists(bucketName);
  if (!exists) {
    await client.makeBucket(bucketName, 'us-east-1');
    logger.info(`MinIO bucket 已创建: ${bucketName}`);
  }
}

// 上传文件（Buffer）
async function uploadFile(bucketName, objectName, buffer, mimeType, size) {
  await ensureBucket(bucketName);
  await client.putObject(bucketName, objectName, buffer, size, { 'Content-Type': mimeType });
  return objectName;
}

// 删除文件
async function deleteFile(bucketName, objectName) {
  await client.removeObject(bucketName, objectName);
}

// 删除 bucket 及其所有文件
async function deleteBucket(bucketName) {
  try {
    const objects = [];
    const stream = client.listObjects(bucketName, '', true);
    await new Promise((resolve, reject) => {
      stream.on('data', obj => objects.push(obj.name));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    if (objects.length > 0) {
      await client.removeObjects(bucketName, objects);
    }
    await client.removeBucket(bucketName);
  } catch (err) {
    if (err.code !== 'NoSuchBucket') throw err;
  }
}

// 生成预签名下载 URL（1小时有效）
async function getDownloadUrl(bucketName, objectName, expiry = 3600) {
  return client.presignedGetObject(bucketName, objectName, expiry);
}

// 获取文件信息
async function statFile(bucketName, objectName) {
  return client.statObject(bucketName, objectName);
}

module.exports = { client, ensureBucket, uploadFile, deleteFile, deleteBucket, getDownloadUrl, statFile };
