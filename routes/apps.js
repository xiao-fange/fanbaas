const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middlewares/auth');
const { logger } = require('../middlewares/logger');

const ALL_PERMISSIONS = ['auth', 'database', 'storage', 'functions', 'realtime'];

function generateApiKey() {
  return 'bk_' + crypto.randomBytes(28).toString('hex');
}

// 获取所有应用
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*, u.name AS creator_name
       FROM apps a LEFT JOIN users u ON u.id = a.created_by
       ORDER BY a.created_at DESC`
    );
    res.json({ apps: result.rows });
  } catch (error) {
    logger.error('获取应用列表失败', { message: error.message });
    res.status(500).json({ error: '获取应用列表失败' });
  }
});

// 创建应用
router.post('/', authMiddleware, async (req, res) => {
  const { name, description, permissions } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '应用名称不能为空' });
  const perms = Array.isArray(permissions)
    ? permissions.filter(p => ALL_PERMISSIONS.includes(p))
    : ALL_PERMISSIONS;
  const apiKey = generateApiKey();
  try {
    const result = await pool.query(
      `INSERT INTO apps (name, description, api_key, permissions, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name.trim(), description || '', apiKey, JSON.stringify(perms), req.user.id]
    );
    res.status(201).json({ app: result.rows[0] });
  } catch (error) {
    logger.error('创建应用失败', { message: error.message });
    res.status(500).json({ error: '创建应用失败' });
  }
});

// 获取单个应用
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM apps WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: '应用不存在' });
    res.json({ app: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: '获取应用失败' });
  }
});

// 更新应用
router.put('/:id', authMiddleware, async (req, res) => {
  const { name, description, permissions } = req.body;
  try {
    const current = await pool.query('SELECT * FROM apps WHERE id = $1', [req.params.id]);
    if (!current.rows[0]) return res.status(404).json({ error: '应用不存在' });
    const perms = Array.isArray(permissions)
      ? permissions.filter(p => ALL_PERMISSIONS.includes(p))
      : current.rows[0].permissions;
    const result = await pool.query(
      `UPDATE apps SET name=$1, description=$2, permissions=$3, updated_at=NOW() WHERE id=$4 RETURNING *`,
      [name || current.rows[0].name, description ?? current.rows[0].description, JSON.stringify(perms), req.params.id]
    );
    res.json({ app: result.rows[0] });
  } catch (error) {
    logger.error('更新应用失败', { message: error.message });
    res.status(500).json({ error: '更新应用失败' });
  }
});

// 重置 API Key
router.post('/:id/reset-key', authMiddleware, async (req, res) => {
  try {
    const newKey = generateApiKey();
    const result = await pool.query(
      'UPDATE apps SET api_key=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [newKey, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: '应用不存在' });
    res.json({ app: result.rows[0], message: '已生成新的 API Key，请妥善保存' });
  } catch (error) {
    res.status(500).json({ error: '重置失败' });
  }
});

// 启用/禁用
router.post('/:id/toggle', authMiddleware, async (req, res) => {
  try {
    const current = await pool.query('SELECT status FROM apps WHERE id = $1', [req.params.id]);
    if (!current.rows[0]) return res.status(404).json({ error: '应用不存在' });
    const newStatus = current.rows[0].status === 'active' ? 'disabled' : 'active';
    const result = await pool.query(
      'UPDATE apps SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [newStatus, req.params.id]
    );
    res.json({ app: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: '操作失败' });
  }
});

// 删除应用
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM apps WHERE id=$1 RETURNING id, name', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: '应用不存在' });
    res.json({ message: `应用 "${result.rows[0].name}" 已删除` });
  } catch (error) {
    res.status(500).json({ error: '删除失败' });
  }
});

