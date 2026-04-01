// 分析数据服务 — 数据结构与前端 baas-admin.html 完全对齐
const MAX_RECENT_REQUESTS = 100; // 最近请求记录数
const MAX_ENDPOINT_ENTRIES = 200;
const MAX_PERFORMANCE_ENTRIES = 200; // 响应时间趋势数据点

const startTime = Date.now();

const state = {
  totalRequests: 0,
  totalErrors: 0,
  totalResponseTime: 0,
  // 端点统计: { [endpoint]: { count, totalDuration, errors } }
  endpointStats: {},
  // 最近请求列表（环形缓冲）
  recentRequests: [],
  // 响应时间趋势（环形缓冲）
  performance: [],
};

/**
 * 记录一次请求
 * @param {string} method
 * @param {string} path
 * @param {number} statusCode
 * @param {number} duration  ms
 */
function update(method, path, statusCode, duration) {
  state.totalRequests++;
  const isError = statusCode >= 400;
  if (isError) state.totalErrors++;
  state.totalResponseTime += duration;

  // 端点统计
  const key = `${method} ${path}`;
  if (!state.endpointStats[key]) {
    // 超出上限时删除调用最少的条目
    const keys = Object.keys(state.endpointStats);
    if (keys.length >= MAX_ENDPOINT_ENTRIES) {
      const leastUsed = keys.reduce((a, b) =>
        state.endpointStats[a].count < state.endpointStats[b].count ? a : b
      );
      delete state.endpointStats[leastUsed];
    }
    state.endpointStats[key] = { count: 0, totalDuration: 0, errors: 0 };
  }
  const ep = state.endpointStats[key];
  ep.count++;
  ep.totalDuration += duration;
  if (isError) ep.errors++;

  // 最近请求（环形缓冲）
  state.recentRequests.push({
    startTime: new Date().toISOString(),
    method,
    path,
    statusCode,
    duration,
  });
  if (state.recentRequests.length > MAX_RECENT_REQUESTS) {
    state.recentRequests.shift();
  }

  // 响应时间趋势（环形缓冲）
  state.performance.push({
    timestamp: new Date().toISOString(),
    duration,
  });
  if (state.performance.length > MAX_PERFORMANCE_ENTRIES) {
    state.performance.shift();
  }

  // 异步写入数据库持久化（不阻塞请求）
  try {
    const { pool } = require('../config/database');
    pool.query(
      'INSERT INTO analytics_requests (method, path, status_code, duration_ms) VALUES ($1,$2,$3,$4)',
      [method, path.substring(0, 500), statusCode, duration]
    ).catch(() => {});
  } catch {}
}

/**
 * 返回前端期望的完整数据结构
 */
function getStats() {
  const avgResponseTime = state.totalRequests > 0
    ? state.totalResponseTime / state.totalRequests
    : 0;

  const apiStats = Object.entries(state.endpointStats).map(([endpoint, ep]) => ({
    endpoint,
    count: ep.count,
    avgDuration: ep.count > 0 ? ep.totalDuration / ep.count : 0,
    errorRate: ep.count > 0 ? (ep.errors / ep.count) * 100 : 0,
  })).sort((a, b) => b.count - a.count);

  return {
    summary: {
      totalRequests: state.totalRequests,
      totalErrors: state.totalErrors,
      avgResponseTime,
      uptime: (Date.now() - startTime) / 1000, // 秒
    },
    apiStats,
    recentRequests: [...state.recentRequests].reverse(), // 最新的在前
    performance: state.performance,
  };
}

module.exports = { update, getStats };
