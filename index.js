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
/* 工具输出里未加引号的绝对路径，例如 "Saved to C:\...\x.png" */
const EXT_RAW = /([A-Za-z]:\\[^\s"'<>|*?\r\n]{3,240}?\.(?:png|jpe?g|webp|gif|svg|mp4|webm|mov|mp3|wav|aep|aepx|jsx|html?|css|js|mjs|cjs|ts|tsx|json|md|py|ps1|cmd|docx?|xlsx?|pptx?|pdf|zip|txt))(?=[\s"',;)\]}]|$)/g;

/** 日志里引用过、且落在工作区内的所有路径（不检查是否还存在） */
function referencedPathsOf(session, cwd) {
  const text = decompressFrames(fs.readFileSync(session.file));
  const found = new Set();
  const add = (p) => {
    const abs = path.resolve(p);
    if (insideCwd(abs, cwd)) found.add(abs);
  };
  for (const m of text.matchAll(PATH_RE)) add(m[1].replace(/\\\\/g, '\\'));
  for (const m of text.matchAll(EXT_RE)) add(m[1].replace(/\\\\/g, '\\'));
  for (const m of text.matchAll(EXT_RAW)) add(m[1]);
  return [...found];
}

function artifactsOf(session, cwd) {
  return referencedPathsOf(session, cwd).filter((p) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  });
}

/** 跨盘移动失败时的递归复制 */
/** 跳过原因：日志写英文代码，界面显示中文 */
const SKIP_TEXT = {
  'outside-workspace': '工作区外，拒绝',
  'realpath-outside-workspace': '真实路径在工作区外，拒绝',
  'already-in-trash': '已在手动删除里',
  'missing': '文件不存在',
  'not-found': '文件不存在',
  'not-a-file': '不是普通文件'
};

function fmtSkipList(list) {
  return list.map((s) => s.path + '（' + (SKIP_TEXT[s.reason] || s.reason) + '）').join('\n');
}

function fmtSkipLog(list) {
  return list.map((s) => s.path + ' [' + s.reason + ']').join(' | ');
}

function copyDirSync(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) copyDirSync(src, dst);
    else if (e.isSymbolicLink()) { try { fs.symlinkSync(fs.readlinkSync(src), dst); } catch { /* ignore */ } }
    else fs.copyFileSync(src, dst);
  }
}

function moveInto(paths, cwd, tag, dry) {
  const trashRoot = path.join(cwd, TRASH_DIR);
  const destRoot = path.join(trashRoot, tag || labelDefault());
  const moved = [];
  const skipped = [];
  if (!paths.length) return { moved, skipped, destRoot };

  let dirReady = false;
  for (const raw of paths) {
    const p = path.resolve(String(raw));
    if (!insideCwd(p, cwd)) { skipped.push({ path: p, reason: 'outside-workspace' }); continue; }
    if (insideCwd(p, trashRoot)) { skipped.push({ path: p, reason: 'already-in-trash' }); continue; }

    // 用真实路径再判一次，防止符号链接把文件指到工作区外
    let real;
    try { real = fs.realpathSync(p); } catch { skipped.push({ path: p, reason: 'missing' }); continue; }
    if (!insideCwd(real, cwd)) { skipped.push({ path: p, reason: 'realpath-outside-workspace' }); continue; }

    let st;
    try { st = fs.statSync(real); } catch { skipped.push({ path: p, reason: 'missing' }); continue; }

    // 目录：整体移动
    if (st.isDirectory()) {
      if (dry) { moved.push('(预览) ' + path.join(destRoot, path.basename(real)) + '/'); continue; }
      if (!dirReady) { fs.mkdirSync(destRoot, { recursive: true }); dirReady = true; }
      let dirTarget = path.join(destRoot, path.basename(real));
      let dn = 1;
      while (fs.existsSync(dirTarget)) dirTarget = path.join(destRoot, path.basename(real) + '-' + (++dn));
      try { fs.renameSync(real, dirTarget); }
      catch (e) { copyDirSync(real, dirTarget); fs.rmSync(real, { recursive: true, force: true }); }
      moved.push(dirTarget + '（整个文件夹）');
      continue;
    }

    if (!st.isFile()) { skipped.push({ path: p, reason: 'not-a-file' }); continue; }

    if (dry) { moved.push('(预览) ' + path.join(destRoot, path.basename(real))); continue; }

    let target = path.join(destRoot, path.basename(real));
    if (!dirReady) { fs.mkdirSync(destRoot, { recursive: true }); dirReady = true; }
    let n = 1;
    while (fs.existsSync(target)) {
      const ext = path.extname(real);
      target = path.join(destRoot, path.basename(real, ext) + '-' + (++n) + ext);
    }
    try { fs.renameSync(real, target); }
    catch (e) { fs.copyFileSync(real, target); fs.unlinkSync(real); }
    moved.push(target);
  }
  return { moved, skipped, destRoot };
}