// 获取接入文档
router.get('/:id/docs', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM apps WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: '应用不存在' });
    const app = result.rows[0];
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({
      appName: app.name,
      apiKey: app.api_key,
      baseUrl: base,
      permissions: app.permissions,
      examples: {
        curl:       genCurl(base, app.api_key, app.permissions),
        javascript: genJs(base, app.api_key, app.permissions),
        swift:      genSwift(base, app.api_key, app.permissions),
        kotlin:     genKotlin(base, app.api_key, app.permissions),
      }
    });
  } catch (error) {
    res.status(500).json({ error: '获取文档失败' });
  }
});

// ── 代码生成 ──────────────────────────────────────────────────────────────────

function genCurl(base, key, perms) {
  const h = `-H "Authorization: Bearer $TOKEN" -H "X-API-Key: ${key}"`;
  const lines = [
`# ============================================================
#  接入示例 — cURL   服务地址: ${base}
# ============================================================

# ── 用户认证 ─────────────────────────────────────────────────

# 注册新账号
curl -X POST ${base}/api/auth/register \\
  -H "Content-Type: application/json" -H "X-API-Key: ${key}" \\
  -d '{"name":"张三","email":"user@example.com","password":"mypassword123"}'

# 登录（返回 token，后续请求替换 $TOKEN）
curl -X POST ${base}/api/auth/login \\
  -H "Content-Type: application/json" -H "X-API-Key: ${key}" \\
  -d '{"email":"user@example.com","password":"mypassword123"}'

# 获取当前用户信息
curl ${base}/api/users/me ${h}

# 修改密码
curl -X PUT ${base}/api/users/me/password \\
  ${h} -H "Content-Type: application/json" \\
  -d '{"currentPassword":"old123","newPassword":"new456789"}'`
  ];

  if (perms.includes('database')) {
    lines.push(`
# ── 数据库 ───────────────────────────────────────────────────

# 获取所有数据表
curl ${base}/api/database/tables ${h}

# 创建数据集合（表）
curl -X POST ${base}/api/database/tables \\
  ${h} -H "Content-Type: application/json" \\
  -d '{"name":"posts","columns":[
    {"name":"title",  "type":"VARCHAR(255)","nullable":false},
    {"name":"content","type":"TEXT",        "nullable":true},
    {"name":"user_id","type":"INTEGER",     "nullable":false}
  ]}'

# 查询数据（仅支持 SELECT）
curl -X POST ${base}/api/database/query \\
  ${h} -H "Content-Type: application/json" \\
  -d '{"query":"SELECT * FROM posts ORDER BY created_at DESC LIMIT 20"}'

# 获取表结构
curl ${base}/api/database/schema/posts ${h}`);
  }

  if (perms.includes('storage')) {
    lines.push(`
# ── 文件存储 ─────────────────────────────────────────────────

# 获取存储桶列表
curl ${base}/api/storage/buckets ${h}

# 创建存储桶
curl -X POST ${base}/api/storage/buckets \\
  ${h} -H "Content-Type: application/json" \\
  -d '{"name":"images","description":"用户上传的图片"}'

# 上传文件（multipart）
curl -X POST ${base}/api/storage/buckets/images/upload \\
  ${h} -F "file=@/path/to/photo.jpg"

# 获取桶内文件列表
curl ${base}/api/storage/buckets/images/files ${h}

# 删除文件（FILE_ID 替换为实际 id）
curl -X DELETE ${base}/api/storage/buckets/images/files/FILE_ID ${h}`);
  }

  if (perms.includes('functions')) {
    lines.push(`
# ── 云函数 ───────────────────────────────────────────────────

# 获取云函数列表
curl ${base}/api/functions ${h}

# 调用云函数（FUNC_ID 替换为实际 id）
curl -X POST ${base}/api/functions/FUNC_ID/invoke \\
  ${h} -H "Content-Type: application/json" \\
  -d '{"userId":1,"action":"sendWelcomeEmail"}'`);
  }

  if (perms.includes('realtime')) {
    lines.push(`
# ── 实时数据库 ───────────────────────────────────────────────
# WebSocket 无法用 cURL 测试，请使用 JavaScript/Swift/Kotlin 示例`);
  }

  return lines.join('\n');
}

