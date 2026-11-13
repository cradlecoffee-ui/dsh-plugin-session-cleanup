/**
 * 会话清理 — Host 半部 v0.2.0。
 *
 * 1) 工具 session_cleanup：list / scan / move / collect
 * 2) 归档事件监听：会话被归档后自动把它的产物移入「手动删除」
 *
 * 不 import 任何 DSH 内部包。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

export const inject = ['tools'];

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const LOGFILE = 'session.v4.jsonl.zstd';
const TRASH_DIR = '手动删除';

/* ---------------- 日志（排查用） ---------------- */
function logLine(msg) {
  try {
    const file = path.join(os.homedir(), '.dsh', 'session-cleanup.log');
    const stamp = new Date().toISOString();
    fs.appendFileSync(file, stamp + ' ' + msg + '\n');
  } catch (e) { /* ignore */ }
}

/* ---------------- 基础 ---------------- */
function sessionsRoot() {
  return path.join(os.homedir(), '.dsh', 'sessions');
}

function resolveWorkspace(explicit) {
  if (explicit && String(explicit).trim()) return path.resolve(String(explicit));
  try {
    const file = path.join(os.homedir(), '.dsh', 'storages', 'workspace.json');
    const store = JSON.parse(fs.readFileSync(file, 'utf8'));
    const id = store && store.global && store.global.defaultWorkspaceId;
    const ws = id && store.tables && store.tables.workspaces && store.tables.workspaces[id];
    if (ws && ws.path) return ws.path;
  } catch (e) { /* ignore */ }
  return process.cwd();
}

function decompressFrames(buf) {
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('当前运行时不支持 zstd 解压');
  }
  const starts = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.compare(MAGIC, 0, 4, i, i + 4) === 0) starts.push(i);
  }
  const chunks = [];
  for (let k = 0; k < starts.length; k++) {
    const slice = buf.subarray(starts[k], k + 1 < starts.length ? starts[k + 1] : buf.length);
    try { chunks.push(zlib.zstdDecompressSync(slice)); } catch { /* 半帧忽略 */ }
  }
  return Buffer.concat(chunks).toString('utf8');
}

function allSessions() {
  const root = sessionsRoot();
  const out = [];
  let groups = [];
  try { groups = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()); }
  catch { return out; }

  for (const g of groups) {
    const groupDir = path.join(root, g.name);
    let entries = [];
    try {
      entries = fs.readdirSync(groupDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith('session-'));
    } catch { continue; }

    for (const e of entries) {
      const dir = path.join(groupDir, e.name);
      const file = path.join(dir, LOGFILE);
      let bytes = 0;
      try { bytes = fs.statSync(file).size; } catch { continue; }
      let header = null;
      try {
        const buf = fs.readFileSync(file);
        const head = decompressFrames(buf.subarray(0, Math.min(buf.length, 64 * 1024)));
        header = JSON.parse(head.split('\n')[0]);
      } catch { header = null; }
      out.push({ dir, file, header, bytes });
    }
  }
  return out;
}

function samePath(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function insideCwd(target, cwd) {
  const t = path.resolve(target).toLowerCase();
  const c = path.resolve(cwd).toLowerCase();
  const prefix = c.endsWith(path.sep) ? c : c + path.sep;
  return t === c || t.startsWith(prefix);
}

function fmtBytes(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

function labelDefault() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return '已停用 ' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}

/* ---------------- 产物提取 ---------------- */
const PATH_RE = /"file_path"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
const EXT_RE = /"((?:[A-Za-z]:[\\/]|\/)[^"]{3,240}?\.(?:png|jpe?g|webp|gif|svg|mp4|webm|mov|mp3|wav|aep|aepx|jsx|html?|css|js|mjs|cjs|ts|tsx|json|md|py|ps1|cmd|docx?|xlsx?|pptx?|pdf|zip|txt))"/g;

function artifactsOf(session, cwd) {
  const text = decompressFrames(fs.readFileSync(session.file));
  const found = new Set();
  const add = (p) => {
    const abs = path.resolve(p);
    if (insideCwd(abs, cwd)) found.add(abs);
  };
  for (const m of text.matchAll(PATH_RE)) add(m[1].replace(/\\\\/g, '\\'));
  for (const m of text.matchAll(EXT_RE)) add(m[1].replace(/\\\\/g, '\\'));
  return [...found].filter((p) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  });
}

function moveInto(paths, cwd, tag) {
  const trashRoot = path.join(cwd, TRASH_DIR);
  const destRoot = path.join(trashRoot, tag || labelDefault());
  const moved = [];
  const skipped = [];
  if (!paths.length) return { moved, skipped, destRoot };

  fs.mkdirSync(destRoot, { recursive: true });
  for (const raw of paths) {
    const p = path.resolve(String(raw));
    if (!insideCwd(p, cwd)) { skipped.push(p + '（工作区外）'); continue; }
    if (insideCwd(p, trashRoot)) { skipped.push(p + '（已在手动删除里）'); continue; }
    let st;
    try { st = fs.statSync(p); } catch { skipped.push(p + '（不存在）'); continue; }
    if (!st.isFile()) { skipped.push(p + '（非文件）'); continue; }

    let target = path.join(destRoot, path.basename(p));
    let n = 1;
    while (fs.existsSync(target)) {
      const ext = path.extname(p);
      target = path.join(destRoot, path.basename(p, ext) + '-' + (++n) + ext);
    }
    try { fs.renameSync(p, target); }
    catch (e) { fs.copyFileSync(p, target); fs.unlinkSync(p); }
    moved.push(target);
  }
  return { moved, skipped, destRoot };
}

