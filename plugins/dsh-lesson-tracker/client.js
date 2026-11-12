/**
 * dsh-lesson-tracker — Client half.
 *
 * 左侧栏一个图标（sidebar.panellist）+ 一个主面板（main, key = lesson-tracker）。
 *
 * 设计目标：
 *  - 信息密度高：一张矩阵看全 8 个班最近几次的进度；
 *  - 结构清晰：当前课程 → 补记 → 各班进度 → 今日课表；
 *  - 操作直接：没有下拉框、没有弹窗、没有二级页面；
 *  - 克制的动效：入场 stagger、行 hover、保存后高亮、颜色变化，
 *    都只在「有意义的状态变化」上发生，不做花哨装饰。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-lesson-tracker',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback, useMemo } = React

    const NS = 'lesson-tracker'
    // 每个班显示最近几次（只列这个班有记录的日期）
    const COLS = 7

    /* ------------------------------------------------------------ 样式 */

    const CSS = `
.lt-page{box-sizing:border-box;height:100%;min-height:0;width:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;
  --tl:var(--dsw-alias-border-l1);--tl2:var(--dsw-alias-border-l2);
  --tc:var(--dsw-alias-bg-layer-1);--tc2:var(--dsw-alias-bg-layer-2);
  --tm:var(--dsw-alias-label-secondary);--tb:var(--dsw-alias-brand-primary);
  --ok:var(--dsw-alias-state-success-primary);--warn:var(--dsw-alias-state-warn-primary);--err:var(--dsw-alias-state-error-primary)}
.lt-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden}
.lt-in{max-width:1180px;margin:0 auto;padding:20px 20px 44px}

/* 入场：只做一次、错开 40ms，避免面板乍现 */
@keyframes lt-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.lt-in-item{animation:lt-in .32s cubic-bezier(.2,.7,.3,1) both}
.lt-d1{animation-delay:.04s}.lt-d2{animation-delay:.08s}.lt-d3{animation-delay:.12s}.lt-d4{animation-delay:.16s}

/* 顶栏 */
.lt-top{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}
.lt-h1{margin:0;font-size:18px;line-height:24px;font-weight:650;letter-spacing:.01em}
.lt-sub{color:var(--tm);font-size:11.5px;line-height:15px;margin-top:1px}
.lt-g{flex:1;min-width:0}
.lt-clock{display:inline-flex;align-items:baseline;gap:5px;border:1px solid var(--tl);background:var(--tc);border-radius:8px;padding:3px 10px;font-variant-numeric:tabular-nums;flex:none}
.lt-clock b{font-size:14px;font-weight:650}
.lt-clock span{font-size:10.5px;color:var(--tm)}

/* 按钮：更细腻的层次 */
.lt-b{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid var(--tl2);background:var(--tc);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:17px;border-radius:8px;padding:5px 11px;cursor:pointer;transition:border-color .15s,background-color .15s,color .15s,box-shadow .15s;white-space:nowrap}
.lt-b:hover{border-color:var(--tm);box-shadow:0 1px 4px rgba(0,0,0,.07)}
.lt-b:disabled{opacity:.4;cursor:default;box-shadow:none}
.lt-b:disabled:hover{border-color:var(--tl2)}
.lt-b.pri{background:var(--tb);border-color:var(--tb);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:600}
.lt-b.pri:hover:enabled{filter:brightness(1.06);border-color:var(--tb);box-shadow:0 2px 8px color-mix(in srgb,var(--tb) 32%,transparent)}
.lt-b.gh{background:transparent;border-color:transparent;color:var(--tm);padding:5px 8px}
.lt-b.gh:hover{background:var(--tc2);color:var(--dsw-alias-label-primary);border-color:transparent;box-shadow:none}
.lt-b.sm{padding:4px 9px;font-size:11.5px;border-radius:7px}
.lt-b:active:enabled{transform:translateY(.5px)}

/* 输入 */
.lt-i{box-sizing:border-box;border:1px solid var(--tl2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:17px;border-radius:8px;padding:5px 9px;outline:none;transition:border-color .15s,box-shadow .15s;min-width:0}
.lt-i:focus{border-color:var(--tb);box-shadow:0 0 0 3px color-mix(in srgb,var(--tb) 13%,transparent)}
.lt-i::placeholder{color:var(--tm)}
.lt-i.n{width:56px;text-align:center;font-variant-numeric:tabular-nums}
.lt-i.fx{flex:1}

/* 当前课程卡片 */
.lt-live{border:1px solid var(--tl);border-radius:14px;background:var(--tc);padding:16px 18px;margin-bottom:12px;position:relative;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.03)}
.lt-live.on{border-color:color-mix(in srgb,var(--tb) 40%,var(--tl));background:linear-gradient(180deg,color-mix(in srgb,var(--tb) 9%,var(--tc)),var(--tc) 75%);box-shadow:0 2px 10px color-mix(in srgb,var(--tb) 12%,transparent)}
.lt-lr{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.lt-pn{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:none;width:54px;height:54px;border-radius:13px;background:color-mix(in srgb,var(--tb) 15%,transparent);color:var(--tb)}
.lt-live.off .lt-pn{background:var(--tc2);color:var(--tm)}
.lt-pn b{font-size:20px;line-height:1;font-weight:700}
.lt-pn span{font-size:9px;font-weight:600;opacity:.8;margin-top:3px;letter-spacing:.08em}
.lt-lm{flex:1;min-width:150px}
.lt-cc{font-size:19px;font-weight:650;line-height:25px;display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
.lt-cc em{font-style:normal;font-size:11.5px;font-weight:500;color:var(--tm)}
.lt-when{color:var(--tm);font-size:11.5px;line-height:18px;margin-top:2px;font-variant-numeric:tabular-nums}
.lt-cd{flex:none;text-align:right;min-width:92px}
.lt-cdn{font-size:22px;font-weight:650;line-height:27px;font-variant-numeric:tabular-nums;transition:color .2s}
.lt-cdn.hot{color:var(--warn)}
.lt-cdn.on{color:var(--ok)}
.lt-cdl{font-size:10.5px;color:var(--tm);line-height:15px}
.lt-bar{position:relative;height:4px;border-radius:999px;background:color-mix(in srgb,var(--tm) 17%,transparent);margin-top:12px;overflow:hidden}
.lt-bar i{position:absolute;inset:0 auto 0 0;border-radius:999px;background:var(--tb);transition:width .7s ease}
.lt-bar i.hot{background:var(--warn)}
.lt-pulse{animation:lt-pulse 1.8s ease-in-out infinite}
@keyframes lt-pulse{0%,100%{opacity:1}50%{opacity:.55}}

/* PPT / 页码行 */
.lt-pp{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;padding-top:11px;border-top:1px dashed var(--tl)}
.lt-dt{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary);transition:background-color .2s}
.lt-dt.on{background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 22%,transparent)}
.lt-ppt{min-width:0;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--tm)}
.lt-r{margin-left:auto;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.lt-lbl{font-size:10.5px;color:var(--tm);white-space:nowrap}

/* 徽标 */
.lt-tag{border-radius:999px;padding:1px 8px;font-size:10.5px;line-height:17px;white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:600;flex:none}
.lt-tag.b{background:color-mix(in srgb,var(--tb) 15%,transparent);color:var(--tb)}
.lt-tag.g{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)}
.lt-tag.w{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
.lt-tag.m{background:var(--tc2);color:var(--tm);font-weight:500}

/* 点选式按钮组 */
.lt-chips{display:flex;gap:6px;flex-wrap:wrap}
.lt-chip{border:1px solid var(--tl2);background:var(--tc);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:17px;border-radius:8px;padding:5px 12px;cursor:pointer;transition:border-color .14s,background-color .14s,color .14s,box-shadow .14s;white-space:nowrap;font-variant-numeric:tabular-nums;min-height:32px;position:relative}
.lt-chip:hover{border-color:var(--tm);box-shadow:0 1px 4px rgba(0,0,0,.07)}
.lt-chip.on{background:var(--tb);border-color:var(--tb);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:600;box-shadow:0 1px 4px color-mix(in srgb,var(--tb) 25%,transparent)}
.lt-chip.t{background:color-mix(in srgb,var(--warn) 10%,transparent);border-color:color-mix(in srgb,var(--warn) 32%,transparent);color:var(--warn)}
.lt-chip:active{transform:translateY(.5px)}

/* 补记 */
.lt-add{border:1px solid var(--tl);border-radius:12px;background:var(--tc);padding:15px 17px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.025)}
.lt-arow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.lt-arow + .lt-arow{margin-top:12px}
.lt-cap{font-size:12px;color:var(--tm);font-weight:650;white-space:nowrap;flex:none;min-width:44px}

/* 区块标题 */
.lt-sec{display:flex;align-items:center;gap:8px;margin:22px 0 10px;font-size:11.5px;font-weight:650;color:var(--tm);letter-spacing:.04em}
.lt-sec:after{content:"";flex:1;height:1px;background:var(--tl)}
.lt-n{background:var(--tc2);border-radius:999px;padding:1px 8px;font-variant-numeric:tabular-nums;font-size:10px;line-height:16px;color:var(--tm);font-weight:600}

/* ── 各班进度：每班一行，行内只列有记录的日期 ── */
.lt-mx{border:1px solid var(--tl);border-radius:12px;background:var(--tc);overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.03)}
.lt-rows{display:flex;flex-direction:column}
.lt-brow{display:flex;align-items:stretch;border-bottom:1px solid var(--tl);transition:background-color .14s}
.lt-brow:last-child{border-bottom:0}
.lt-brow:hover{background:color-mix(in srgb,var(--tb) 5%,transparent)}
.lt-brow.now{background:color-mix(in srgb,var(--tb) 7%,var(--tc))}
.lt-bname{flex:none;width:110px;box-sizing:border-box;padding:10px 12px;background:var(--tc2);border-right:1px solid var(--tl);display:flex;flex-direction:column;justify-content:center;gap:2px}
.lt-bname b{font-size:12.5px;font-weight:650;line-height:17px}
.lt-bname s{text-decoration:none;font-size:10px;color:var(--tm);line-height:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lt-bcells{display:flex;flex:1;min-width:0;overflow-x:auto;scrollbar-width:thin}
.lt-rcell{flex:1 1 0;min-width:90px;max-width:150px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:8px 6px;background:transparent;border:0;border-right:1px solid var(--tl);font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:center;transition:background-color .14s;position:relative}
.lt-rcell:last-child{border-right:0}
.lt-rcell:hover{background:color-mix(in srgb,var(--tb) 9%,transparent)}
.lt-rcell.today{background:color-mix(in srgb,var(--warn) 10%,transparent)}
.lt-rcell .lt-rd{font-size:10.5px;color:var(--tm);font-variant-numeric:tabular-nums;line-height:13px}
.lt-rcell .lt-rp2{font-size:12px;font-weight:700;color:var(--tb);font-variant-numeric:tabular-nums;line-height:16px}
.lt-rcell .lt-rt2{font-size:10.5px;color:var(--tm);line-height:13px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lt-rcell.edit{padding:5px 6px;background:var(--dsw-alias-bg-base);box-shadow:inset 0 0 0 2px var(--tb)}
.lt-rcell.edit input{width:100%;box-sizing:border-box;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;outline:none;text-align:center;padding:2px 0}
@keyframes lt-cellflash{0%{background:color-mix(in srgb,var(--ok) 30%,transparent)}100%{background:transparent}}
.lt-rcell.flash{animation:lt-cellflash 1.1s ease-out}

/* 通用 */
.lt-empty{padding:22px 10px;text-align:center;color:var(--tm);font-size:11.5px;line-height:1.7}
.lt-err{border:1px solid color-mix(in srgb,var(--err) 42%,transparent);background:color-mix(in srgb,var(--err) 9%,transparent);color:var(--err);border-radius:8px;padding:8px 11px;font-size:11px;margin-bottom:10px;line-height:1.5;animation:lt-in .25s ease both}
.lt-ok{border:1px solid color-mix(in srgb,var(--ok) 42%,transparent);background:color-mix(in srgb,var(--ok) 9%,transparent);color:var(--ok);border-radius:8px;padding:8px 11px;font-size:11px;margin-bottom:10px;line-height:1.5;animation:lt-in .25s ease both}
.lt-spin{display:inline-block;width:9px;height:9px;border:2px solid color-mix(in srgb,var(--tm) 35%,transparent);border-top-color:var(--tm);border-radius:50%;animation:lt-spin .8s linear infinite;vertical-align:-1px}
@keyframes lt-spin{to{transform:rotate(360deg)}}
.lt-file{display:none}
`

    /* ---------------------------------------------------------- 工具函数 */

    const apiBase = () => {
      try { return new URL('lesson-tracker/api/', document.baseURI).href } catch { return '/lesson-tracker/api/' }
    }

    async function getState(force) {
      const res = await fetch(apiBase() + 'state' + (force ? '?force=1' : ''), { cache: 'no-store' })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }

    async function postJson(op, body) {
      const res = await fetch(apiBase() + op, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      return res.json()
    }

    async function postFile(file) {
      const res = await fetch(apiBase() + 'import?name=' + encodeURIComponent(file.name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      })
      return res.json()
    }

    const pad2 = (n) => String(n).padStart(2, '0')
    const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

    function hms(sec) {
      const s = Math.max(0, sec | 0)
      const hh = Math.floor(s / 3600)
      const mm = Math.floor((s % 3600) / 60)
      const ss = s % 60
      return hh > 0 ? `${hh}:${pad2(mm)}:${pad2(ss)}` : `${pad2(mm)}:${pad2(ss)}`
    }

    const parts = (dk) => String(dk || '').split('-')
    const md = (dk) => { const p = parts(dk); return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : dk }
    const weekdayOf = (dk) => {
      const p = parts(dk)
      return p.length === 3 ? WEEK[new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay()] : ''
    }

    function todayKey() {
      const d = new Date()
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    }

    function recText(r) {
      if (!r) return ''
      const text = (r.text || r.rawText || '').trim()
      if (text) return text
      const page = r.page != null ? `P${r.page}` : ''
      const topic = r.topic || r.note || ''
      if (!page) return topic
      return topic ? `${page}-${topic}` : page
    }

    function parseText(text) {
      const t = String(text || '').trim()
      if (!t) return { page: null, topic: '' }
      let m = /^P(\d+)\s*[-—－:：]?\s*(.*)$/i.exec(t)
      if (m) return { page: Number(m[1]), topic: (m[2] || '').trim() }
      m = /^(.*?)[-\s—－]\s*P(\d+)$/i.exec(t)
      if (m) return { page: Number(m[2]), topic: m[1].trim() }
      m = /^(.*?)[-\s—－]\s*P(\d+)\s*[-—－]?\s*(.*)$/i.exec(t)
      if (m) return { page: Number(m[2]), topic: [m[1].trim(), m[3].trim()].filter(Boolean).join(' ') }
      return { page: null, topic: t }
    }

    /* -------------------------------------------------------------- 图标 */

    function PanelIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 18
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': true, style: { display: 'block' },
      },
        h('rect', { x: 2.75, y: 3.75, width: 18.5, height: 13.5, rx: 2, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'M7 8.4h6.2M7 11.6h4.1', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('path', { d: 'M14.3 11.2l2.1 4.3 1-2 2.2-.7-5.3-1.6z', fill: 'currentColor', opacity: 0.9 }),
        h('path', { d: 'M8.6 17.25v2.9m6.8-2.9v2.9', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      )
    }

    /* -------------------------------------------------- 当前课程卡片 */

    function LiveCard({ state, page, setPage, onSave, saving, detecting }) {
      const cur = state.current
      const ended = state.justEnded
      const nxt = state.next
      const entry = cur || ended
      const isLive = Boolean(cur)
      const ppt = state.ppt || {}
      const detected = Boolean(ppt.found)

      return h('div', { className: 'lt-live' + (isLive ? ' on' : ' off') },
        h('div', { className: 'lt-lr' },
          h('div', { className: 'lt-pn' },
            h('b', null, entry ? entry.period : '—'),
            h('span', null, entry ? '节' : '无课'),
          ),
          h('div', { className: 'lt-lm' },
            h('div', { className: 'lt-cc' },
              entry ? entry.className : '现在没有课',
              entry ? h('em', null, entry.subject) : null,
              entry && entry.leader ? h('em', null, entry.leader) : null,
            ),
            h('div', { className: 'lt-when' },
              entry ? `${entry.start} – ${entry.end}` + (isLive ? '' : ' · 已下课') : '',
              nxt ? ` · 下节 ${nxt.start} ${nxt.className}` : '',
            ),
          ),
          entry ? h('div', { className: 'lt-cd' },
            h('div', {
              className: 'lt-cdn' + (isLive ? (cur.remainSec <= 300 ? ' hot lt-pulse' : ' on') : ''),
            }, isLive ? hms(cur.remainSec) : '—'),
            h('div', { className: 'lt-cdl' }, isLive ? '距下课' : '已下课'),
          ) : null,
        ),
        isLive ? h('div', { className: 'lt-bar' },
          h('i', { className: cur.remainSec <= 300 ? 'hot' : '', style: { width: cur.elapsedPct + '%' } }),
        ) : null,
        h('div', { className: 'lt-pp' },
          h('span', { className: 'lt-dt' + (detected ? ' on' : '') }),
          h('span', { className: 'lt-ppt', title: ppt.path || '' },
            detected ? (ppt.name || '') : (detecting ? '检测中…' : '未检测到 PPT')),
          detected && ppt.slide ? h('span', { className: 'lt-tag b' }, `${ppt.slide} / ${ppt.total || '?'}`) : null,
          h('div', { className: 'lt-r' },
            h('span', { className: 'lt-lbl' }, '结束页'),
            h('input', {
              className: 'lt-i n',
              type: 'number', min: 1,
              value: page,
              placeholder: '—',
              onChange: (e) => setPage(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') onSave() },
            }),
            detected && ppt.slide
              ? h('button', { className: 'lt-b sm', onClick: () => setPage(String(ppt.slide)) }, '取当前')
              : null,
            h('button', { className: 'lt-b sm pri', disabled: saving, onClick: onSave },
              saving ? '保存…' : '记录'),
          ),
        ),
      )
    }

    /* -------------------------------------------------- 补记（点选式） */

    function AddBar({ state, onCustom }) {
      const today = state.today || []
      const allClasses = (state.classes || []).map((c) => c.name)
      const [cls, setCls] = useState(today.length ? today[0].className : allClasses[0] || '')
      const [period, setPeriod] = useState(today.length ? today[0].period : 0)
      const [page, setPage] = useState('')
      const [topic, setTopic] = useState('')

      useEffect(() => {
        if (!today.length) return
        setCls((cur) => (cur && allClasses.includes(cur) ? cur : today[0].className))
        setPeriod((cur) => (today.some((x) => x.period === cur) ? cur : today[0].period))
      }, [state.date])

      const submit = () => onCustom({ className: cls, period, page, topic })

      return h('div', { className: 'lt-add' },
        h('div', { className: 'lt-arow' },
          h('span', { className: 'lt-cap' }, '班级'),
          h('div', { className: 'lt-chips' },
            allClasses.map((n) => h('button', {
              key: n,
              className: 'lt-chip' + (n === cls ? ' on' : ''),
              onClick: () => setCls(n),
            }, n)),
          ),
        ),
        h('div', { className: 'lt-arow' },
          h('span', { className: 'lt-cap' }, '节次'),
          h('div', { className: 'lt-chips' },
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => h('button', {
              key: n,
              className: 'lt-chip' + (n === period ? ' on' : '') + (today.some((x) => x.period === n) ? ' t' : ''),
              onClick: () => setPeriod(n),
            }, n === 0 ? '不分' : String(n))),
          ),
        ),
        h('div', { className: 'lt-arow' },
          h('span', { className: 'lt-cap' }, '内容'),
          h('input', {
            className: 'lt-i n',
            style: { width: 64, fontSize: 13, padding: '6px 8px' },
            type: 'number', min: 1,
            value: page,
            placeholder: '页',
            onChange: (e) => setPage(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') submit() },
          }),
          h('input', {
            className: 'lt-i fx',
            style: { fontSize: 13, padding: '6px 10px' },
            value: topic,
            placeholder: '课题，如 正等轴测图',
            onChange: (e) => setTopic(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') submit() },
          }),
          h('button', {
            className: 'lt-b pri',
            style: { fontSize: 13, padding: '6px 16px' },
            disabled: !cls, onClick: submit,
          }, '记下'),
        ),
      )
    }

    /* --------------------------- 各班进度：每班只列有记录的日期 */

    function Matrix({ state, onCellSave, flashKey }) {
      const all = state.records || []
      const tk = todayKey()

      const order = (state.classes || []).map((c) => c.name)
      const extra = Array.from(new Set(all.map((r) => r.className))).filter((n) => !order.includes(n))
      const names = [...order, ...extra]
      const todayNames = new Set((state.today || []).map((p) => p.className))

      if (!all.length) {
        return h('div', { className: 'lt-mx' },
          h('div', { className: 'lt-empty' }, '还没有进度数据 · 上方「记下」一条，或导入 Excel'),
        )
      }

      // 同一天同一班取页码最大的那条
      const cellMap = new Map()
      for (const r of all) {
        const k = r.className + '@' + r.date
        const cur = cellMap.get(k)
        if (!cur || (r.page || 0) >= (cur.page || 0)) cellMap.set(k, r)
      }

      // 每个班：只取这个班有记录的日期，最近 COLS 次，按时间升序排列
      const byClass = (name) => {
        const days = Array.from(new Set(all.filter((r) => r.className === name).map((r) => r.date)))
          .sort()
          .reverse()
          .slice(0, COLS)
          .reverse()
        return days.map((dk) => cellMap.get(name + '@' + dk))
      }

      return h('div', { className: 'lt-mx' },
        h('div', { className: 'lt-rows' },
          names.map((name) => {
            const recs = byClass(name)
            if (!recs.length) return null
            const meta = (state.classes || []).find((c) => c.name === name) || {}
            const hasToday = todayNames.has(name)
            return h('div', { key: name, className: 'lt-brow' + (hasToday ? ' now' : '') },
              h('div', { className: 'lt-bname' },
                h('b', null, name),
                h('s', null, meta.leader || '\u00a0'),
              ),
              h('div', { className: 'lt-bcells' },
                recs.map((rec) => h(RowCell, {
                  key: rec.date,
                  state, cls: name, dk: rec.date, rec,
                  isToday: rec.date === tk,
                  flash: flashKey === name + '@' + rec.date,
                  onCellSave,
                })),
              ),
            )
          }),
        ),
      )
    }

    /** 一个班的一次课：日期在上、页码和题目在下，点一下原地编辑。 */
    function RowCell({ state, cls, dk, rec, isToday, flash, onCellSave }) {
      const [editing, setEditing] = useState(false)
      const [value, setValue] = useState('')
      const ref = useRef(null)

      useEffect(() => {
        if (editing && ref.current) { ref.current.focus(); ref.current.select() }
      }, [editing])

      const text = recText(rec)
      const { page, topic } = parseText(text)

      const begin = () => { setValue(text); setEditing(true) }
      const commit = () => {
        setEditing(false)
        if (value.trim() !== text) onCellSave(cls, dk, value)
      }

      if (editing) {
        return h('div', { className: 'lt-rcell edit' },
          h('input', {
            ref, value,
            placeholder: 'P48-题目',
            onChange: (e) => setValue(e.target.value),
            onBlur: commit,
            onKeyDown: (e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            },
          }),
        )
      }

      return h('button', {
        className: 'lt-rcell' + (isToday ? ' today' : '') + (flash ? ' flash' : ''),
        onClick: begin,
        title: dk + ' · ' + text,
      },
        h('span', { className: 'lt-rd' }, md(dk)),
        page != null ? h('span', { className: 'lt-rp2' }, 'P' + page) : null,
        h('span', { className: 'lt-rt2' }, topic || text || '—'),
      )
    }

    /* -------------------------------------------------------------- 面板 */

    function TrackerPanel() {
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [page, setPage] = useState('')
      const [saving, setSaving] = useState(false)
      const [detecting, setDetecting] = useState(true)
      const [busy, setBusy] = useState('')
      const [flashKey, setFlashKey] = useState('')
      const fileRef = useRef(null)
      const pageTouched = useRef(false)
      const timer = useRef(null)

      const load = useCallback(async (force) => {
        try {
          const next = await getState(force)
          setState(next); setError(''); setDetecting(false)
          return next
        } catch (e) {
          setError('连不上服务：' + (e && e.message ? e.message : String(e)))
          setDetecting(false)
          return null
        }
      }, [])

      useEffect(() => {
        let alive = true
        load(false)
        const t = setInterval(() => { if (alive) load(false) }, 3000)
        return () => { alive = false; clearInterval(t) }
      }, [load])

      useEffect(() => {
        if (!state || pageTouched.current) return
        const slide = state.ppt && state.ppt.found && state.ppt.slide
        setPage(slide ? String(slide) : '')
      }, [state])

      useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

      const flash = (msg, bad) => {
        if (bad) { setError(msg); setNotice('') } else { setNotice(msg); setError('') }
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => { setNotice(''); setError('') }, 3000)
      }

      const setPageManual = useCallback((v) => { pageTouched.current = true; setPage(v) }, [])

      const onSave = useCallback(async () => {
        if (!state) return
        const entry = state.current || state.justEnded || (state.today || [])[(state.today || []).length - 1]
        if (!entry) { flash('现在没有课，用「补记」', true); return }
        setSaving(true)
        try {
          await postJson('record', {
            date: state.date, period: entry.period, className: entry.className,
            page: page === '' ? null : Number(page),
            pptName: (state.ppt && state.ppt.name) || '',
            pptPath: (state.ppt && state.ppt.path) || '',
            total: (state.ppt && state.ppt.total) || 0,
            auto: false,
          })
          pageTouched.current = false
          await load(true)
          setFlashKey(entry.className + '@' + state.date)
          setTimeout(() => setFlashKey(''), 1100)
          flash(`已记 ${entry.className}`)
        } catch (e) { flash('失败：' + (e && e.message ? e.message : String(e)), true) }
        finally { setSaving(false) }
      }, [state, page, load])

      const onCustom = useCallback(async ({ className, period, page: p, topic }) => {
        if (!state) return
        try {
          await postJson('custom', {
            date: todayKey(), period: Number(period) || 0, className,
            page: p === '' ? null : Number(p), topic: topic || '', text: '',
          })
          await load(true)
          flash(`已记 ${className}`)
        } catch (e) { flash('失败：' + (e && e.message ? e.message : String(e)), true) }
      }, [state, load])

      const onCellSave = useCallback(async (cls, dk, text) => {
        const { page: p, topic } = parseText(text)
        const existing = (state.records || [])
          .filter((r) => r.className === cls && r.date === dk)
          .sort((a, b) => (a.period || 0) - (b.period || 0))
        const period = existing.length ? existing[0].period : 0
        try {
          if (!text.trim()) {
            for (const r of existing) await postJson('delete', { id: r.id })
          } else {
            await postJson('custom', { date: dk, period, className: cls, page: p, topic, text: text.trim() })
            for (const r of existing.slice(1)) await postJson('delete', { id: r.id })
          }
          await load(true)
          setFlashKey(cls + '@' + dk)
          setTimeout(() => setFlashKey(''), 1100)
        } catch (e) { flash('失败：' + (e && e.message ? e.message : String(e)), true) }
      }, [state, load])

      const onImport = useCallback(async () => {
        if (!state || !state.importPath) return
        setBusy('import')
        try {
          const r = await postJson('import-path', { path: state.importPath })
          if (r && r.ok) { await load(true); flash(`导入 新增${r.created} 更新${r.updated}`) }
          else flash('导入失败：' + ((r && r.error) || '未知'), true)
        } catch (e) { flash('导入失败：' + (e && e.message ? e.message : String(e)), true) }
        finally { setBusy('') }
      }, [state, load])

      const onPickFile = useCallback(async (e) => {
        const f = e.target.files && e.target.files[0]
        if (!f) return
        setBusy('import')
        try {
          const r = await postFile(f)
          if (r && r.ok) { await load(true); flash(`导入 新增${r.created} 更新${r.updated}`) }
          else flash('导入失败：' + ((r && r.error) || '未知'), true)
        } catch (err) { flash('导入失败：' + (err && err.message ? err.message : String(err)), true) }
        finally { setBusy(''); if (fileRef.current) fileRef.current.value = '' }
      }, [load])

      if (!state) {
        return h('div', { className: 'lt-page' },
          h('style', { 'data-plugin': NS }, CSS),
          h('div', { className: 'lt-in' },
            h('div', { className: 'lt-mx' },
              h('div', { className: 'lt-empty' },
                error ? error : h('span', null, h('span', { className: 'lt-spin' }), ' 连接中…'),
              ),
            ),
          ),
        )
      }

      const total = (state.records || []).length
      const classCount = new Set((state.records || []).map((r) => r.className)).size

      return h('div', { className: 'lt-page' },
        h('style', { 'data-plugin': NS }, CSS),
        h('input', { ref: fileRef, type: 'file', accept: '.xlsx', className: 'lt-file', onChange: onPickFile }),
        h('div', { className: 'lt-scroll' },
          h('div', { className: 'lt-in' },

            // 标题
            h('div', { className: 'lt-top lt-in-item' },
              h('div', null,
                h('h1', { className: 'lt-h1' }, '授课进度'),
                h('div', { className: 'lt-sub' }, [state.teacher, state.subject].filter(Boolean).join(' · ') || '请先配置课表'),
              ),
              h('div', { className: 'lt-g' }),
              h('span', { className: 'lt-clock' },
                h('b', null, state.nowText),
                h('span', null, `${state.weekday} ${md(state.date)}`),
              ),
            ),

            error && !notice ? h('div', { className: 'lt-err' }, error) : null,
            notice ? h('div', { className: 'lt-ok' }, notice) : null,

            // 当前课程
            h('div', { className: 'lt-in-item lt-d1' },
              h(LiveCard, { state, page, setPage: setPageManual, onSave, saving, detecting }),
            ),

            // 补记
            h('div', { className: 'lt-in-item lt-d2' },
              h(AddBar, { state, onCustom }),
            ),

            // 各班进度矩阵
            h('div', { className: 'lt-in-item lt-d3' },
              h('div', { className: 'lt-sec' },
                '各班进度',
                h('span', { className: 'lt-n' }, `${classCount} 班 · ${total} 次`),
                h('button', {
                  className: 'lt-b gh sm', onClick: onImport, disabled: busy === 'import' || !state.importPath,
                  style: { marginLeft: 'auto' },
                  title: state.importPath || '',
                }, busy === 'import' ? h('span', { className: 'lt-spin' }) : null, '导入'),
                h('button', { className: 'lt-b gh sm', onClick: () => fileRef.current && fileRef.current.click() }, '选文件'),
                h('a', {
                  className: 'lt-b gh sm', href: apiBase() + 'export', download: 'lesson-tracker.csv',
                  style: { textDecoration: 'none' }, title: '导出 CSV',
                }, '导出'),
                h('button', { className: 'lt-b gh sm', onClick: () => load(true) }, '刷新'),
              ),
              h(Matrix, { state, onCellSave, flashKey }),
            ),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------ 注册 */

    return {
      name: NS,
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: NS, order: 30, label: '授课进度' },
            (props) => h(PanelIcon, props),
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: NS, label: '授课进度' }, () => h(TrackerPanel)),
        )
      },
    }
  },
})