function genJs(base, key, perms) {
  const lines = [
`// ============================================================
//  接入示例 — JavaScript / TypeScript
//  服务地址: ${base}
// ============================================================
const BASE_URL = '${base}';
const API_KEY  = '${key}';

async function request(path, method = 'GET', body = null) {
  const token = localStorage.getItem('baas_token');
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
}`
  ];

  if (perms.includes('auth')) {
    lines.push(`
// ── 用户认证 ─────────────────────────────────────────────────
async function register(name, email, password) {
  const data = await request('/api/auth/register', 'POST', { name, email, password });
  return data.user; // { id, name, email, role, created_at }
}
async function login(email, password) {
  const data = await request('/api/auth/login', 'POST', { email, password });
  localStorage.setItem('baas_token', data.token);
  return data.user;
}
async function logout() {
  await request('/api/auth/logout', 'POST');
  localStorage.removeItem('baas_token');
}
async function getMe() {
  return (await request('/api/users/me')).user;
}
async function changePassword(currentPassword, newPassword) {
  return request('/api/users/me/password', 'PUT', { currentPassword, newPassword });
}`);
  }

  if (perms.includes('database')) {
    lines.push(`
// ── 数据库 ───────────────────────────────────────────────────
async function getTables() {
  return (await request('/api/database/tables')).tables; // string[]
}
// columns: [{ name, type, nullable }]
// 支持类型: VARCHAR(255) TEXT INTEGER BIGINT BOOLEAN TIMESTAMP NUMERIC JSONB
async function createCollection(tableName, columns) {
  return request('/api/database/tables', 'POST', { name: tableName, columns });
}
async function query(sql) {
  return (await request('/api/database/query', 'POST', { query: sql })).rows;
}
async function getSchema(tableName) {
  return (await request('/api/database/schema/' + tableName)).columns;
}
// 使用示例:
// await createCollection('posts', [
//   { name: 'title',   type: 'VARCHAR(255)', nullable: false },
//   { name: 'content', type: 'TEXT',         nullable: true  },
// ]);
// const posts = await query('SELECT * FROM posts LIMIT 20');`);
  }

  if (perms.includes('storage')) {
    lines.push(`
// ── 文件存储 ─────────────────────────────────────────────────
async function getBuckets() {
  return (await request('/api/storage/buckets')).buckets;
}
async function createBucket(name, description = '') {
  return (await request('/api/storage/buckets', 'POST', { name, description })).bucket;
}
async function getFiles(bucketName) {
  return (await request('/api/storage/buckets/' + bucketName + '/files')).files;
}
// file: 浏览器 File 对象（来自 <input type="file">）
async function uploadFile(bucketName, file) {
  const token = localStorage.getItem('baas_token');
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(BASE_URL + '/api/storage/buckets/' + bucketName + '/upload', {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY, ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
    body: form,
  });
  return res.json();
}
async function deleteFile(bucketName, fileId) {
  return request('/api/storage/buckets/' + bucketName + '/files/' + fileId, 'DELETE');
}
// 使用示例:
// await createBucket('avatars', '用户头像');
// const input = document.querySelector('input[type=file]');
// const result = await uploadFile('avatars', input.files[0]);`);
  }

  if (perms.includes('functions')) {
    lines.push(`
// ── 云函数 ───────────────────────────────────────────────────
async function getFunctions() {
  return (await request('/api/functions')).functions;
}
async function invokeFunction(functionId, payload = {}) {
  return (await request('/api/functions/' + functionId + '/invoke', 'POST', payload)).result;
}
async function createFunction(name, code, triggerType = null) {
  return (await request('/api/functions', 'POST',
    { name, code, language: 'javascript', trigger_type: triggerType })).function;
}`);
  }

  if (perms.includes('realtime')) {
    lines.push(`
// ── 实时数据库（WebSocket）────────────────────────────────────
// 引入: <script src="${base}/socket.io/socket.io.js"></script>
let _socket = null;
function connectRealtime() {
  _socket = io('${base}', {
    auth: { token: localStorage.getItem('baas_token') },
    transports: ['websocket', 'polling'],
  });
  _socket.on('connect', () => console.log('实时连接成功'));
  return _socket;
}
function subscribeCollection(name, { onAdd, onUpdate, onDelete } = {}) {
  if (!_socket) connectRealtime();
  _socket.emit('subscribe', name);
  if (onAdd)    _socket.on('dataAdded',   onAdd);
  if (onUpdate) _socket.on('dataUpdated', onUpdate);
  if (onDelete) _socket.on('dataDeleted', onDelete);
}
function addData(collection, data)            { _socket.emit('addData',    { collection, data }); }
function updateData(collection, id, data)     { _socket.emit('updateData', { collection, id, data }); }
function deleteData(collection, id)           { _socket.emit('deleteData', { collection, id }); }
// 使用示例:
// subscribeCollection('messages', { onAdd: (e) => console.log('新消息:', e.item) });
// addData('messages', { text: 'Hello!', sender: 'user1' });`);
  }

  return lines.join('\n');
}

