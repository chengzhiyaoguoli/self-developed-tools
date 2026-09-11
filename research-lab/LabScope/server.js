const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8080);
// 测试/自建网关时可覆盖上游地址
const BASE = process.env.ONENET_BASE || 'https://iot-api.heclouds.com';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'history.jsonl');
const MAX_MEM = 200000;          // 内存中保留的记录上限
const MAX_TAIL = Math.max(64 * 1024, Math.round(Number(process.env.MAX_TAIL_MB || 8) * 1024 * 1024)); // 启动时最多读文件尾部这么多字节
const MAX_BYTES = 20 * 1024 * 1024; // 文件超过该体积则压缩重写
const TIMEOUT = 8000;

// 可选本地配置（已在 .gitignore 中，不会被提交）：labscope.config.json
let fileConfig = {};
try { fileConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'labscope.config.json'), 'utf8')) || {}; } catch (e) {}
const POLL_MS = Math.min(600000, Math.max(1000, Number(process.env.POLL_MS || fileConfig.pollMs || 5000)));
const RETENTION_DAYS = Math.max(1, Number(process.env.RETENTION_DAYS || fileConfig.retentionDays || 7));
let creds = {
  productId: process.env.PRODUCT_ID || fileConfig.productId || '',
  deviceName: process.env.DEVICE_NAME || fileConfig.deviceName || '',
  token: process.env.TOKEN || fileConfig.token || ''
};

let records = [], seen = new Map(), oldestAt = 0, deviceState = 'unknown', deviceAt = 0, lastAt = 0, lastError = '', tick = 0;
const stamp = t => { if (t === null || t === undefined || t === '') return NaN; if (typeof t === 'number' || /^\d+$/.test(t)) { const n = Number(t); return n < 1e12 ? n * 1000 : n; } return Date.parse(t); };
const okCreds = () => !!(creds.productId && creds.deviceName && creds.token);
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const sameOrigin = req => { const o = req.headers.origin; if (!o) return; if (o === 'null') throw new Error('不允许跨站请求（页面来源为 null）'); let host = ''; try { host = new URL(o).host; } catch (e) { throw new Error('不允许跨站请求'); } if (host !== req.headers.host) throw new Error('不允许跨站请求'); };
async function readBody(req) { let b = ''; for await (const c of req) { b += c; if (b.length > 16384) throw new Error('请求过大'); } return b; }

// 采集实例锁：同一份 data/history.jsonl 只允许一个进程写入。
// 重复双击 start.bat 时，端口探测会让第二个实例占到别的端口，若不加锁两个进程会同时写同一份历史（配额翻倍、出现重复时间戳）。
const LOCK_FILE = path.join(DATA_DIR, 'collector.lock');
let OWNER = false;
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; } }
function acquireLock() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(LOCK_FILE)) {
      const pid = Number(String(fs.readFileSync(LOCK_FILE, 'utf8')).trim().split(':')[0]);
      if (pid && pid !== process.pid && pidAlive(pid)) return false;
    }
    fs.writeFileSync(LOCK_FILE, process.pid + ':' + PORT);
    return true;
  } catch (e) { return true; }
}
function updateLockPort() { if (!OWNER) return; try { fs.writeFileSync(LOCK_FILE, process.pid + ':' + PORT); } catch (e) {} }
function releaseLock() { if (!OWNER) return; try { if (String(fs.readFileSync(LOCK_FILE, 'utf8')).trim().split(':')[0] === String(process.pid)) fs.unlinkSync(LOCK_FILE); } catch (e) {} }
process.on('exit', releaseLock);
process.on('SIGINT', () => { releaseLock(); process.exit(0); });
process.on('SIGTERM', () => { releaseLock(); process.exit(0); });