/* ---------------- 工具动作 ---------------- */
function listSessions(cwd) {
  const rows = allSessions()
    .filter((s) => s.header && samePath(s.header.cwd || '', cwd))
    .sort((a, b) => (b.header.createdAt || 0) - (a.header.createdAt || 0));
  if (!rows.length) return '当前工作区没有找到会话记录。';
  const lines = rows.map((s, i) => {
    const d = s.header.createdAt ? new Date(s.header.createdAt) : null;
    const when = d ? d.toISOString().slice(0, 16).replace('T', ' ') : '?';
    return (i + 1) + '. ' + s.header.id + '  ' + when + '  ' + fmtBytes(s.bytes);
  });
  return '当前工作区共 ' + rows.length + ' 个会话：\n' + lines.join('\n');
}

function findSession(sessionId) {
  const hit = allSessions().find((s) => s.header && s.header.id === sessionId);
  if (!hit) throw new Error('找不到会话 ' + sessionId);
  return hit;
}

function scanSession(sessionId, cwd) {
  const s = findSession(sessionId);
  const list = artifactsOf(s, cwd);
  if (!list.length) return '会话 ' + sessionId + ' 里没有找到仍然存在的产物文件。';
  return '会话 ' + sessionId + ' 相关文件（' + list.length + ' 个）：\n' + list.join('\n');
}

function collectSession(sessionId, cwd, tag) {
  const s = findSession(sessionId);
  const list = artifactsOf(s, cwd);
  const r = moveInto(list, cwd, tag);
  const head = '已移动 ' + r.moved.length + ' 个文件到：' + r.destRoot;
  const skip = r.skipped.length ? '\n\n跳过：\n' + r.skipped.join('\n') : '';
  return head + (r.moved.length ? '\n\n' + r.moved.join('\n') : '') + skip;
}

/* ---------------- 归档后自动收产物 ---------------- */
function autoCollectAfterArchive(sessionId) {
  try {
    const cwd = resolveWorkspace(null);
    const s = findSession(sessionId);
    const list = artifactsOf(s, cwd);
    if (!list.length) { logLine('auto 0 files ' + sessionId); return; }
    const r = moveInto(list, cwd, labelDefault());
    logLine('auto moved ' + r.moved.length + '/' + list.length + ' ' + sessionId + ' → ' + r.destRoot);
  } catch (e) {
    logLine('auto failed ' + sessionId + ': ' + (e && e.message ? e.message : String(e)));
  }
}

function run(args) {
  const cwd = resolveWorkspace(args.cwd);
  const action = String(args.action || '');
  if (action === 'list') return listSessions(cwd);
  if (action === 'scan') {
    if (!args.session_id) throw new Error('scan 需要 session_id');
    return scanSession(String(args.session_id), cwd);
  }
  if (action === 'move') return collectSessionFromPaths(args.paths, cwd, args.label);
  if (action === 'collect') {
    if (!args.session_id) throw new Error('collect 需要 session_id');
    return collectSession(String(args.session_id), cwd, args.label);
  }
  throw new Error('未知 action：' + action);
}

function collectSessionFromPaths(paths, cwd, label) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('没有指定要移动的文件');
  const r = moveInto(paths, cwd, label);
  let out = '已移动 ' + r.moved.length + ' 个文件到：' + r.destRoot;
  if (r.moved.length) out += '\n\n' + r.moved.join('\n');
  if (r.skipped.length) out += '\n\n跳过：\n' + r.skipped.join('\n');
  return out;
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'session_cleanup',
    description: 'List this workspace\'s sessions, read one session log to find the files it produced, and move those files into the workspace\'s 手动删除 folder.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'scan', 'move', 'collect'], description: 'list: 列出会话；scan: 扫描产物；move: 移动指定文件；collect: 扫描并移动整个会话的产物。' },
        session_id: { type: 'string', description: 'scan / collect 时必填：会话 id。' },
        paths: { type: 'array', items: { type: 'string' }, description: 'move 时必填：文件绝对路径列表。' },
        label: { type: 'string', description: '子文件夹名，默认 已停用 YYYYMMDD。' },
        cwd: { type: 'string', description: '可选：目标工作区，默认取 workspace.json 的默认工作区。' }
      },
      required: ['action']
    },
    output: {
      schema: { type: 'string' },
      render: (args, value) => [{ type: 'text', text: String(value) }]
    },
    execute: async (args) => run(args)
  });

  /* 归档完成后自动收产物 */
  try {
    ctx.on('workspace/session-archived', (payload) => {
      const id = payload && (payload.sessionId || payload.id);
      logLine('event workspace/session-archived ' + JSON.stringify(payload).slice(0, 200));
      if (!id) return;
      setImmediate(() => autoCollectAfterArchive(String(id)));
    });
    logLine('listener registered');
  } catch (e) {
    logLine('listener failed: ' + (e && e.message));
  }
}
