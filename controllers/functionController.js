const { pool } = require('../config/database');
const { logger } = require('../middlewares/logger');

const getFunctions = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM cloud_functions WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ functions: result.rows });
  } catch (error) {
    logger.error('获取函数列表失败', { message: error.message });
    res.status(500).json({ error: '获取函数列表失败' });
  }
};

const getFunction = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM cloud_functions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: '函数不存在' });
    res.json({ function: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: '获取函数失败' });
  }
};

const createFunction = async (req, res) => {
  const { name, code, language = 'javascript', trigger_type } = req.body;
  const id = `func_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  try {
    const result = await pool.query(
      'INSERT INTO cloud_functions (id, user_id, name, code, language, trigger_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [id, req.user.id, name, code, language, trigger_type || null]
    );
    res.status(201).json({ function: result.rows[0] });
  } catch (error) {
    logger.error('创建函数失败', { message: error.message });
    res.status(500).json({ error: '创建函数失败' });
  }
};

const updateFunction = async (req, res) => {
  const { id } = req.params;
  const { name, code, language, trigger_type } = req.body;
  try {
    const current = await pool.query(
      'SELECT * FROM cloud_functions WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!current.rows[0]) return res.status(404).json({ error: '函数不存在' });
    const fn = current.rows[0];
    const result = await pool.query(
      `UPDATE cloud_functions SET name=$1, code=$2, language=$3, trigger_type=$4, updated_at=NOW()
       WHERE id=$5 AND user_id=$6 RETURNING *`,
      [name || fn.name, code || fn.code, language || fn.language,
       trigger_type !== undefined ? trigger_type : fn.trigger_type, id, req.user.id]
    );
    res.json({ function: result.rows[0] });
  } catch (error) {
    logger.error('更新函数失败', { message: error.message });
    res.status(500).json({ error: '更新函数失败' });
  }
};

const invokeFunction = async (req, res) => {
  const { id } = req.params;
  const payload = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM cloud_functions WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: '函数不存在' });
    const func = result.rows[0];

    // 沙箱执行：禁止访问 require/process/global
    const vm = require('vm');
    const sandbox = {
      payload,
      console: { log: () => {}, error: () => {}, warn: () => {} },
      Math, JSON, Date, parseInt, parseFloat, isNaN, isFinite,
      Array, Object, String, Number, Boolean, RegExp,
      setTimeout: undefined, setInterval: undefined,
      require: undefined, process: undefined, global: undefined,
      __result: undefined,
    };
    const script = new vm.Script(`
      "use strict";
      ${func.code}
      __result = typeof handler === 'function' ? handler(payload) : '函数已执行';
    `);
    let output;
    try {
      script.runInNewContext(sandbox, { timeout: 3000 }); // 3秒超时
      output = sandbox.__result;
    } catch (execError) {
      const msg = execError.message.includes('timed out')
        ? '函数执行超时（最大3秒）'
        : execError.message;
      return res.status(422).json({ error: '函数执行错误', detail: msg });
    }
    res.json({ result: output, functionId: id, name: func.name });
  } catch (error) {
    logger.error('调用函数失败', { message: error.message });
    res.status(500).json({ error: '调用函数失败' });
  }
};

const deleteFunction = async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM cloud_functions WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: '函数不存在' });
    res.json({ message: '函数删除成功' });
  } catch (error) {
    logger.error('删除函数失败', { message: error.message });
    res.status(500).json({ error: '删除函数失败' });
  }
};

module.exports = { getFunctions, getFunction, createFunction, updateFunction, invokeFunction, deleteFunction };