function rebuild() {
  records.sort((a, b) => a.time - b.time);
  seen.clear();
  for (const r of records) seen.set(r.identifier, r.time);
  oldestAt = records.length ? records[0].time : 0;
}
// 只读文件尾部：页面最多要看最近几小时，采集去重也只需要各属性最新时间戳，
// 没必要把整份历史读进内存（历史越攒越大时启动会越来越慢）。
function readTail(maxBytes) {
  const st = fs.statSync(DATA_FILE);
  const start = Math.max(0, Math.floor(st.size - maxBytes)), len = Math.floor(st.size - start);
  if (len <= 0) return { text: '', truncated: false };
  const buf = Buffer.alloc(len), fd = fs.openSync(DATA_FILE, 'r');
  try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
  let text = buf.toString('utf8');
  if (start > 0) { const i = text.indexOf('\n'); text = i >= 0 ? text.slice(i + 1) : ''; } // 丢掉可能被截断的首行
  return { text, truncated: start > 0 };
}
function loadHistory() {
  try {
    if (!fs.existsSync(DATA_FILE)) { console.log('LabScope: 暂无历史（将从现在开始记录到 ' + path.basename(DATA_FILE) + '）'); return; }
    const { text, truncated } = readTail(MAX_TAIL);
    const cut = Date.now() - RETENTION_DAYS * 86400000, seenKey = new Set(), unique = [];
    let dup = 0;
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        if (!(r && r.identifier && Number.isFinite(r.time) && r.time >= cut && Number.isFinite(r.value))) continue;
        const k = r.identifier + '@' + r.time;
        if (seenKey.has(k)) { dup++; continue; }  // 同一标识符同一时间戳只保留一条
        seenKey.add(k); unique.push(r);
      } catch (e) {}
    }
    records = unique.length > MAX_MEM ? unique.slice(-MAX_MEM) : unique;
    rebuild();
    if (!records.length) console.log('LabScope: 暂无最近的历史记录（保留 ' + RETENTION_DAYS + ' 天）');
    else {
      const ck = t => new Date(t).toLocaleString('zh-CN', { hour12: false });
      console.log('LabScope: 历史就绪 ' + records.length + ' 条（' + ck(records[0].time) + ' ~ ' + ck(records[records.length - 1].time) + '，保留 ' + RETENTION_DAYS + ' 天'
        + (truncated ? '；文件较大，仅读入尾部 ' + (MAX_TAIL >= 1048576 ? Math.round(MAX_TAIL / 1048576) + 'MB' : (MAX_TAIL / 1024).toFixed(1) + 'KB') : '')
        + '）——仅供页面打开时补齐窗口，不影响实时采集');
      if (dup) console.log('LabScope: 其中忽略 ' + dup + ' 条重复时间戳');
    }
    if (dup) {
      // 只有完整读入（未被截断）时才重写文件，否则会把更早的历史删掉
      if (OWNER && !truncated) {
        const tmp = DATA_FILE + '.tmp';
        fs.writeFileSync(tmp, unique.map(r => JSON.stringify(r)).join('\n') + '\n');
        fs.renameSync(tmp, DATA_FILE);
        console.log('LabScope: 已重写历史文件，去除重复记录');
      } else {
        console.log('LabScope: 重复记录仅在内存中忽略，未重写文件（文件较大，避免误删更早的历史）');
      }
    }
  } catch (e) { console.log('LabScope: 历史读取失败 ' + e.message); }
}
function persist(batch) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.appendFile(DATA_FILE, batch.map(r => JSON.stringify(r)).join('\n') + '\n', () => {}); } catch (e) {}
}
// 采集实例从内存取（快）；非采集实例缓存文件尾部（避免每次请求都把整份历史读一遍）
let tailCache = { at: 0, records: null };
function tailHistory() {
  const now = Date.now();
  if (tailCache.records && now - tailCache.at < 3000) return tailCache.records;
  const { text } = readTail(MAX_TAIL), out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r && Number.isFinite(r.time)) out.push(r); } catch (e) {}
  }
  out.sort((a, b) => a.time - b.time);
  tailCache = { at: now, records: out };
  return out;
}
// 页面取数：内存能覆盖窗口就用内存（快），否则回退到文件（保留期内的完整数据）
function historyForWindow(from) {
  const mem = OWNER ? records : tailHistory();
  const oldest = OWNER ? (oldestAt || (mem.length ? mem[0].time : 0)) : (mem.length ? mem[0].time : 0);
  if (mem.length && from >= oldest) return mem.filter(r => r.time >= from);
  return fileHistorySince(from);
}
// 从文件尾部往前按块读取，直到覆盖到 from（用于导出完整保留期的历史，不受内存上限影响）
function fileHistorySince(from) {
  let fd = null;
  try {
    const st = fs.statSync(DATA_FILE);
    let pos = st.size; const parts = [];
    fd = fs.openSync(DATA_FILE, 'r');
    while (pos > 0) {
      const len = Math.min(1 << 20, pos); pos -= len;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, pos);
      const chunk = buf.toString('utf8');
      parts.push(chunk);
      // 这一块的第一行若已早于 from，说明读够了（跨块的半行会解析失败，保守地继续多读一块）
      const i = chunk.indexOf('\n');
      if (i >= 0) { try { const r = JSON.parse(chunk.slice(0, i)); if (Number.isFinite(r.time) && r.time < from) break; } catch (e) {} }
    }
    let text = parts.reverse().join('');   // 分块拼接只在最后做一次，避免反复复制大字符串
    if (pos > 0) { const i = text.indexOf('\n'); text = i >= 0 ? text.slice(i + 1) : ''; }  // 丢掉可能被截断的首行
    const out = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try { const r = JSON.parse(line); if (r && Number.isFinite(r.time) && r.time >= from) out.push(r); } catch (e) {}
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  } catch (e) { return []; } finally { if (fd !== null) { try { fs.closeSync(fd); } catch (e) {} } }
}
function compact() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const st = fs.statSync(DATA_FILE);
    if (st.size < MAX_BYTES) return;
    const cut = Date.now() - RETENTION_DAYS * 86400000, lines = fs.readFileSync(DATA_FILE, 'utf8').split('\n'), keep = [];
    for (const line of lines) {
      if (!line) continue;
      try { const r = JSON.parse(line); if (r.time >= cut) keep.push(line); } catch (e) {}
    }
    // 丢掉保留期外的之后若仍超上限，则只保留最新的、能塞进上限的那部分（保证文件体积有界）
    let bytes = 0, start = keep.length;
    for (let i = keep.length - 1; i >= 0; i--) {
      const b = Buffer.byteLength(keep[i]) + 1;
      if (bytes + b > MAX_BYTES) break;
      bytes += b; start = i;
    }
    const out = keep.slice(start);
    fs.writeFileSync(DATA_FILE, out.join('\n') + (out.length ? '\n' : ''));
    console.log('LabScope: 历史压缩完成 ' + out.length + ' 条 / ' + Math.round(bytes / 1024) + 'KB（保留期 ' + RETENTION_DAYS + ' 天，文件上限 ' + Math.round(MAX_BYTES / 1048576) + 'MB）' + (start > 0 ? '，更早的记录因超出体积上限被丢弃' : ''));
  } catch (e) {}
}

