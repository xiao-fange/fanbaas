const { pool } = require('../config/database');
const { logger } = require('../middlewares/logger');
const jwt = require('jsonwebtoken');

const MAX_CONNECTIONS = 500;
let connectionCount = 0;

function setupWebSocket(io) {
  // WebSocket 认证中间件
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
      || socket.handshake.headers?.authorization?.split(' ')[1];
    if (!token) return next(new Error('未提供认证令牌'));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('无效的令牌'));
    }
  });

  io.on('connection', (socket) => {
    // 连接数限制
    if (connectionCount >= MAX_CONNECTIONS) {
      socket.emit('error', { message: '服务器连接数已达上限' });
      socket.disconnect(true);
      return;
    }
    connectionCount++;
    logger.info('WebSocket 连接', { userId: socket.user?.id, total: connectionCount });

    socket.on('subscribe', (collection) => {
      if (typeof collection === 'string' && collection.length <= 100) {
        socket.join(`collection:${socket.user.id}:${collection}`);
      }
    });

    socket.on('unsubscribe', (collection) => {
      socket.leave(`collection:${socket.user.id}:${collection}`);
    });

    socket.on('getData', async ({ collection }) => {
      if (!collection || typeof collection !== 'string') {
        return socket.emit('error', { message: '无效的集合名称' });
      }
      try {
        const result = await pool.query(
          'SELECT * FROM realtime_data WHERE collection = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 100',
          [collection, socket.user.id]
        );
        socket.emit('collectionData', { collection, data: result.rows });
      } catch (error) {
        logger.error('WebSocket getData 失败', { message: error.message });
        socket.emit('error', { message: '获取数据失败' });
      }
    });

    socket.on('addData', async ({ collection, data }) => {
      if (!collection || !data || typeof data !== 'object') {
        return socket.emit('error', { message: '参数不完整' });
      }
      try {
        const result = await pool.query(
          'INSERT INTO realtime_data (user_id, collection, data) VALUES ($1, $2, $3) RETURNING *',
          [socket.user.id, collection, JSON.stringify(data)]
        );
        io.to(`collection:${socket.user.id}:${collection}`).emit('dataAdded', { collection, item: result.rows[0] });
      } catch (error) {
        logger.error('WebSocket addData 失败', { message: error.message });
        socket.emit('error', { message: '添加数据失败' });
      }
    });

    socket.on('updateData', async ({ collection, id, data }) => {
      if (!collection || !id || !data) {
        return socket.emit('error', { message: '参数不完整' });
      }
      try {
        const result = await pool.query(
          'UPDATE realtime_data SET data = $1, updated_at = NOW() WHERE id = $2 AND collection = $3 AND user_id = $4 RETURNING *',
          [JSON.stringify(data), id, collection, socket.user.id]
        );
        if (result.rowCount === 0) return socket.emit('error', { message: '数据不存在' });
        io.to(`collection:${socket.user.id}:${collection}`).emit('dataUpdated', { collection, item: result.rows[0] });
      } catch (error) {
        logger.error('WebSocket updateData 失败', { message: error.message });
        socket.emit('error', { message: '更新数据失败' });
      }
    });

    socket.on('deleteData', async ({ collection, id }) => {
      if (!collection || !id) return socket.emit('error', { message: '参数不完整' });
      try {
        const result = await pool.query(
          'DELETE FROM realtime_data WHERE id = $1 AND collection = $2 AND user_id = $3 RETURNING id',
          [id, collection, socket.user.id]
        );
        if (result.rowCount === 0) return socket.emit('error', { message: '数据不存在' });
        io.to(`collection:${socket.user.id}:${collection}`).emit('dataDeleted', { collection, id });
      } catch (error) {
        logger.error('WebSocket deleteData 失败', { message: error.message });
        socket.emit('error', { message: '删除数据失败' });
      }
    });

    socket.on('disconnect', () => {
      connectionCount = Math.max(0, connectionCount - 1);
      logger.info('WebSocket 断开', { userId: socket.user?.id, total: connectionCount });
    });

    socket.on('error', (err) => {
      logger.error('WebSocket 错误', { userId: socket.user?.id, message: err.message });
    });
  });
}

module.exports = { setupWebSocket };
