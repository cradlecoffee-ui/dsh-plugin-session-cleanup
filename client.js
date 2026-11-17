/**
 * 会话清理 — Client 半部 v1.3.0。
 *
 * 流程：点会话 → 扫描生成报告 → 阅读 → 输入「我确认停用」→ 改名 + 归档 → 宿主自动收产物。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-cleanup',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useRef } = React;

    const PREFIX = '已停用 ';
    const LS_OPEN = 'session-cleanup:open';
    const VERSION = 'v1.6.1';
    const CONFIRM_WORD = '我确认停用';
    const MAX_EVENTS = 8000;
    const PAGE_SIZE = 200;

    const UI = {
      pill: {
        position: 'fixed', right: '18px', bottom: '18px', zIndex: 2147483000,
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '8px 14px', borderRadius: '999px', cursor: 'pointer',
        font: 'inherit', fontSize: '12px',
        border: '1px solid var(--dsw-alias-accent, #c2410c)',
        background: 'var(--dsw-alias-surface, #1a1a1a)',
        color: 'var(--dsw-alias-text, #eee)',
        boxShadow: '0 6px 24px rgba(0,0,0,.35)'
      },
      card: {
        position: 'fixed', right: '18px', bottom: '64px', zIndex: 2147483000,
        width: '420px', maxHeight: '70vh', display: 'flex', flexDirection: 'column',
        border: '1px solid var(--dsw-alias-border, #444)', borderRadius: '10px',
        background: 'var(--dsw-alias-surface, #141414)',
        color: 'var(--dsw-alias-text, #eee)',
        boxShadow: '0 12px 40px rgba(0,0,0,.5)', overflow: 'hidden'
      },
      head: {
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '10px 12px', borderBottom: '1px solid var(--dsw-alias-border, #333)'
      },
      list: { overflow: 'auto', flex: 1, padding: '4px 6px' },
      row: {
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '7px 9px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
      },
      rowHover: { background: 'var(--dsw-alias-surface-2, rgba(255,255,255,.06))' },
      rowCur: { opacity: 0.5, cursor: 'not-allowed' },
      name: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      date: { fontSize: '11px', opacity: 0.55, whiteSpace: 'nowrap' },
      tag: { fontSize: '10px', padding: '0 5px', borderRadius: '4px', border: '1px solid currentColor', opacity: 0.8 },
      foot: {
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px',
        padding: '8px 12px', borderTop: '1px solid var(--dsw-alias-border, #333)'
      },
      btn: {
        font: 'inherit', fontSize: '12px', padding: '3px 10px', cursor: 'pointer',
        borderRadius: '6px', border: '1px solid var(--dsw-alias-border, #555)',
        background: 'transparent', color: 'inherit'
      },
      btnPrimary: {
        font: 'inherit', fontSize: '12px', padding: '4px 12px', cursor: 'pointer',
        borderRadius: '6px', border: '1px solid var(--dsw-alias-accent, #c2410c)',
        background: 'var(--dsw-alias-accent-soft, rgba(194,65,12,.14))', color: 'inherit'
      },
      btnDanger: {
        font: 'inherit', fontSize: '12px', padding: '5px 14px', cursor: 'pointer',
        borderRadius: '6px', border: '1px solid #b91c1c',
        background: 'rgba(185,28,28,.18)', color: '#fecaca'
      },
      btnOff: {
        font: 'inherit', fontSize: '12px', padding: '5px 14px', cursor: 'not-allowed',
        borderRadius: '6px', border: '1px solid var(--dsw-alias-border, #444)',
        background: 'transparent', color: 'inherit', opacity: 0.4
      },
      note: { padding: '4px 12px', fontSize: '11px', opacity: 0.85, whiteSpace: 'pre-wrap' },
      report: { padding: '10px 12px', overflow: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' },
      section: { display: 'flex', flexDirection: 'column', gap: '4px' },
      label: { fontSize: '11px', opacity: 0.55, letterSpacing: '.03em' },
      kv: { display: 'flex', gap: '8px', fontSize: '12px' },
      kvKey: { width: '64px', opacity: 0.6, flexShrink: 0 },
      purpose: {
        fontSize: '12px', lineHeight: '1.55', whiteSpace: 'pre-wrap',
        maxHeight: '110px', overflow: 'auto',
        border: '1px solid var(--dsw-alias-border, #383838)', borderRadius: '6px', padding: '7px 9px'
      },
      files: {
        fontSize: '11.5px', fontFamily: 'monospace', lineHeight: '1.6',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        maxHeight: '130px', overflow: 'auto',
        border: '1px solid var(--dsw-alias-border, #383838)', borderRadius: '6px', padding: '7px 9px'
      },
      warn: {
        fontSize: '11.5px', color: '#fca5a5', border: '1px solid #7f1d1d',
        background: 'rgba(127,29,29,.18)', borderRadius: '6px', padding: '6px 9px', lineHeight: '1.5'
      },
      input: {
        font: 'inherit', fontSize: '12px', padding: '6px 9px', width: '100%',
        borderRadius: '6px', border: '1px solid var(--dsw-alias-border, #555)',
        background: 'transparent', color: 'inherit', boxSizing: 'border-box'
      },
      muted: { fontSize: '11px', opacity: 0.6 }
    };

    function pad(n) { return String(n).padStart(2, '0'); }

    function todayLabel() {
      const d = new Date();
      return PREFIX + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    }

    function fmtTime(ms) {
      if (!ms) return '—';
      const d = new Date(ms);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function shortId(id) { return String(id || '').replace(/^session-/, '').slice(0, 8); }

    /** 同名时追加 -2、-3 */
    function uniqueTitle(base, taken) {
      if (!taken.has(base)) return base;
      let n = 2;
      while (taken.has(base + '-' + n)) n += 1;
      return base + '-' + n;
    }

    function clip(s, n) {
      const t = String(s || '').replace(/\s+/g, ' ').trim();
      return t.length > n ? t.slice(0, n) + '…' : t;
    }

    function transcriptText(report) {
      const out = [];
      out.push('# ' + report.title);
      out.push('开始 ' + fmtTime(report.createdAt) + ' · 最后活动 ' + fmtTime(report.lastActiveAt));
      out.push('消息 用户' + report.userCount + ' / 助手' + report.assistantCount + ' · 工具' + report.toolTotal + ' 次');
      out.push('');
      for (const e of report.timeline) {
        if (e.kind === 'user') out.push('[' + fmtTime(e.t) + '] 你：' + e.text);
        else out.push('[' + fmtTime(e.t) + '] 文件（' + e.tool + '）：' + e.path);
      }
      return out.join('\n');
    }

    function isRunning(item) {
      const cur = item && item.turnStatus && item.turnStatus.current;
      return !!(cur && cur.running);
    }

    function titleOf(item) {
      if (!item) return null;
      if (typeof item.title === 'string' && item.title) return item.title;
      const v = item.projections && item.projections.values;
      if (v && typeof v === 'object') {
        if (typeof v.title === 'string' && v.title) return v.title;
        const keys = Object.keys(v);
        for (let i = 0; i < keys.length; i++) {
          if (/title/i.test(keys[i]) && typeof v[keys[i]] === 'string' && v[keys[i]]) return v[keys[i]];
        }
      }
      return null;
    }

    function displayName(item) {
      return titleOf(item) || ('会话 ' + shortId(item.sessionId));
    }

    function isRetired(item) {
      const t = titleOf(item);
      return !!t && t.indexOf(PREFIX) === 0;
    }

    function isRecent(item) {
      const t = item && (item.updatedAt || item.createdAt);
      return !!t && (Date.now() - t) < 3 * 60 * 1000;
    }

    /** 从一段参数文本里抽绝对路径 */
    const PATH_JSON = /"file_path"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    const PATH_EXT = /"((?:[A-Za-z]:[\\/]|\/)[^"]{3,240}?\.(?:png|jpe?g|webp|gif|svg|mp4|webm|mov|mp3|wav|aep|aepx|jsx|html?|css|js|mjs|cjs|ts|tsx|json|md|py|ps1|cmd|docx?|xlsx?|pptx?|pdf|zip|txt))"/g;

    function extractPaths(text, into) {
      if (!text) return;
      for (const m of text.matchAll(PATH_JSON)) into.set(m[1].replace(/\\\\/g, '\\'), true);
      for (const m of text.matchAll(PATH_EXT)) into.set(m[1].replace(/\\\\/g, '\\'), true);
    }

    /** 从参数里取第一个文件路径 */
    function firstPathIn(text) {
      if (!text) return null;
      const m1 = PATH_JSON.exec(text);
      PATH_JSON.lastIndex = 0;
      if (m1) return m1[1].replace(/\\\\/g, '\\');
      const m2 = PATH_EXT.exec(text);
      PATH_EXT.lastIndex = 0;
      if (m2) return m2[1].replace(/\\\\/g, '\\');
      return null;
    }

    /** 汇总事件为报告 */
    function buildReport(item, events, truncated) {
      let createdAt = null;
      let firstTime = null;
      let lastTime = null;
      let userCount = 0;
      let assistantCount = 0;
      let turnCount = 0;
      let stepCount = 0;
      const toolByName = Object.create(null);
      let toolTotal = 0;
      const files = new Map();
      const pathStats = new Map();   // 原始路径 → { count, firstT, lastT }
      let purpose = null;
      const userTexts = [];
      const timeline = [];

      for (const ev of events) {
        if (!ev || typeof ev !== 'object') continue;
        const type = ev.type;
        const time = typeof ev.time === 'number' ? ev.time : null;
        if (time) {
          if (firstTime === null || time < firstTime) firstTime = time;
          if (lastTime === null || time > lastTime) lastTime = time;
        }
        if (type === 'session' && typeof ev.createdAt === 'number') createdAt = ev.createdAt;

        if (type === 'user/message') {
          const src = ev.data && ev.data.source;
          const isRealUser = !!src && src.kind === 'user';
          if (!isRealUser) continue;   // runtime-context / skill-catalog / time-context 等注入内容，不算用户消息
          userCount += 1;
          const blocks = ev.data && ev.data.content;
          let text = '';
          if (Array.isArray(blocks)) {
            for (const b of blocks) if (b && b.type === 'text' && typeof b.text === 'string') text += b.text;
          }
          if (text) {
            userTexts.push(text);
            if (!purpose) purpose = text;
            if (timeline.length < 600) timeline.push({ t: time, kind: 'user', text });
          }
        } else if (type === 'assistant/message') {
          assistantCount += 1;
        } else if (type === 'turn/start') {
          turnCount += 1;
        } else if (type === 'step/start') {
          stepCount += 1;
        } else if (type === 'tool/call') {
          toolTotal += 1;
          const d = ev.data || {};
          const name = d.name || (d.call && d.call.name) || d.tool || 'unknown';
          toolByName[name] = (toolByName[name] || 0) + 1;
          const args = d.arguments || (d.call && d.call.arguments) || '';
          const argText = typeof args === 'string' ? args : JSON.stringify(args);
          extractPaths(argText, files);
          // 本次调用涉及的路径（用于统计写入次数）
          const touched = new Map();
          extractPaths(argText, touched);
          for (const p of touched.keys()) {
            const cur = pathStats.get(p) || { count: 0, firstT: null, lastT: null };
            cur.count += 1;
            if (time) {
              if (!cur.firstT) cur.firstT = time;
              cur.lastT = time;
            }
            pathStats.set(p, cur);
          }
          if (/^(write|edit|create|mkdir|apply_patch)$/i.test(name) && timeline.length < 600) {
            const p = firstPathIn(argText);
            if (p) timeline.push({ t: time, kind: 'file', path: p, tool: name });
          }
        }
      }

      // 如果独立 tool/call 事件缺失，用内容块补充
      if (toolTotal === 0) {
        for (const ev of events) {
          if (!ev || ev.type !== 'assistant/message') continue;
          const blocks = ev.data && ev.data.message && ev.data.message.content;
          if (!Array.isArray(blocks)) continue;
          for (const b of blocks) {
            if (b && b.type === 'tool-call') {
              toolTotal += 1;
              const nm = b.name || 'unknown';
              toolByName[nm] = (toolByName[nm] || 0) + 1;
              const args = typeof b.arguments === 'string' ? b.arguments : JSON.stringify(b.arguments || {});
              extractPaths(args, files);
            }
          }
        }
      }

      const topTools = Object.keys(toolByName)
        .map((k) => ({ name: k, count: toolByName[k] }))
        .sort((a, b) => b.count - a.count);

      /* 工作区边界：只有该会话自己工作区内的文件才可能被移动 */
      const cwd = item && typeof item.cwd === 'string' ? item.cwd : '';
      const norm = (p) => String(p).replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '');
      const wsPrefix = cwd ? norm(cwd) : '';

      /** 日志里的路径可能是相对的，按工作区补全 */
      const absOf = (p) => {
        const s = String(p).replace(/\//g, '\\');
        if (/^[A-Za-z]:\\/.test(s) || s.startsWith('\\\\')) return s;
        if (!cwd) return s;
        return cwd.replace(/[\\/]+$/, '') + '\\' + s.replace(/^[\\/]+/, '');
      };

      // 原始路径 → 绝对路径的写入统计
      const statByAbs = new Map();
      for (const [raw, st] of pathStats) {
        const abs = absOf(raw);
        const k = abs.toLowerCase();
        const cur = statByAbs.get(k) || { count: 0, firstT: null, lastT: null };
        cur.count += st.count;
        if (st.firstT && (!cur.firstT || st.firstT < cur.firstT)) cur.firstT = st.firstT;
        if (st.lastT && (!cur.lastT || st.lastT > cur.lastT)) cur.lastT = st.lastT;
        statByAbs.set(k, cur);
      }

      const inside = [];
      const outside = [];
      const seen = new Set();
      for (const f of files.keys()) {
        const abs = absOf(f);
        const key = abs.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const st = statByAbs.get(key) || { count: 1, firstT: null, lastT: null };
        const entry = { path: abs, count: st.count, firstT: st.firstT };
        if (!wsPrefix) { outside.push(entry); continue; }
        const n = norm(abs);
        if (n === wsPrefix || n.startsWith(wsPrefix + '\\')) inside.push(entry);
        else outside.push(entry);
      }
      inside.sort((a, b) => (a.firstT || 0) - (b.firstT || 0));

      /* 时间线：文件改为绝对路径，同一路径只保留首次出现 */
      const seenTl = new Set();
      const timelineOut = [];
      for (const e of timeline) {
        if (e.kind === 'user') { timelineOut.push(e); continue; }
        const abs = absOf(e.path);
        const key = abs.toLowerCase();
        if (seenTl.has(key)) continue;
        seenTl.add(key);
        timelineOut.push({ t: e.t, kind: 'file', path: abs, tool: e.tool });
      }

      return {
        sessionId: item.sessionId,
        title: displayName(item),
        workspace: cwd,
        cwdUnknown: !cwd,
        createdAt: createdAt || firstTime,
        lastActiveAt: lastTime || item.updatedAt || null,
        updatedAt: item.updatedAt || null,
        userCount,
        assistantCount,
        turnCount,
        stepCount,
        toolTotal,
        topTools,
        files: inside,
        filesOutside: outside,
        purpose: purpose || userTexts[0] || null,
        userTexts,
        timeline: timelineOut,
        eventCount: events.length,
        truncated: !!truncated,
        blank: !!item.blank
      };
    }

    function createPanel(ctx) {
      function svc(name) {
        try {
          if (typeof ctx.get === 'function') { const s = ctx.get(name); if (s) return s; }
        } catch (e) { /* ignore */ }
        try { return ctx[name]; } catch (e) { return null; }
      }
      const sessionApi = () => svc('remote.session') || {};
      const archiveApi = () => {
        const w = svc('remote.workspace');
        return (w && typeof w.archiveSession === 'function') ? w.archiveSession.bind(w) : null;
      };

      return function SessionCleanupFloating(props) {
        const currentId = props && props.sessionId ? String(props.sessionId) : null;

        const [open, setOpen] = useState(() => {
          try { return window.localStorage.getItem(LS_OPEN) === '1'; } catch (e) { return false; }
        });
        const [items, setItems] = useState([]);
        const [busy, setBusy] = useState(false);
        const [note, setNote] = useState('');
        const [showRetired, setShowRetired] = useState(false);
        const [report, setReport] = useState(null);      // 当前报告
        const [scanning, setScanning] = useState(null);  // {name, count}
        const [typing, setTyping] = useState('');
        const [logs, setLogs] = useState([]);
        const [showLogs, setShowLogs] = useState(false);
        const [view, setView] = useState('report');   // report | timeline
        const [copied, setCopied] = useState('');

        const addLog = useCallback((msg) => {
          const t = new Date();
          const stamp = pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds());
          setLogs((prev) => {
            const next = prev.concat(stamp + '  ' + msg);
            return next.length > 80 ? next.slice(next.length - 80) : next;
          });
        }, []);

        const toggleOpen = () => setOpen((v) => {
          const next = !v;
          try { window.localStorage.setItem(LS_OPEN, next ? '1' : '0'); } catch (e) { /* ignore */ }
          if (!next) { setReport(null); setTyping(''); }
          return next;
        });

        const load = useCallback(async () => {
          const api = sessionApi();
          if (typeof api.list !== 'function') { setNote('列表接口不可用'); addLog('list 接口不存在'); return; }
          setBusy(true);
          addLog('list() 开始');
          try {
            const res = await api.list({});
            if (res && res.ok) {
              const list = (res.value && res.value.items) || [];
              setItems(Array.isArray(list) ? list : []);
              setNote(list.length ? '' : '本工作区没有会话');
              addLog('list() 返回 ' + list.length + ' 条');
            } else {
              setNote('读取失败');
              addLog('list() 失败 ' + JSON.stringify(res && res.error || {}).slice(0, 200));
            }
          } catch (e) {
            setNote('出错：' + (e && e.message ? e.message : String(e)));
            addLog('list() 异常 ' + (e && e.message ? e.message : String(e)));
          } finally {
            setBusy(false);
          }
        }, [addLog]);

        useEffect(() => { addLog('面板挂载 ' + VERSION + (currentId ? ' · 当前会话 ' + shortId(currentId) : ' · 无 sessionId')); }, []);
        useEffect(() => { if (open) load(); }, [open]);

        const isCurrent = (it) => !!currentId && String(it.sessionId) === currentId;
        const visible = items.filter((it) => showRetired || !isRetired(it));
        const retiredCount = items.length - items.filter((it) => !isRetired(it)).length;
        const retiredTitles = items.filter(isRetired).map(titleOf).filter(Boolean);
        const dupCount = retiredTitles.length - new Set(retiredTitles).size;

        /** 把重名的「已停用」标题重新编号 */
        const fixDupTitles = async () => {
          const api = sessionApi();
          if (typeof api.rename !== 'function') { setNote('无改名接口'); return; }
          const groups = new Map();
          for (const it of items) {
            if (!isRetired(it)) continue;
            const t = titleOf(it);
            if (!t) continue;
            if (!groups.has(t)) groups.set(t, []);
            groups.get(t).push(it);
          }
          const taken = new Set(retiredTitles);
          setBusy(true);
          let fixed = 0;
          const failed = [];
          for (const [base, list] of groups) {
            if (list.length < 2) continue;
            for (let i = 1; i < list.length; i++) {
              let n = 2;
              while (taken.has(base + '-' + n)) n += 1;
              const next = base + '-' + n;
              taken.add(next);
              try {
                const r = await api.rename({ sessionId: list[i].sessionId, title: next });
                if (r && r.ok) fixed += 1;
                else failed.push(shortId(list[i].sessionId));
              } catch (e) { failed.push(shortId(list[i].sessionId)); }
            }
          }
          await load();
          setBusy(false);
          setNote('修复重名：' + fixed + ' 个' + (failed.length ? '，失败 ' + failed.join(',') : ''));
          addLog('修复重名 fixed=' + fixed);
        };

        /** 读取整个会话的日志事件 */
        const pageAll = async (sessionId, onProgress) => {
          const api = sessionApi();
          if (typeof api.page !== 'function') throw new Error('remote.session.page 不存在');
          const collected = [];
          let throughSeq = 2147483647;
          let truncated = false;

          // 三种参数形态，逐个尝试，用第一个成功的
          const variants = [
            { label: 'A(maxMessages)', build: (ts) => ({ address: { kind: 'session', sessionId }, throughSeq: ts, maxMessages: PAGE_SIZE }) },
            { label: 'B(throughSeq)', build: (ts) => ({ address: { kind: 'session', sessionId }, throughSeq: ts }) },
            { label: 'C(address)', build: () => ({ address: { kind: 'session', sessionId } }) }
          ];
          let variant = null;
          let firstRes = null;
          for (const v of variants) {
            addLog('尝试参数形态 ' + v.label);
            const res = await api.page(v.build(throughSeq));
            if (res && res.ok) { variant = v; firstRes = res; addLog('参数形态 ' + v.label + ' 可用'); break; }
            addLog('形态 ' + v.label + ' 失败 ' + JSON.stringify(res && res.error || {}).slice(0, 200));
          }
          if (!variant) throw new Error('所有 page 参数形态都失败，详见诊断');

          let res = firstRes;
          for (let round = 0; round < 60; round++) {
            const recs = (res.value && res.value.records) || [];
            addLog('page#' + (round + 1) + ' 返回 ' + recs.length + ' 条 hasMore=' + !!(res.value && res.value.hasMore));
            for (let i = recs.length - 1; i >= 0; i--) {
              const ev = recs[i] && recs[i].event ? recs[i].event : recs[i];
              collected.unshift(ev);
            }
            if (onProgress) onProgress(collected.length);
            if (collected.length >= MAX_EVENTS) { truncated = true; break; }
            if (!res.value.hasMore || !recs.length) break;
            const seqs = recs.map((r) => (r.event ? r.event.seq : r.seq)).filter((n) => typeof n === 'number');
            if (!seqs.length) break;
            const minSeq = Math.min.apply(null, seqs);
            if (!(minSeq > 0)) break;
            if (minSeq - 1 >= throughSeq) break;
            throughSeq = minSeq - 1;
            res = await api.page(variant.build(throughSeq));
            if (!res || !res.ok) {
              addLog('翻页失败 ' + JSON.stringify(res && res.error || {}).slice(0, 200));
              break;
            }
          }
          addLog('累计事件 ' + collected.length + (truncated ? '（截断）' : ''));
          return { events: collected, truncated };
        };

        /** 打开某会话的报告 */
        const openReport = async (item) => {
          addLog('点击会话 ' + shortId(item.sessionId));
          if (isCurrent(item)) { setNote('这是当前正在使用的会话，不能停用'); addLog('是当前会话，已拦截'); return; }
          setTyping('');
          setNote('');
          setShowLogs(false);
          setView('report');
          setCopied('');
          setScanning({ name: displayName(item), count: 0 });
          addLog('进入扫描视图');
          try {
            const r = await pageAll(item.sessionId, (n) => setScanning({ name: displayName(item), count: n }));
            const rep = buildReport(item, r.events, r.truncated);
            setScanning(null);
            setReport(rep);
            addLog('报告生成：' + rep.eventCount + ' 事件 / ' + rep.files.length + ' 文件');
          } catch (e) {
            setScanning(null);
            setNote('扫描失败：' + (e && e.message ? e.message : String(e)));
            addLog('扫描异常 ' + (e && e.message ? e.message : String(e)));
          }
        };

        /** 确认停用 */
        const doRetire = async () => {
          if (!report) return;
          if (typing.trim() !== CONFIRM_WORD) return;
          const api = sessionApi();
          const archiveFn = archiveApi();
          setBusy(true);
          setNote('');
          addLog('确认停用 ' + shortId(report.sessionId));
          try {
            const taken = new Set(items.map((x) => titleOf(x)).filter(Boolean));
            const title = uniqueTitle(todayLabel(), taken);
            if (typeof api.rename !== 'function') throw new Error('无改名接口');
            addLog('rename 开始');
            const rr = await api.rename({ sessionId: report.sessionId, title });
            if (!rr || !rr.ok) {
              const c = rr && rr.error && (rr.error.code || rr.error.diagnostic);
              addLog('rename 失败 ' + JSON.stringify(rr && rr.error || {}).slice(0, 200));
              throw new Error('改名失败' + (c ? '（' + c + '）' : ''));
            }
            addLog('rename 成功');
            if (!archiveFn) throw new Error('无归档接口');
            addLog('archive 开始');
            const ar = await archiveFn({ sessionId: report.sessionId, stopActivity: true });
            if (!ar || !ar.ok) {
              const c = ar && ar.error && (ar.error.code || ar.error.diagnostic);
              addLog('archive 失败 ' + JSON.stringify(ar && ar.error || {}).slice(0, 200));
              throw new Error('已改名但归档失败' + (c ? '（' + c + '）' : ''));
            }
            addLog('archive 成功');
            setReport(null);
            setTyping('');
            await load();
            setNote('已停用「' + report.title + '」，产物将由宿主自动收进 手动删除\\' + title);
          } catch (e) {
            setNote('停用失败：' + (e && e.message ? e.message : String(e)));
            addLog('停用异常 ' + (e && e.message ? e.message : String(e)));
          } finally {
            setBusy(false);
          }
        };

        const pill = h('button', { type: 'button', style: UI.pill, onClick: toggleOpen },
          h('span', { style: { fontSize: '14px', lineHeight: 1 } }, '⌫'),
          h('span', null, '会话清理 ' + VERSION)
        );

        if (!open) return pill;

        /* ---------- 扫描中 ---------- */
        if (scanning) {
          return h('div', null, pill, h('div', { style: UI.card },
            h('div', { style: UI.head },
              h('span', { style: { flex: 1, fontSize: '12.5px', fontWeight: 600 } }, '正在扫描会话')
            ),
            h('div', { style: UI.report },
              h('div', { style: { fontSize: '12px' } }, scanning.name),
              h('div', { style: UI.muted }, '已读取 ' + scanning.count + ' 条事件…')
            ),
            h('div', { style: UI.foot },
              h('button', { type: 'button', style: UI.btn, onClick: () => { setScanning(null); } }, '取消')
            )
          ));
        }

        /* ---------- 报告视图 ---------- */
        if (report) {
          const canConfirm = typing.trim() === CONFIRM_WORD;
          const toolLine = report.topTools.length
            ? report.topTools.slice(0, 6).map((t) => t.name + '×' + t.count).join(' · ')
            : '无';

          const copyAll = async () => {
            const text = transcriptText(report);
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                setCopied('已复制 ✓');
                addLog('已复制全文 ' + text.length + ' 字符');
                setTimeout(() => setCopied(''), 2500);
              } else {
                throw new Error('无剪贴板接口');
              }
            } catch (e) {
              setCopied('复制失败');
              addLog('复制失败 ' + (e && e.message));
            }
          };

          /* ---------- 全文回顾 ---------- */
          if (view === 'timeline') {
            return h('div', null, pill, h('div', { style: UI.card },
              h('div', { style: UI.head },
                h('span', { style: { flex: 1, fontSize: '12.5px', fontWeight: 600 } }, '全文回顾'),
                h('button', { type: 'button', style: UI.btn, onClick: () => setView('report') }, '返回报告')
              ),
              h('div', { style: Object.assign({}, UI.report, { padding: '10px 12px' }) },
                h('div', { style: UI.muted },
                  report.timeline.length + ' 条记录 · 按时间顺序 · 可全选复制'),
                h('div', { style: Object.assign({}, UI.files, { maxHeight: '48vh', lineHeight: '1.9', fontSize: '12px' }) },
                  report.timeline.length === 0
                    ? '（没有可回顾的内容）'
                    : report.timeline.map((e, i) => (e.kind === 'user'
                        ? '[' + fmtTime(e.t) + '] 你：' + clip(e.text, 220)
                        : '[' + fmtTime(e.t) + '] 文件 ' + e.tool + '：' + e.path)).join('\n\n'))
              ),
              h('div', { style: UI.foot },
                h('button', { type: 'button', style: UI.btnPrimary, onClick: copyAll }, copied || '复制全文'),
                h('button', { type: 'button', style: UI.btn, onClick: () => setView('report') }, '返回'),
                h('span', { style: { flex: 1 } }),
                h('span', { style: { fontSize: '11px', opacity: 0.5 } }, '复制后可粘贴给 AI 做摘要')
              )
            ), note ? h('div', { style: UI.note }, note) : null);
          }

          return h('div', null, pill, h('div', { style: UI.card },
            h('div', { style: UI.head },
              h('span', { style: { flex: 1, fontSize: '12.5px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '会话报告'),
              h('button', { type: 'button', style: UI.btn, onClick: () => { setReport(null); setTyping(''); } }, '返回')
            ),
            h('div', { style: UI.report },
              h('div', { style: { fontSize: '13px', fontWeight: 600, lineHeight: '1.4' } }, report.title),

              h('div', { style: UI.section },
                h('div', { style: UI.kv }, h('span', { style: UI.kvKey }, '开始'), h('span', null, fmtTime(report.createdAt))),
                h('div', { style: UI.kv }, h('span', { style: UI.kvKey }, '最后活动'), h('span', null, fmtTime(report.lastActiveAt))),
                h('div', { style: UI.kv }, h('span', { style: UI.kvKey }, '消息'), h('span', null,
                  '用户 ' + report.userCount + ' 条 / 助手 ' + report.assistantCount + ' 条 / 步骤 ' + report.stepCount)),
                h('div', { style: UI.kv }, h('span', { style: UI.kvKey }, '工具'), h('span', null,
                  report.toolTotal + ' 次 · ' + toolLine)),
                h('div', { style: UI.kv }, h('span', { style: UI.kvKey }, '事件'), h('span', null,
                  report.eventCount + ' 条' + (report.truncated ? '（已截断，统计不完整）' : '')))
              ),

              h('div', { style: UI.section },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                  h('div', { style: Object.assign({}, UI.label, { flex: 1 }) }, '目的'),
                  h('button', { type: 'button', style: UI.btn, onClick: () => setView('timeline') }, '全文回顾')
                ),
                h('div', { style: UI.purpose },
                  report.purpose
                    ? report.purpose
                    : (report.blank ? '（这个会话没有任何对话内容）' : '（没有找到用户消息）'))
              ),

              h('div', { style: UI.section },
                h('div', { style: UI.label }, '工作区内的产物（' + report.files.length + ' 个）'),
                report.files.length
                  ? h('div', { style: UI.files },
                      report.files.map((f) => f.path + '\n     写入 ' + f.count + ' 次' + (f.firstT ? ' · 首次 ' + fmtTime(f.firstT) : '')).join('\n\n'))
                  : h('div', { style: UI.muted }, report.cwdUnknown ? '（无法确定该会话的工作区）' : '（工作区内没有引用过文件）'),
                report.filesOutside.length
                  ? h('div', { style: Object.assign({}, UI.muted, { paddingTop: '3px' }) },
                      '另有 ' + report.filesOutside.length + ' 个引用路径在工作区之外 —— 本插件不会触碰')
                  : null
              ),

              h('div', { style: UI.warn },
                '停用不会删除数据。它会：① 把标题改为「' + todayLabel() + '」 ② 从侧边栏归档 ③ 把上面「工作区内」的文件移动到 手动删除\\' + todayLabel() + '\\。' +
                '工作区以外的文件一律不会被触碰；已不存在的文件会跳过。'),
              report.cwdUnknown
                ? h('div', { style: UI.warn }, '⚠ 无法确定该会话的工作区，产物将不会被移动（只会归档）。')
                : null
            ),
            h('div', { style: { padding: '0 12px 8px' } },
              h('div', { style: Object.assign({}, UI.label, { paddingBottom: '4px' }) }, '输入「' + CONFIRM_WORD + '」以确认'),
              h('input', {
                style: UI.input,
                value: typing,
                placeholder: CONFIRM_WORD,
                onChange: (e) => setTyping(e.target.value),
                disabled: busy
              })
            ),
            h('div', { style: UI.foot },
              canConfirm
                ? h('button', { type: 'button', style: UI.btnDanger, onClick: doRetire, disabled: busy }, busy ? '处理中…' : '确认停用')
                : h('button', { type: 'button', style: UI.btnOff, disabled: true }, '确认停用'),
              h('button', { type: 'button', style: UI.btn, onClick: () => { setReport(null); setTyping(''); }, disabled: busy }, '取消'),
              h('span', { style: { flex: 1 } }),
              h('span', { style: { fontSize: '11px', opacity: 0.5 } }, '输入正确才能继续')
            )
          ),
          note ? h('div', { style: UI.note }, note) : null);
        }

        /* ---------- 列表视图 ---------- */
        const head = h('div', { style: UI.head },
          h('span', { style: { flex: 1, fontSize: '12.5px', fontWeight: 600 } }, '会话清理'),
          h('span', { style: { fontSize: '11px', opacity: 0.6 } },
            busy ? '…' : (visible.length + ' 个' + (retiredCount ? '（已停用 ' + retiredCount + '）' : ''))),
          h('button', { type: 'button', style: UI.btn, onClick: toggleOpen }, '收起')
        );

        const body = showLogs
          ? h('div', { style: UI.list },
              logs.length === 0
                ? h('div', { style: { fontSize: '12px', opacity: 0.6, padding: '10px' } }, '暂无日志')
                : logs.map((line, i) => h('div', {
                    key: i,
                    style: {
                      fontSize: '10.5px', fontFamily: 'monospace', lineHeight: '1.6',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      padding: '1px 6px', opacity: 0.85
                    }
                  }, line))
            )
          : h('div', { style: UI.list },
              visible.length === 0
                ? h('div', { style: { fontSize: '12px', opacity: 0.6, padding: '10px' } }, busy ? '加载中…' : '没有会话')
                : visible.map((it) => {
                    const cur = isCurrent(it);
                    return h('div', {
                      key: it.sessionId,
                      style: Object.assign({}, UI.row, cur ? UI.rowCur : {}),
                      title: cur ? '当前正在使用的会话' : '点击查看报告',
                      onClick: () => { if (!cur) openReport(it); }
                    },
                    h('span', { style: UI.name }, displayName(it)),
                    cur ? h('span', { style: UI.tag }, '当前')
                      : (it.blank ? h('span', { style: UI.tag }, '空会话')
                        : (isRunning(it) ? h('span', { style: UI.tag }, '运行中')
                          : (isRecent(it) ? h('span', { style: UI.tag }, '最近') : null))),
                    h('span', { style: UI.date }, fmtTime(it.updatedAt || it.createdAt))
                    );
                  })
            );

        const foot = h('div', { style: UI.foot },
          h('button', { type: 'button', style: UI.btn, onClick: () => setShowRetired((v) => !v) }, showRetired ? '隐藏已停用' : '显示已停用'),
          dupCount ? h('button', { type: 'button', style: UI.btn, onClick: fixDupTitles, disabled: busy }, '修复重名 ' + dupCount) : null,
          h('button', { type: 'button', style: UI.btn, onClick: load, disabled: busy }, '刷新'),
          h('button', { type: 'button', style: UI.btn, onClick: () => setShowLogs((v) => !v) }, showLogs ? '返回列表' : '诊断'),
          h('span', { style: { flex: 1 } }),
          h('span', { style: { fontSize: '11px', opacity: 0.5 } }, showLogs ? ('日志 ' + logs.length + ' 条') : '点一行查看报告')
        );

        return h('div', null, pill,
          h('div', { style: UI.card }, head, body, note ? h('div', { style: UI.note }, note) : null, foot));
      };
    }

    return {
      inject: ['slots', 'remote.session', 'remote.workspace'],
      /* 供离线测试使用，不影响宿主 */
      __internal: { buildReport, titleOf, displayName, extractPaths },
      apply(ctx) {
        const Panel = createPanel(ctx);
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'session-cleanup',
          order: 20
        }, Panel));
      }
    };
  }
});