// 常驻采集：进程活着就一直查，与浏览器是否打开无关。
async function collect() {
  if (!OWNER) return;                       // 非采集实例不写历史
  if (!okCreds()) { lastError = '未配置凭据'; return; }
  try {
    const url = new URL('/thingmodel/query-device-property', BASE);
    url.searchParams.set('product_id', creds.productId); url.searchParams.set('device_name', creds.deviceName);
    const r = await fetch(url, { headers: { Authorization: creds.token }, signal: AbortSignal.timeout(TIMEOUT) });
    const j = await r.json();
    if (j.code !== 0) throw new Error(j.msg || ('接口错误 ' + j.code));
    const batch = [];
    const now = Date.now();
    for (const item of (Array.isArray(j.data) ? j.data : [])) {
      const id = item && typeof item.identifier === 'string' ? item.identifier.trim() : '';
      if (!id) continue;                       // 平台返回缺少标识符的条目一律丢弃
      const v = Number(item.value);
      if (item.value === '' || item.value === null || !Number.isFinite(v)) continue;
      const t = stamp(item.time);
      if (!Number.isFinite(t)) continue;
      const prior = seen.get(id);
      if (prior !== undefined && t <= prior) continue;
      seen.set(id, t);
      batch.push({ identifier: id, time: t, value: v, received: now });
    }
    if (batch.length) {
      records.push(...batch);
      if (records.length > MAX_MEM) records.splice(0, records.length - MAX_MEM);
      let bmin = Infinity; for (const r of batch) if (r.time < bmin) bmin = r.time;
      if (!oldestAt || bmin < oldestAt) oldestAt = bmin;   // 新记录可能比现有最早的还早，必须一起考虑
      persist(batch);
    }
    lastAt = Date.now(); lastError = '';
  } catch (e) { lastError = e && e.name === 'TimeoutError' ? '查询超时' : ((e && e.message) || String(e)); }
  // 设备在线状态：默认每 30 秒查一次（按采集间隔换算成次数，避免高频占用平台配额）
  if (tick++ % Math.max(1, Math.round(30000 / POLL_MS)) === 0) {
    try {
      const u = new URL('/device/detail', BASE);
      u.searchParams.set('product_id', creds.productId); u.searchParams.set('device_name', creds.deviceName);
      const r = await fetch(u, { headers: { Authorization: creds.token }, signal: AbortSignal.timeout(TIMEOUT) });
      const j = await r.json();
      const s = j && j.code === 0 && j.data ? j.data.status : undefined;
      deviceState = (s === 1 || s === true || s === '1') ? 'online' : (s === 0 || s === false || s === '0') ? 'offline' : 'unknown';
      deviceAt = Date.now();
    } catch (e) { deviceState = 'unknown'; deviceAt = Date.now(); }
  }
}