function genSwift(base, key, perms) {
  const lines = [
`// ============================================================
//  接入示例 — Swift (iOS / macOS)
//  服务地址: ${base}
// ============================================================
import Foundation

let BASE_URL = "${base}"
let API_KEY  = "${key}"

@discardableResult
func baasRequest(_ path: String, method: String = "GET",
                 body: [String: Any]? = nil) async throws -> [String: Any] {
    var req = URLRequest(url: URL(string: BASE_URL + path)!)
    req.httpMethod = method
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue(API_KEY, forHTTPHeaderField: "X-API-Key")
    if let t = UserDefaults.standard.string(forKey: "baas_token") {
        req.setValue("Bearer \\(t)", forHTTPHeaderField: "Authorization")
    }
    if let b = body { req.httpBody = try JSONSerialization.data(withJSONObject: b) }
    let (data, resp) = try await URLSession.shared.data(for: req)
    let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    guard (resp as? HTTPURLResponse)?.statusCode ?? 0 < 400 else {
        throw NSError(domain: "BaaS", code: 0,
            userInfo: [NSLocalizedDescriptionKey: json["error"] as? String ?? "请求失败"])
    }
    return json
}`
  ];

  if (perms.includes('auth')) {
    lines.push(`
// ── 用户认证 ─────────────────────────────────────────────────
func register(name: String, email: String, password: String) async throws -> [String: Any] {
    let res = try await baasRequest("/api/auth/register", method: "POST",
        body: ["name": name, "email": email, "password": password])
    return res["user"] as? [String: Any] ?? [:]
}
func login(email: String, password: String) async throws -> [String: Any] {
    let res = try await baasRequest("/api/auth/login", method: "POST",
        body: ["email": email, "password": password])
    if let t = res["token"] as? String { UserDefaults.standard.set(t, forKey: "baas_token") }
    return res["user"] as? [String: Any] ?? [:]
}
func logout() async throws {
    try await baasRequest("/api/auth/logout", method: "POST")
    UserDefaults.standard.removeObject(forKey: "baas_token")
}
func getMe() async throws -> [String: Any] {
    return (try await baasRequest("/api/users/me"))["user"] as? [String: Any] ?? [:]
}
func changePassword(current: String, new newPwd: String) async throws {
    try await baasRequest("/api/users/me/password", method: "PUT",
        body: ["currentPassword": current, "newPassword": newPwd])
}`);
  }

  if (perms.includes('database')) {
    lines.push(`
// ── 数据库 ───────────────────────────────────────────────────
func getTables() async throws -> [String] {
    return (try await baasRequest("/api/database/tables"))["tables"] as? [String] ?? []
}
// columns: [["name":"title","type":"VARCHAR(255)","nullable":false], ...]
func createCollection(name: String, columns: [[String: Any]]) async throws {
    try await baasRequest("/api/database/tables", method: "POST",
        body: ["name": name, "columns": columns])
}
func query(_ sql: String) async throws -> [[String: Any]] {
    let res = try await baasRequest("/api/database/query", method: "POST", body: ["query": sql])
    return res["rows"] as? [[String: Any]] ?? []
}`);
  }

  if (perms.includes('storage')) {
    lines.push(`
// ── 文件存储 ─────────────────────────────────────────────────
func getBuckets() async throws -> [[String: Any]] {
    return (try await baasRequest("/api/storage/buckets"))["buckets"] as? [[String: Any]] ?? []
}
func createBucket(name: String, description: String = "") async throws {
    try await baasRequest("/api/storage/buckets", method: "POST",
        body: ["name": name, "description": description])
}
func uploadFile(bucket: String, filename: String, data fileData: Data, mime: String) async throws -> [String: Any] {
    var req = URLRequest(url: URL(string: BASE_URL + "/api/storage/buckets/\\(bucket)/upload")!)
    let boundary = UUID().uuidString
    req.httpMethod = "POST"
    req.setValue("multipart/form-data; boundary=\\(boundary)", forHTTPHeaderField: "Content-Type")
    req.setValue(API_KEY, forHTTPHeaderField: "X-API-Key")
    if let t = UserDefaults.standard.string(forKey: "baas_token") {
        req.setValue("Bearer \\(t)", forHTTPHeaderField: "Authorization")
    }
    var body = Data()
    body.append("--\\(boundary)\\r\\n".data(using: .utf8)!)
    body.append("Content-Disposition: form-data; name=\\"file\\"; filename=\\"\\(filename)\\"\\r\\n".data(using: .utf8)!)
    body.append("Content-Type: \\(mime)\\r\\n\\r\\n".data(using: .utf8)!)
    body.append(fileData)
    body.append("\\r\\n--\\(boundary)--\\r\\n".data(using: .utf8)!)
    req.httpBody = body
    let (respData, _) = try await URLSession.shared.data(for: req)
    return (try? JSONSerialization.jsonObject(with: respData) as? [String: Any]) ?? [:]
}
func deleteFile(bucket: String, fileId: Int) async throws {
    try await baasRequest("/api/storage/buckets/\\(bucket)/files/\\(fileId)", method: "DELETE")
}`);
  }

  if (perms.includes('functions')) {
    lines.push(`
// ── 云函数 ───────────────────────────────────────────────────
func invokeFunction(id: String, payload: [String: Any] = [:]) async throws -> Any? {
    return (try await baasRequest("/api/functions/\\(id)/invoke", method: "POST", body: payload))["result"]
}`);
  }

  return lines.join('\n');
}