/** 该会话的边界工作区：显式指定 > 会话自己记录的工作区 > 无 */
function boundaryOf(session, explicit) {
  if (explicit && String(explicit).trim()) return path.resolve(String(explicit));
  const c = session && session.header && session.header.cwd;
  return c ? path.resolve(c) : null;
}

const RETIRED_PREFIX = '已停用';

function shortIdOf(id) {
  return String(id || '').replace(/^session-/, '').slice(0, 8);
}

/** 读取会话日志里最后一次标题 */
function lastTitleOf(session) {
  try {
    const text = decompressFrames(fs.readFileSync(session.file));
    let title = null;
    for (const line of text.split('\n')) {
      if (!line || line.indexOf('"session/title"') < 0) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'session/title' && ev.data && typeof ev.data.title === 'string') title = ev.data.title;
      } catch { /* ignore */ }
    }
    return title;
  } catch { return null; }
}

/** 每个会话一个文件夹；同名时追加短 id 区分 */
function folderNameFor(session, titleCounts) {
  const title = lastTitleOf(session);
  const base = (title && title.trim() ? title.trim() : labelDefault()).replace(/[\\/:*?"<>|]/g, '_');
  const dup = titleCounts && titleCounts[title] > 1;
  return dup ? base + '-' + shortIdOf(session.header.id) : base;
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

function scanSession(sessionId, explicitCwd) {
  const s = findSession(sessionId);
  const boundary = boundaryOf(s, explicitCwd);
  if (!boundary) throw new Error('该会话没有记录工作区，拒绝扫描');
  const list = artifactsOf(s, boundary);
  if (!list.length) return '会话 ' + sessionId + ' 里没有找到工作区内仍然存在的产物文件。\n（边界：' + boundary + '）';
  return '会话 ' + sessionId + ' 工作区内相关文件（' + list.length + ' 个）：\n（边界：' + boundary + '）\n' + list.join('\n');
}

function collectSession(sessionId, explicitCwd, tag) {
  const s = findSession(sessionId);
  const boundary = boundaryOf(s, explicitCwd);
  if (!boundary) throw new Error('该会话没有记录工作区，拒绝移动');
  let folder = tag;
  if (!folder) {
    const counts = {};
    for (const o of allSessions()) {
      if (!o.header) continue;
      const t = lastTitleOf(o);
      if (t) counts[t] = (counts[t] || 0) + 1;
    }
    folder = folderNameFor(s, counts);
  }
  const list = artifactsOf(s, boundary);
  const r = moveInto(list, boundary, folder);
  const head = '已移动 ' + r.moved.length + ' 个文件到：' + r.destRoot + '\n（边界：' + boundary + '）';
  const skip = r.skipped.length ? '\n\n跳过：\n' + fmtSkipList(r.skipped) : '';
  return head + (r.moved.length ? '\n\n' + r.moved.join('\n') : '') + skip;
}

/* ---------------- 归档后自动收产物 ---------------- */
function autoCollectAfterArchive(sessionId) {
  try {
    const s = findSession(sessionId);
    // 边界必须来自该会话自己记录的工作区，绝不用全局默认值
    const boundary = boundaryOf(s, null);
    if (!boundary) { logLine('auto idle: no cwd for ' + sessionId); return; }

    // 标题重名时把短 id 加进文件夹名，保证一个会话一个文件夹
    const counts = {};
    for (const other of allSessions()) {
      if (!other.header) continue;
      const t = lastTitleOf(other);
      if (t) counts[t] = (counts[t] || 0) + 1;
    }
    const folder = folderNameFor(s, counts);

    const list = artifactsOf(s, boundary);
    if (!list.length) { logLine('auto idle: no files for ' + sessionId + ' folder=' + folder); return; }
    const r = moveInto(list, boundary, folder);
    logLine('auto moved ' + r.moved.length + '/' + list.length + ' -> ' + folder);
    if (r.skipped.length) logLine('auto skip ' + r.skipped.length + ': ' + fmtSkipLog(r.skipped).slice(0, 500));
  } catch (e) {
    logLine('auto error: ' + sessionId + ': ' + (e && e.message ? e.message : String(e)));
  }
}

/* ---------------- 补收：把已停用会话的残留文件收干净 ---------------- */
function sweepArchived(explicitCwd, dry) {
  const archived = [];
  for (const s of allSessions()) {
    if (!s.header) continue;
    const t = lastTitleOf(s);
    if (t && t.indexOf(RETIRED_PREFIX) === 0) archived.push({ session: s, title: t });
  }
  if (!archived.length) return '没有找到已停用的会话。';

  const counts = {};
  for (const a of archived) counts[a.title] = (counts[a.title] || 0) + 1;
  const folderOf = (a) => {
    const base = a.title.replace(/[\\/:*?"<>|]/g, '_');
    return counts[a.title] > 1 ? base + '-' + shortIdOf(a.session.header.id) : base;
  };

  const lines = [];
  const baseOwner = new Map();   // 文件名小写 → 目标文件夹

  // 1) 把工作区里仍然存在的产物收进各自文件夹
  for (const a of archived) {
    const boundary = boundaryOf(a.session, explicitCwd);
    if (!boundary) { lines.push(a.title + '：无工作区，跳过'); continue; }
    const folder = folderOf(a);
    const refs = referencedPathsOf(a.session, boundary);
    for (const p of refs) {
      const key = path.basename(p).toLowerCase();
      if (!baseOwner.has(key)) baseOwner.set(key, folder);
    }
    const list = refs.filter((p) => {
      try { return fs.statSync(p).isFile(); } catch { return false; }
    });
    const r = moveInto(list, boundary, folder, dry);
    if (r.moved.length) lines.push(folder + '：' + (dry ? '将收 ' : '新收 ') + r.moved.length + ' 个');
  }

  // 2) 整理已经在 手动删除 里的文件（按文件名归到各自会话文件夹）
  const trashRoots = new Set();
  for (const a of archived) {
    const b = boundaryOf(a.session, explicitCwd);
    if (b) trashRoots.add(path.join(b, TRASH_DIR));
  }
  let reorganized = 0;
  for (const trash of trashRoots) {
    if (!fs.existsSync(trash)) continue;
    for (const sub of fs.readdirSync(trash, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const dir = path.join(trash, sub.name);
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!f.isFile()) continue;
        const target = baseOwner.get(f.name.toLowerCase());
        if (!target || target === sub.name) continue;
        if (dry) { reorganized++; continue; }
        const destDir = path.join(trash, target);
        fs.mkdirSync(destDir, { recursive: true });
        let dest = path.join(destDir, f.name);
        let n = 1;
        while (fs.existsSync(dest)) {
          const ext = path.extname(f.name);
          dest = path.join(destDir, path.basename(f.name, ext) + '-' + (++n) + ext);
        }
        try { fs.renameSync(path.join(dir, f.name), dest); reorganized++; } catch { /* ignore */ }
      }
      try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch { /* ignore */ }
    }
  }
  lines.push('整理已有归档：归位 ' + reorganized + ' 个文件');
  logLine('sweep' + (dry ? ' (dry)' : '') + ': collected+reorganized, lines=' + lines.length);
  return lines.join('\n');
}

function run(args) {
  const action = String(args.action || '');
  if (action === 'list') return listSessions(resolveWorkspace(args.cwd));
  if (action === 'scan') {
    if (!args.session_id) throw new Error('scan 需要 session_id');
    return scanSession(String(args.session_id), args.cwd);
  }
  if (action === 'move') return collectSessionFromPaths(args.paths, resolveWorkspace(args.cwd), args.label);
  if (action === 'collect') {
    if (!args.session_id) throw new Error('collect 需要 session_id');
    return collectSession(String(args.session_id), args.cwd, args.label);
  }
  if (action === 'sweep') return sweepArchived(args.cwd, args.dry === true);
  throw new Error('未知 action：' + action);
}

function collectSessionFromPaths(paths, cwd, label) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('没有指定要移动的文件');
  const r = moveInto(paths, cwd, label);
  logLine('move ' + r.moved.length + '/' + paths.length + ' -> ' + r.destRoot + (r.skipped.length ? ' skip=' + r.skipped.length : ''));
  let out = '已移动 ' + r.moved.length + ' 个文件到：' + r.destRoot;
  if (r.moved.length) out += '\n\n' + r.moved.join('\n');
  if (r.skipped.length) out += '\n\n跳过：\n' + fmtSkipList(r.skipped);
  return out;
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'session_cleanup',
    description: 'List this workspace\'s sessions, read one session log to find the files it produced, and move those files into the workspace\'s 手动删除 folder.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'scan', 'move', 'collect', 'sweep'], description: 'list: 列出会话；scan: 扫描产物；move: 移动指定文件；collect: 扫描并移动整个会话的产物；sweep: 把所有已停用会话的残留产物收进各自的文件夹。' },
        session_id: { type: 'string', description: 'scan / collect 时必填：会话 id。' },
        paths: { type: 'array', items: { type: 'string' }, description: 'move 时必填：文件绝对路径列表。' },
        label: { type: 'string', description: '子文件夹名，默认 已停用 YYYYMMDD。' },
        cwd: { type: 'string', description: '可选：目标工作区，默认取 workspace.json 的默认工作区。' },
        dry: { type: 'boolean', description: 'sweep 时可选：只预览不移动。' }
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