const proxy = { '/api/properties': '/thingmodel/query-device-property', '/api/device': '/device/detail' };
const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const url = req.url.split('?')[0];
  const q = req.url.includes('?') ? new URL(req.url, 'http://x') : null;
  try {
    // 单次只读查询转发（浏览器直连的等价路径，凭据不落盘、不记日志）
    if (proxy[url] && req.method === 'POST') {
      sameOrigin(req);
      const { productId, deviceName, token } = JSON.parse(await readBody(req));
      if (!productId || !deviceName || !token) throw new Error('请填写产品ID、设备名和Token');
      const u = new URL(proxy[url], BASE);
      u.searchParams.set('product_id', productId); u.searchParams.set('device_name', deviceName);
      const up = await fetch(u, { headers: { Authorization: token }, signal: AbortSignal.timeout(TIMEOUT) });
      const data = await up.json();
      return json(res, up.ok ? 200 : 502, data);
    }
    if (url === '/api/status' && req.method === 'GET') {
      return json(res, 200, { code: 0, data: { owner: OWNER, collecting: OWNER && okCreds(), deviceState: OWNER ? deviceState : 'unknown', deviceAt: OWNER ? deviceAt : 0, lastAt, lastError: OWNER ? lastError : '', records: records.length, pollMs: POLL_MS, retentionDays: RETENTION_DAYS } });
    }
    if (url === '/api/history' && req.method === 'GET') {
      const minutes = Math.min(RETENTION_DAYS * 1440, Math.max(1, Number((q && q.searchParams.get('minutes')) || 5)));
      return json(res, 200, { code: 0, data: historyForWindow(Date.now() - minutes * 60000) });
    }
    // 导出服务端已采集的历史（长表 CSV）。始终从文件读，覆盖完整保留期，不受内存上限影响；分块写出以控制内存。
    if (url === '/api/history.csv' && req.method === 'GET') {
      const minutes = Math.min(RETENTION_DAYS * 1440, Math.max(1, Number((q && q.searchParams.get('minutes')) || 1440)));
      const list = fileHistorySince(Date.now() - minutes * 60000);
      const esc = v => '"' + String(v).replaceAll('"', '""') + '"', iso = t => new Date(t).toISOString();
      const tsSuffix = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="labscope-server-history-' + minutes + 'min-' + tsSuffix + '.csv"' });
      res.write('\ufeff"source","identifier","platform_time","received_time","value"\r\n');
      let buf = [];
      for (const r of list) {
        buf.push(['server', r.identifier, iso(r.time), r.received ? iso(r.received) : '', r.value].map(esc).join(','));
        if (buf.length >= 2000) { res.write(buf.join('\r\n') + '\r\n'); buf = []; }
      }
      if (buf.length) res.write(buf.join('\r\n') + '\r\n');
      return res.end();
    }
    // 让服务端用页面填写的凭据开始常驻采集（仅存内存，重启后需重新提供或写入配置文件）
    if (url === '/api/credentials' && req.method === 'POST') {
      sameOrigin(req);
      const { productId, deviceName, token } = JSON.parse(await readBody(req));
      if (!productId || !deviceName || !token) throw new Error('请填写产品ID、设备名和Token');
      creds = { productId, deviceName, token }; tick = 0; lastError = '';
      collect();
      return json(res, 200, { code: 0, msg: OWNER ? '已开始常驻采集' : '另一个实例正在采集，本进程不重复采集' });
    }
    // 停止后台采集（已保存的历史不受影响）
    if (url === '/api/credentials' && req.method === 'DELETE') {
      sameOrigin(req);
      creds = { productId: '', deviceName: '', token: '' }; lastError = '未配置凭据'; lastAt = 0;
      return json(res, 200, { code: 0, msg: OWNER ? '已停止后台采集' : '本进程未在采集' });
    }
    if (files[url] && req.method === 'GET') {
      const name = files[url];
      res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
      // 必须每次校验：否则浏览器会启发式缓存旧的 app.js/style.css，改了代码却看到旧界面
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      fs.createReadStream(path.join(__dirname, 'public', name)).pipe(res); return;
    }
  } catch (e) { return json(res, 502, { code: -1, msg: e.name === 'TimeoutError' ? 'OneNET请求超时' : e.message }); }
  res.writeHead(404); res.end('Not found');
});

OWNER = acquireLock();
if (!OWNER) console.log('LabScope: 检测到另一个采集实例，本进程只提供页面与查询转发（不采集、不写历史）');
if (OWNER) compact();   // 启动时若历史文件已超体积上限，先压缩一次
loadHistory();
if (OWNER) { setInterval(collect, POLL_MS); setInterval(compact, 86400000); collect(); }
server.listen(PORT, '0.0.0.0', () => {
  updateLockPort();
  console.log(`LabScope: http://localhost:${PORT} (局域网设备可使用本机IP)` + (OWNER ? (okCreds() ? ` · 常驻采集已启用（每 ${POLL_MS}ms）` : ' · 未配置凭据，常驻采集待命') : ' · 已有实例在采集，本进程只读转发'));
});