function genKotlin(base, key, perms) {
  const lines = [
`// ============================================================
//  接入示例 — Kotlin (Android)
//  服务地址: ${base}
//  build.gradle.kts:
//    implementation("com.squareup.okhttp3:okhttp:4.12.0")
//    implementation("org.json:json:20231013")
// ============================================================
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

object BaaS {
    private const val BASE_URL = "${base}"
    private const val API_KEY  = "${key}"
    private val client = OkHttpClient()
    private val JSON   = "application/json".toMediaType()
    // 替换为你的 Context
    private fun prefs() = appContext.getSharedPreferences("baas", 0)

    fun request(path: String, method: String = "GET", body: JSONObject? = null): JSONObject {
        val token = prefs().getString("token", null)
        val reqBody = if (method == "GET") null
                      else (body?.toString() ?: "{}").toRequestBody(JSON)
        val req = Request.Builder()
            .url(BASE_URL + path)
            .addHeader("X-API-Key", API_KEY)
            .apply { token?.let { addHeader("Authorization", "Bearer $it") } }
            .method(method, reqBody)
            .build()
        val resp = client.newCall(req).execute()
        val json = JSONObject(resp.body!!.string())
        if (!resp.isSuccessful) throw Exception(json.optString("error", "请求失败"))
        return json
    }`
  ];

  if (perms.includes('auth')) {
    lines.push(`
    // ── 用户认证 ─────────────────────────────────────────────
    fun register(name: String, email: String, password: String): JSONObject =
        request("/api/auth/register", "POST",
            JSONObject().put("name", name).put("email", email).put("password", password))
            .getJSONObject("user")

    fun login(email: String, password: String): JSONObject {
        val res = request("/api/auth/login", "POST",
            JSONObject().put("email", email).put("password", password))
        res.optString("token").takeIf { it.isNotEmpty() }
            ?.let { prefs().edit().putString("token", it).apply() }
        return res.getJSONObject("user")
    }

    fun logout() {
        runCatching { request("/api/auth/logout", "POST") }
        prefs().edit().remove("token").apply()
    }

    fun getMe(): JSONObject = request("/api/users/me").getJSONObject("user")

    fun changePassword(current: String, newPwd: String) =
        request("/api/users/me/password", "PUT",
            JSONObject().put("currentPassword", current).put("newPassword", newPwd))`);
  }

  if (perms.includes('database')) {
    lines.push(`
    // ── 数据库 ───────────────────────────────────────────────
    fun getTables(): JSONArray = request("/api/database/tables").getJSONArray("tables")

    // columns: JSONArray of { name, type, nullable }
    fun createCollection(name: String, columns: JSONArray) =
        request("/api/database/tables", "POST",
            JSONObject().put("name", name).put("columns", columns))

    fun query(sql: String): JSONArray =
        request("/api/database/query", "POST",
            JSONObject().put("query", sql)).getJSONArray("rows")

    fun getSchema(table: String): JSONArray =
        request("/api/database/schema/$table").getJSONArray("columns")`);
  }

  if (perms.includes('storage')) {
    lines.push(`
    // ── 文件存储 ─────────────────────────────────────────────
    fun getBuckets(): JSONArray = request("/api/storage/buckets").getJSONArray("buckets")

    fun createBucket(name: String, desc: String = "") =
        request("/api/storage/buckets", "POST",
            JSONObject().put("name", name).put("description", desc))

    fun getFiles(bucket: String): JSONArray =
        request("/api/storage/buckets/$bucket/files").getJSONArray("files")

    fun uploadFile(bucket: String, file: File, mime: String = "application/octet-stream"): JSONObject {
        val token = prefs().getString("token", null)
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", file.name, file.asRequestBody(mime.toMediaType()))
            .build()
        val req = Request.Builder()
            .url("$BASE_URL/api/storage/buckets/$bucket/upload")
            .addHeader("X-API-Key", API_KEY)
            .apply { token?.let { addHeader("Authorization", "Bearer $it") } }
            .post(body).build()
        return JSONObject(client.newCall(req).execute().body!!.string())
    }

    fun deleteFile(bucket: String, fileId: Int) =
        request("/api/storage/buckets/$bucket/files/$fileId", "DELETE")`);
  }

  if (perms.includes('functions')) {
    lines.push(`
    // ── 云函数 ───────────────────────────────────────────────
    fun invokeFunction(id: String, payload: JSONObject = JSONObject()) =
        request("/api/functions/$id/invoke", "POST", payload)`);
  }

  lines.push(`}
// 使用示例 (在线程/协程中调用):
// BaaS.login("user@example.com", "password123")
// val rows = BaaS.query("SELECT * FROM posts LIMIT 10")
// BaaS.uploadFile("images", File(filePath), "image/jpeg")`);

  return lines.join('\n');
}

module.exports = router;
