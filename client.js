/**
 * 会话清理 — Client 半部 v1.1.0。
 *
 * 悬浮面板：列出会话 → 勾选 → 停用（改名 + 归档）。
 * v1.1.0：
 *   · 用槽位标准属性 sessionId 识别「当前会话」，禁用勾选 + 执行前二次拦截
 *   · 自绘确认视图（不再用 window.confirm 原生弹窗）
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-cleanup',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const PREFIX = '已停用 ';
    const LS_OPEN = 'session-cleanup:open';
    const VERSION = 'v1.2.0';

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
        width: '390px', maxHeight: '64vh', display: 'flex', flexDirection: 'column',
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
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '6px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
      },
      rowOn: { background: 'var(--dsw-alias-surface-2, rgba(255,255,255,.06))' },
      rowCur: { opacity: 0.55, cursor: 'not-allowed' },
      name: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      date: { fontSize: '11px', opacity: 0.6, whiteSpace: 'nowrap' },
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
        font: 'inherit', fontSize: '12px', padding: '3px 10px', cursor: 'pointer',
        borderRadius: '6px', border: '1px solid var(--dsw-alias-accent, #c2410c)',
        background: 'var(--dsw-alias-accent-soft, rgba(194,65,12,.14))', color: 'inherit'
      },
      btnDanger: {
        font: 'inherit', fontSize: '12px', padding: '5px 14px', cursor: 'pointer',
        borderRadius: '6px', border: '1px solid #b91c1c',
        background: 'rgba(185,28,28,.18)', color: '#fecaca'
      },
      note: { padding: '4px 12px', fontSize: '11px', opacity: 0.85, whiteSpace: 'pre-wrap' },
      confirm: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', overflow: 'auto' },
      confirmTitle: { fontSize: '13px', fontWeight: 600 },
      item: {
        border: '1px solid var(--dsw-alias-border, #3a3a3a)', borderRadius: '6px',
        padding: '8px 10px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '3px'
      },
      warn: {
        fontSize: '11.5px', color: '#fca5a5', border: '1px solid #7f1d1d',
        background: 'rgba(127,29,29,.18)', borderRadius: '6px', padding: '6px 9px'
      },
      muted: { fontSize: '11px', opacity: 0.6 }
    };

    function pad(n) { return String(n).padStart(2, '0'); }

    function todayLabel() {
      const d = new Date();
      return PREFIX + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    }

    function fmtDate(ms) {
      if (!ms) return '';
      const d = new Date(ms);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function uniqueTitle(base, taken) {
      if (!taken.has(base)) return base;
      let n = 2;
      while (taken.has(base + '-' + n)) n += 1;
      return base + '-' + n;
    }

    function shortId(id) {
      return String(id || '').replace(/^session-/, '').slice(0, 8);
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
        const [picked, setPicked] = useState({});
        const [busy, setBusy] = useState(false);
        const [note, setNote] = useState('');
        const [showRetired, setShowRetired] = useState(false);
        const [pending, setPending] = useState(null);

        const toggleOpen = () => setOpen((v) => {
          const next = !v;
          try { window.localStorage.setItem(LS_OPEN, next ? '1' : '0'); } catch (e) { /* ignore */ }
          if (!next) setPending(null);
          return next;
        });

        const load = useCallback(async () => {
          const api = sessionApi();
          if (typeof api.list !== 'function') { setNote('列表接口不可用'); return; }
          setBusy(true);
          try {
            const res = await api.list({});
            if (res && res.ok) {
              const list = (res.value && res.value.items) || [];
              setItems(Array.isArray(list) ? list : []);
              setNote(list.length ? '' : '本工作区没有会话');
            } else {
              setNote('读取失败');
            }
          } catch (e) {
            setNote('出错：' + (e && e.message ? e.message : String(e)));
          } finally {
            setBusy(false);
          }
        }, []);

        useEffect(() => { if (open) load(); }, [open]);

        const isCurrent = (it) => !!currentId && String(it.sessionId) === currentId;

        const visible = items.filter((it) => showRetired || !isRetired(it));
        const retiredCount = items.length - items.filter((it) => !isRetired(it)).length;

        const togglePick = (id) => setPicked((prev) => {
          if (currentId && String(id) === currentId) return prev;
          const next = Object.assign({}, prev);
          if (next[id]) delete next[id]; else next[id] = true;
          return next;
        });

        /* 第一步：收集选中项，打开自绘确认视图 */
        const askDisable = () => {
          const chosen = visible.filter((it) => picked[it.sessionId] && !isCurrent(it));
          if (!chosen.length) { setNote('先勾选要停用的会话'); return; }
          setNote('');
          setPending(chosen);
        };

        /* 第二步：确认后执行 */
        const doDisable = async () => {
          const chosen = (pending || []).filter((it) => !isCurrent(it));
          setPending(null);
          if (!chosen.length) { setNote('没有可停用的会话'); return; }

          setBusy(true);
          const api = sessionApi();
          const archiveFn = archiveApi();
          const done = [];
          const failed = [];

          for (const it of chosen) {
            if (isCurrent(it)) { failed.push(displayName(it) + '：当前会话，已拦截'); continue; }
            const taken = new Set(items.map((x) => titleOf(x)).filter(Boolean));
            const title = uniqueTitle(todayLabel(), taken);
            const label = displayName(it);
            try {
              if (typeof api.rename !== 'function') { failed.push(label + '：无改名接口'); continue; }
              const rr = await api.rename({ sessionId: it.sessionId, title });
              if (!rr || !rr.ok) {
                const c = rr && rr.error && (rr.error.code || rr.error.diagnostic);
                failed.push(label + '：改名失败' + (c ? '（' + c + '）' : ''));
                continue;
              }
              if (!archiveFn) { failed.push(label + '：无归档接口'); continue; }
              const ar = await archiveFn({ sessionId: it.sessionId, stopActivity: true });
              if (!ar || !ar.ok) {
                const c = ar && ar.error && (ar.error.code || ar.error.diagnostic);
                failed.push(label + '：归档失败' + (c ? '（' + c + '）' : ''));
                continue;
              }
              done.push(title);
            } catch (e) {
              failed.push(label + '：' + (e && e.message ? e.message : String(e)));
            }
          }

          setPicked({});
          await load();
          setBusy(false);
          setNote('已停用 ' + done.length + ' 个' + (failed.length ? '；失败 ' + failed.length + '：' + failed.join('，') : ''));
        };

        const pill = h('button', { type: 'button', style: UI.pill, onClick: toggleOpen },
          h('span', { style: { fontSize: '14px', lineHeight: 1 } }, '⌫'),
          h('span', null, '会话清理 ' + VERSION)
        );

        if (!open) return pill;

        /* ---------- 确认视图 ---------- */
        if (pending) {
          const recentCount = pending.filter(isRecent).length;
          return h('div', null, pill, h('div', { style: UI.card },
            h('div', { style: UI.head },
              h('span', { style: { flex: 1, fontSize: '12.5px', fontWeight: 600 } }, '确认停用 ' + pending.length + ' 个会话')
            ),
            h('div', { style: UI.confirm },
              pending.map((it) => h('div', { key: it.sessionId, style: UI.item },
                h('div', { style: { fontWeight: 600 } }, displayName(it)),
                h('div', { style: UI.muted }, fmtDate(it.updatedAt || it.createdAt)),
                h('div', { style: UI.muted }, '改名 → ' + todayLabel()),
                h('div', { style: UI.muted }, '产物 → 手动删除\\' + todayLabel() + '\\')
              )),
              recentCount ? h('div', { style: UI.warn },
                '其中 ' + recentCount + ' 个在 3 分钟内活跃过，请注意是否选错。') : null,
              h('div', { style: UI.warn }, '停用后标题变为「' + todayLabel() + '」并从侧边栏移除，不可撤回。')
            ),
            h('div', { style: UI.foot },
              h('button', { type: 'button', style: UI.btnDanger, onClick: doDisable, disabled: busy }, '确认停用'),
              h('button', { type: 'button', style: UI.btn, onClick: () => { setPending(null); }, disabled: busy }, '取消'),
              h('span', { style: { flex: 1 } })
            )
          ));
        }

        /* ---------- 列表视图 ---------- */
        const head = h('div', { style: UI.head },
          h('span', { style: { flex: 1, fontSize: '12.5px', fontWeight: 600 } }, '会话清理'),
          h('span', { style: { fontSize: '11px', opacity: 0.6 } },
            busy ? '…' : (visible.length + ' 个' + (retiredCount ? '（已停用 ' + retiredCount + '）' : ''))),
          h('button', { type: 'button', style: UI.btn, onClick: toggleOpen }, '收起')
        );

        const body = h('div', { style: UI.list },
          visible.length === 0
            ? h('div', { style: { fontSize: '12px', opacity: 0.6, padding: '10px' } }, busy ? '加载中…' : '没有会话')
            : visible.map((it) => {
                const cur = isCurrent(it);
                return h('label', {
                  key: it.sessionId,
                  style: Object.assign({}, UI.row, picked[it.sessionId] ? UI.rowOn : {}, cur ? UI.rowCur : {}),
                  title: cur ? '当前正在使用的会话，不可停用' : (titleOf(it) || '')
                },
                h('input', {
                  type: 'checkbox',
                  checked: cur ? false : !!picked[it.sessionId],
                  disabled: cur,
                  onChange: () => togglePick(it.sessionId)
                }),
                h('span', { style: UI.name }, displayName(it)),
                cur ? h('span', { style: UI.tag }, '当前')
                  : (isRunning(it) ? h('span', { style: UI.tag }, '运行中')
                    : (isRecent(it) ? h('span', { style: UI.tag }, '最近') : null)),
                h('span', { style: UI.date }, fmtDate(it.updatedAt || it.createdAt))
                );
              })
        );

        const foot = h('div', { style: UI.foot },
          h('button', { type: 'button', style: UI.btnPrimary, onClick: askDisable, disabled: busy }, '停用所选'),
          h('button', { type: 'button', style: UI.btn, onClick: () => setShowRetired((v) => !v) }, showRetired ? '隐藏已停用' : '显示已停用'),
          h('button', { type: 'button', style: UI.btn, onClick: load, disabled: busy }, '刷新'),
          h('span', { style: { flex: 1 } }),
          h('span', { style: { fontSize: '11px', opacity: 0.5 } }, '改名「' + todayLabel() + '」并归档')
        );

        return h('div', null, pill,
          h('div', { style: UI.card }, head, body, note ? h('div', { style: UI.note }, note) : null, foot));
      };
    }

    return {
      inject: ['slots', 'remote.session', 'remote.workspace'],
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
