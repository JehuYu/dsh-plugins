/**
 * dsh-wb-signin — Client half.
 *
 * 左侧栏一个图标（sidebar.panellist）+ 一个主面板（main, key = wb-signin）。
 *
 * 面板只回答三个问题：
 *   1. 今天签到了吗？（每账号一行：状态 / 连签 / 积分 / 等级 / 剩余任务）
 *   2. 下一次自动签到什么时候？（两个 Windows 计划任务）
 *   3. 想现在就签怎么办？（一个按钮，跑 run-signin.cmd 并等新批次落盘）
 *
 * 样式沿用授课进度插件的设计语言：DSH 的 CSS 变量 + 克制的层次与动效。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-wb-signin',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const NS = 'wb-signin'

    /* ------------------------------------------------------------ 样式 */

    const CSS = `
.ws-page{box-sizing:border-box;height:100%;min-height:0;width:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;
  --tl:var(--dsw-alias-border-l1);--tl2:var(--dsw-alias-border-l2);
  --tc:var(--dsw-alias-bg-layer-1);--tc2:var(--dsw-alias-bg-layer-2);
  --tm:var(--dsw-alias-label-secondary);--tb:var(--dsw-alias-brand-primary);
  --ok:var(--dsw-alias-state-success-primary);--warn:var(--dsw-alias-state-warn-primary);--err:var(--dsw-alias-state-error-primary)}
.ws-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden}
.ws-in{max-width:940px;margin:0 auto;padding:20px 20px 44px}

@keyframes ws-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.ws-in-item{animation:ws-in .32s cubic-bezier(.2,.7,.3,1) both}
.ws-d1{animation-delay:.04s}.ws-d2{animation-delay:.08s}.ws-d3{animation-delay:.12s}.ws-d4{animation-delay:.16s}

/* 顶栏 */
.ws-top{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}
.ws-h1{margin:0;font-size:18px;line-height:24px;font-weight:650;letter-spacing:.01em}
.ws-sub{color:var(--tm);font-size:11.5px;line-height:15px;margin-top:1px}
.ws-g{flex:1;min-width:0}
.ws-clock{display:inline-flex;align-items:baseline;gap:5px;border:1px solid var(--tl);background:var(--tc);border-radius:8px;padding:3px 10px;font-variant-numeric:tabular-nums;flex:none}
.ws-clock b{font-size:14px;font-weight:650}
.ws-clock span{font-size:10.5px;color:var(--tm)}

/* 按钮 */
.ws-b{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid var(--tl2);background:var(--tc);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:17px;border-radius:8px;padding:5px 11px;cursor:pointer;transition:border-color .15s,background-color .15s,color .15s,box-shadow .15s;white-space:nowrap}
.ws-b:hover{border-color:var(--tm);box-shadow:0 1px 4px rgba(0,0,0,.07)}
.ws-b:disabled{opacity:.45;cursor:default;box-shadow:none}
.ws-b:disabled:hover{border-color:var(--tl2)}
.ws-b.pri{background:var(--tb);border-color:var(--tb);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:600}
.ws-b.pri:hover:enabled{filter:brightness(1.06);border-color:var(--tb);box-shadow:0 2px 8px color-mix(in srgb,var(--tb) 32%,transparent)}
.ws-b.gh{background:transparent;border-color:transparent;color:var(--tm);padding:5px 8px}
.ws-b.gh:hover{background:var(--tc2);color:var(--dsw-alias-label-primary);border-color:transparent;box-shadow:none}
.ws-b.sm{padding:4px 9px;font-size:11.5px;border-radius:7px}
.ws-b:active:enabled{transform:translateY(.5px)}

/* 今日总览条 */
.ws-hero{border:1px solid var(--tl);border-radius:14px;background:var(--tc);padding:16px 18px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.03)}
.ws-hero.on{border-color:color-mix(in srgb,var(--ok) 40%,var(--tl));background:linear-gradient(180deg,color-mix(in srgb,var(--ok) 9%,var(--tc)),var(--tc) 75%)}
.ws-hero.off{border-color:color-mix(in srgb,var(--warn) 40%,var(--tl));background:linear-gradient(180deg,color-mix(in srgb,var(--warn) 9%,var(--tc)),var(--tc) 75%)}
.ws-hr{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.ws-dot{flex:none;width:11px;height:11px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.ws-dot.on{background:var(--ok);box-shadow:0 0 0 4px color-mix(in srgb,var(--ok) 20%,transparent)}
.ws-dot.off{background:var(--warn);box-shadow:0 0 0 4px color-mix(in srgb,var(--warn) 20%,transparent)}
.ws-hm{flex:1;min-width:180px}
.ws-hl{font-size:16px;font-weight:650;line-height:22px}
.ws-hd{color:var(--tm);font-size:11.5px;line-height:17px;margin-top:2px}
.ws-credit{flex:none;text-align:right;min-width:110px}
.ws-credit b{font-size:22px;font-weight:650;line-height:27px;font-variant-numeric:tabular-nums;display:block}
.ws-credit span{font-size:10.5px;color:var(--tm);line-height:15px}

/* 账号卡 */
.ws-acc{border:1px solid var(--tl);border-radius:12px;background:var(--tc);padding:14px 16px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.025)}
.ws-ar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ws-an{font-size:13.5px;font-weight:650;line-height:18px;font-variant-numeric:tabular-nums}
.ws-r{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ws-tag{border-radius:999px;padding:1px 8px;font-size:10.5px;line-height:17px;white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:600;flex:none}
.ws-tag.b{background:color-mix(in srgb,var(--tb) 15%,transparent);color:var(--tb)}
.ws-tag.g{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)}
.ws-tag.w{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
.ws-tag.m{background:var(--tc2);color:var(--tm);font-weight:500}
.ws-facts{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.ws-fact{flex:1 1 120px;min-width:0;border:1px solid var(--tl);border-radius:9px;background:var(--tc2);padding:7px 10px}
.ws-fact s{text-decoration:none;display:block;font-size:10px;color:var(--tm);line-height:14px;letter-spacing:.02em}
.ws-fact b{display:block;font-size:14px;font-weight:650;line-height:20px;font-variant-numeric:tabular-nums;margin-top:1px}
.ws-left{margin-top:8px;font-size:11px;color:var(--tm);line-height:16px}
.ws-left em{font-style:normal;color:var(--warn)}

/* 计划任务 */
.ws-tasks{border:1px solid var(--tl);border-radius:12px;background:var(--tc);overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.03)}
.ws-trow{display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid var(--tl);flex-wrap:wrap}
.ws-trow:last-child{border-bottom:0}
.ws-tname{font-size:12px;font-weight:650;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap}
.ws-tdesc{font-size:10.5px;color:var(--tm);line-height:14px;margin-top:1px}
.ws-tnext{margin-left:auto;text-align:right;font-variant-numeric:tabular-nums;flex:none}
.ws-tnext b{display:block;font-size:13px;font-weight:650;line-height:18px}
.ws-tnext span{font-size:10px;color:var(--tm);line-height:14px}

/* 区块标题 */
.ws-sec{display:flex;align-items:center;gap:8px;margin:20px 0 10px;font-size:11.5px;font-weight:650;color:var(--tm);letter-spacing:.04em}
.ws-sec:after{content:"";flex:1;height:1px;background:var(--tl)}

/* 通用 */
.ws-empty{padding:22px 10px;text-align:center;color:var(--tm);font-size:11.5px;line-height:1.7}
.ws-err{border:1px solid color-mix(in srgb,var(--err) 42%,transparent);background:color-mix(in srgb,var(--err) 9%,transparent);color:var(--err);border-radius:8px;padding:8px 11px;font-size:11px;margin-bottom:10px;line-height:1.5;animation:ws-in .25s ease both}
.ws-ok{border:1px solid color-mix(in srgb,var(--ok) 42%,transparent);background:color-mix(in srgb,var(--ok) 9%,transparent);color:var(--ok);border-radius:8px;padding:8px 11px;font-size:11px;margin-bottom:10px;line-height:1.5;animation:ws-in .25s ease both}
.ws-spin{display:inline-block;width:9px;height:9px;border:2px solid color-mix(in srgb,var(--tm) 35%,transparent);border-top-color:var(--tm);border-radius:50%;animation:ws-spin .8s linear infinite;vertical-align:-1px}
@keyframes ws-spin{to{transform:rotate(360deg)}}
.ws-log{border:1px solid var(--tl);border-radius:10px;background:var(--tc2);padding:10px 12px;max-height:260px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;line-height:16px;white-space:pre;color:var(--tm)}
.ws-run{border:1px solid color-mix(in srgb,var(--tb) 38%,var(--tl));border-radius:12px;background:color-mix(in srgb,var(--tb) 6%,var(--tc));padding:14px 16px;margin-bottom:12px}
.ws-add{border:1px solid var(--tl);border-radius:12px;background:var(--tc);padding:14px 16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.025)}
.ws-tabs{display:flex;gap:6px;margin-bottom:12px}
.ws-tab{border:1px solid transparent;background:transparent;color:var(--tm);font:inherit;font-size:12px;border-radius:7px;padding:5px 11px;cursor:pointer}
.ws-tab.on{background:color-mix(in srgb,var(--tb) 13%,transparent);border-color:color-mix(in srgb,var(--tb) 30%,transparent);color:var(--tb);font-weight:600}
.ws-form{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ws-i{box-sizing:border-box;border:1px solid var(--tl2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:17px;border-radius:8px;padding:6px 10px;outline:none;min-width:0;transition:border-color .15s,box-shadow .15s}
.ws-i:focus{border-color:var(--tb);box-shadow:0 0 0 3px color-mix(in srgb,var(--tb) 13%,transparent)}
.ws-i::placeholder{color:var(--tm)}
.ws-i.phone{width:160px}.ws-i.code{width:130px;font-variant-numeric:tabular-nums;letter-spacing:.08em}
.ws-help{font-size:11px;color:var(--tm);line-height:18px;margin-top:8px}
.ws-link{color:var(--tb);font-size:11.5px;word-break:break-all;text-decoration:none;display:block;margin-top:10px;line-height:17px}
.ws-link:hover{text-decoration:underline}
`

    /* ---------------------------------------------------------- 工具函数 */

    const apiBase = () => {
      try { return new URL('wb-signin/api/', document.baseURI).href } catch { return '/wb-signin/api/' }
    }

    async function getState() {
      const res = await fetch(apiBase() + 'state', { cache: 'no-store' })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }

    async function postRun() {
      const res = await fetch(apiBase() + 'run', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((body && body.error) || ('HTTP ' + res.status))
      return body
    }

    const pad2 = (n) => String(n).padStart(2, '0')

    function nowText() {
      const d = new Date()
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    }

    function fmtWhen(iso) {
      if (!iso) return '—'
      // 2026-11-06T07:41:19.000Z → 11-06 15:41（本地）
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return String(iso)
      return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    }

    function fmtAgo(ms) {
      if (!ms) return ''
      const diff = Date.now() - ms
      if (diff < 0) return ''
      const min = Math.floor(diff / 60000)
      if (min < 1) return '刚刚'
      if (min < 60) return `${min} 分钟前`
      const hr = Math.floor(min / 60)
      if (hr < 24) return `${hr} 小时前`
      return `${Math.floor(hr / 24)} 天前`
    }

    function fmtSize(n) {
      if (!n) return '0 B'
      const u = ['B', 'KB', 'MB']
      let v = n, i = 0
      while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
      return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
    }

    /* -------------------------------------------------------------- 图标 */

    function PanelIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 18
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': true, style: { display: 'block' },
      },
        h('rect', { x: 3.25, y: 4.75, width: 17.5, height: 14.5, rx: 2.5, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'M3.25 9.25h17.5', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'M6.6 12.6h4M6.6 15.4h6.4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('path', { d: 'M15.6 12.1l3.4 2.5-3.4 2.5z', fill: 'currentColor', opacity: 0.9 }),
      )
    }

    /* -------------------------------------------------------- 账号卡片 */

    function AccountCard({ acc }) {
      const g = acc.growth
      const fin = acc.finished
      return h('div', { className: 'ws-acc' },
        h('div', { className: 'ws-ar' },
          h('span', { className: 'ws-dot ' + (acc.checkedIn ? 'on' : 'off') }),
          h('span', { className: 'ws-an' }, acc.name || acc.account),
          h('span', {
            className: 'ws-tag ' + (acc.checkedIn ? 'g' : 'w'),
          }, acc.checkedIn ? '今日已签到' : '今日未签到'),
          g ? h('span', { className: 'ws-tag b' }, `等级 ${g.level}`) : null,
          h('div', { className: 'ws-r' },
            acc.credits != null
              ? h('span', { className: 'ws-tag m' }, `${acc.credits} 积分`)
              : null,
            g ? h('span', { className: 'ws-tag m' }, `连签 ${g.checkinStreak} 天`) : null,
          ),
        ),
        h('div', { className: 'ws-facts' },
          h('div', { className: 'ws-fact' },
            h('s', null, '签到'),
            h('b', null, acc.checkinText ? acc.checkinText.split(' · ')[0].replace('签到成功 ', '') : '—'),
          ),
          h('div', { className: 'ws-fact' },
            h('s', null, '连签 / 累计'),
            h('b', null, g ? `${g.checkinStreak} 天 / ${g.totalDays} 天` : '—'),
          ),
          h('div', { className: 'ws-fact' },
            h('s', null, '活跃连签'),
            h('b', null, g ? `${g.activeStreak} 天` : '—'),
          ),
          h('div', { className: 'ws-fact' },
            h('s', null, '能量'),
            h('b', null, g ? String(g.energy) : '—'),
          ),
        ),
        fin ? h('div', { className: 'ws-left' },
          `成长任务 ${fin.done}/${fin.total} · 等级 ${fin.level}`,
          fin.left ? h('span', null, h('em', null, ` · 待完成：${fin.left}`)) : null,
        ) : null,
        acc.travel ? h('div', { className: 'ws-left' }, `🐾 旅行：${acc.travel}`) : null,
        acc.blindbox ? h('div', { className: 'ws-left' }, `📦 盲盒：${acc.blindbox}`) : null,
        acc.manual && acc.manual.length
          ? h('div', { className: 'ws-left' }, h('em', null, `⚠️ 需手动：${acc.manual[0]}`))
          : null,
      )
    }

    /* -------------------------------------------------------- 计划任务行 */

    function TaskRow({ task, desc }) {
      const st = task || {}
      const missing = st.state === 'missing' || st.state === 'unsupported'
      const ready = st.state === 'Ready'
      return h('div', { className: 'ws-trow' },
        h('div', { style: { minWidth: 0 } },
          h('div', { className: 'ws-tname' }, st.name || '—'),
          h('div', { className: 'ws-tdesc' }, desc),
        ),
        h('span', { className: 'ws-tag ' + (missing ? 'w' : ready ? 'g' : 'm') },
          missing ? (st.state === 'missing' ? '不存在' : '不支持') : (st.state || 'unknown')),
        h('div', { className: 'ws-tnext' },
          h('b', null, missing ? '—' : fmtWhen(st.next)),
          h('span', null, st.last ? `上次 ${fmtWhen(st.last)} · ${fmtAgo(new Date(st.last).getTime())}` : '下次运行'),
        ),
      )
    }

    /* -------------------------------------------------------- 新增账号 */

    function AddAccount({ busy, onAction, auth }) {
      const [region, setRegion] = useState('cn')
      const [phone, setPhone] = useState('')
      const [code, setCode] = useState('')
      const sent = busy === 'cn:send' || busy === 'cn:verify'

      const switchRegion = (next) => {
        setRegion(next)
        setCode('')
      }

      return h('div', { className: 'ws-add' },
        h('div', { className: 'ws-ar' },
          h('div', { style: { fontSize: 13, fontWeight: 650 } }, '新增账号'),
          h('div', { className: 'ws-tabs' },
            h('button', { className: 'ws-tab' + (region === 'cn' ? ' on' : ''), onClick: () => switchRegion('cn') }, '国内版'),
            h('button', { className: 'ws-tab' + (region === 'intl' ? ' on' : ''), onClick: () => switchRegion('intl') }, '国际版'),
          ),
        ),
        region === 'cn' ? h('div', null,
          h('div', { className: 'ws-form' },
            h('input', {
              className: 'ws-i phone', type: 'tel', inputMode: 'numeric', maxLength: 11,
              placeholder: '11 位手机号', value: phone, disabled: sent,
              onChange: (e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11)),
            }),
            h('button', {
              className: 'ws-b sm', disabled: busy === 'cn:send' || busy === 'cn:verify' || phone.length !== 11,
              onClick: () => onAction('cn', 'send', { phone }),
            }, busy === 'cn:send' ? h('span', { className: 'ws-spin' }) : null, sent ? '重新发送' : '发送验证码'),
            sent ? h('input', {
              className: 'ws-i code', type: 'text', inputMode: 'numeric', maxLength: 8,
              placeholder: '短信验证码', value: code, autoFocus: true,
              onChange: (e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8)),
              onKeyDown: (e) => { if (e.key === 'Enter' && code) onAction('cn', 'verify', { phone, code }) },
            }) : null,
            sent ? h('button', {
              className: 'ws-b sm pri', disabled: busy === 'cn:verify' || code.length < 4,
              onClick: () => onAction('cn', 'verify', { phone, code }),
            }, busy === 'cn:verify' ? h('span', { className: 'ws-spin' }) : null, '验证并添加') : null,
          ),
          h('div', { className: 'ws-help' }, '通过官方插件登录接口获取令牌，自动写入签到令牌库；验证码不会保存。'),
        ) : h('div', null,
          auth && auth.authUrl
            ? h('div', null,
              h('div', { className: 'ws-help' }, busy === 'intl:poll' ? '等待浏览器授权中…完成后会自动加入令牌库。' : '授权链接已生成。'),
              h('a', { className: 'ws-link', href: auth.authUrl, target: '_blank', rel: 'noreferrer' }, '在浏览器打开授权链接 →'),
              h('button', { className: 'ws-b gh sm', style: { marginTop: 8, paddingLeft: 0 }, onClick: () => onAction('intl', 'start', {}) }, '重新生成链接'),
            )
            : h('button', {
              className: 'ws-b sm pri', disabled: busy === 'intl:start' || busy === 'intl:poll',
              onClick: () => onAction('intl', 'start', {}),
            }, busy === 'intl:start' ? h('span', { className: 'ws-spin' }) : null, '发起设备授权'),
          h('div', { className: 'ws-help' }, '使用 Google / GitHub / X 登录 workbuddy.ai，无需手机号。'),
        ),
      )
    }

    /* -------------------------------------------------------------- 面板 */

    function SigninPanel() {
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState('')
      const [logLines, setLogLines] = useState(null)
      const [addBusy, setAddBusy] = useState('')
      const [intlAuth, setIntlAuth] = useState(null)
      const timer = useRef(null)
      const noticeTimer = useRef(null)
      const intlPoll = useRef(null)
      const intlId = useRef(null)
      const loadRef = useRef(null)

      const load = useCallback(async () => {
        try {
          const next = await getState()
          setState(next)
          setError('')
        } catch (e) {
          setError('连不上服务：' + (e && e.message ? e.message : String(e)))
        }
      }, [])

      useEffect(() => {
        load()
        const t = setInterval(load, 15000)
        loadRef.current = load
        return () => clearInterval(t)
      }, [load])

      useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current)
        if (noticeTimer.current) clearTimeout(noticeTimer.current)
        if (intlPoll.current) clearTimeout(intlPoll.current)
      }, [])

      const flash = (msg, bad) => {
        if (bad) { setError(msg); setNotice('') } else { setNotice(msg); setError('') }
        if (noticeTimer.current) clearTimeout(noticeTimer.current)
        noticeTimer.current = setTimeout(() => { setNotice(''); setError('') }, 6000)
      }

      const onRun = useCallback(async () => {
        setBusy('run')
        try {
          await postRun()
          await load()
          flash('已执行一轮签到，日志见下方')
        } catch (e) {
          flash('立即签到失败：' + (e && e.message ? e.message : String(e)), true)
        } finally {
          setBusy('')
        }
      }, [load])

      const onAddAccount = useCallback(async (region, action, payload) => {
        const key = `${region}:${action}`
        setAddBusy(key)
        setError('')
        setNotice('')
        try {
          const res = await fetch(apiBase() + 'account', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ region, action, ...payload }),
          })
          const body = await res.json().catch(() => ({}))
          if (!res.ok || !body.ok) throw new Error(body.error || ('HTTP ' + res.status))
          if (body.state) setState(body.state)
          if (region === 'intl' && action === 'start') {
            intlId.current = body.id
            setIntlAuth({ id: body.id, authUrl: body.authUrl })
            setAddBusy('intl:poll')
            const poll = async () => {
              try {
                const r = await fetch(apiBase() + 'account', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ region: 'intl', action: 'poll', id: intlId.current }),
                })
                const next = await r.json().catch(() => ({}))
                if (!r.ok || !next.ok) throw new Error(next.error || ('HTTP ' + r.status))
                if (next.completed) {
                  if (next.state) setState(next.state)
                  intlId.current = null
                  setIntlAuth(null)
                  setAddBusy('')
                  flash(`国际版账号 ${next.account || ''} 已添加`)
                  return
                }
                intlPoll.current = setTimeout(poll, 1200)
              } catch (e) {
                intlId.current = null
                setAddBusy('')
                flash('国际版授权失败：' + (e && e.message ? e.message : String(e)), true)
              }
            }
            intlPoll.current = setTimeout(poll, 800)
            flash('授权链接已生成，请在新窗口完成登录')
          } else {
            flash(body.message || '账号已添加')
          }
        } catch (e) {
          flash('添加账号失败：' + (e && e.message ? e.message : String(e)), true)
        } finally {
          if (region !== 'intl' || action !== 'start') setAddBusy('')
        }
      }, [])

      const onLog = useCallback(async () => {
        setBusy('log')
        try {
          const res = await fetch(apiBase() + 'log?lines=160', { cache: 'no-store' })
          const body = await res.json()
          setLogLines(Array.isArray(body.lines) ? body.lines : [])
        } catch (e) {
          flash('日志读取失败：' + (e && e.message ? e.message : String(e)), true)
        } finally {
          setBusy('')
        }
      }, [])

      if (!state) {
        return h('div', { className: 'ws-page' },
          h('style', { 'data-plugin': NS }, CSS),
          h('div', { className: 'ws-in' },
            h('div', { className: 'ws-tasks' },
              h('div', { className: 'ws-empty' },
                error ? error : h('span', null, h('span', { className: 'ws-spin' }), ' 连接中…'),
              ),
            ),
          ),
        )
      }

      const accounts = state.accounts || []
      const doneCount = accounts.filter((a) => a.checkedIn).length
      const allDone = accounts.length > 0 && doneCount === accounts.length
      const totalCredits = accounts.reduce((s, a) => s + (a.credits || 0), 0)
      const batchToday = Boolean(state.batch && state.batch.today)

      return h('div', { className: 'ws-page' },
        h('style', { 'data-plugin': NS }, CSS),
        h('div', { className: 'ws-scroll' },
          h('div', { className: 'ws-in' },

            // 标题
            h('div', { className: 'ws-top ws-in-item' },
              h('div', null,
                h('h1', { className: 'ws-h1' }, 'WB 签到'),
                h('div', { className: 'ws-sub' }, 'WorkBuddy 国内版 · 每日自动签到'),
              ),
              h('div', { className: 'ws-g' }),
              h('span', { className: 'ws-clock' },
                h('b', null, nowText()),
                h('span', null, batchToday ? '今日已跑' : '今日未跑'),
              ),
            ),

            error && !notice ? h('div', { className: 'ws-err' }, error) : null,
            notice ? h('div', { className: 'ws-ok' }, notice) : null,

            // 今日总览
            h('div', { className: 'ws-in-item ws-d1' },
              h('div', { className: 'ws-hero ' + (allDone ? 'on' : 'off') },
                h('div', { className: 'ws-hr' },
                  h('span', { className: 'ws-dot ' + (allDone ? 'on' : 'off') }),
                  h('div', { className: 'ws-hm' },
                    h('div', { className: 'ws-hl' },
                      accounts.length
                        ? (allDone ? '今天全部签到了' : `今天 ${doneCount}/${accounts.length} 个账号已签到`)
                        : '还没有账号数据'),
                    h('div', { className: 'ws-hd' },
                      state.batch && state.batch.startedAt
                        ? `最近一轮：${state.batch.startedAt}`
                        : '日志里还没有运行批次'),
                  ),
                  h('div', { className: 'ws-credit' },
                    h('b', null, totalCredits ? totalCredits.toFixed(2) : '—'),
                    h('span', null, '账号积分合计'),
                  ),
                ),
              ),
            ),

            // 立即签到
            h('div', { className: 'ws-in-item ws-d2' },
              h('div', { className: 'ws-run' },
                h('div', { className: 'ws-ar' },
                  h('div', { className: 'ws-hm' },
                    h('div', { style: { fontSize: 13, fontWeight: 650 } }, '立即签到'),
                    h('div', { className: 'ws-hd' }, '跑一遍完整流程：续期 → 查询 → 签到 → 任务 → 领奖'),
                  ),
                  h('div', { className: 'ws-r' },
                    h('button', {
                      className: 'ws-b gh sm', onClick: onLog, disabled: busy === 'log',
                    }, busy === 'log' ? h('span', { className: 'ws-spin' }) : null, '看日志'),
                    h('button', {
                      className: 'ws-b pri', onClick: onRun, disabled: busy === 'run' || state.running,
                    }, busy === 'run' ? h('span', { className: 'ws-spin' }) : null, busy === 'run' ? '签到中…' : '立即签到'),
                  ),
                ),
                state.lastRun ? h('div', { className: 'ws-hd', style: { marginTop: 8 } },
                  `上次手动运行：${fmtWhen(state.lastRun.at)}` +
                  (state.lastRun.ok === true ? ' ✅' : state.lastRun.ok === false ? ' ❌' : ''),
                ) : null,
              ),
            ),

            // 账号
            h('div', { className: 'ws-in-item ws-d3' },
              h('div', { className: 'ws-sec' }, '账号',
                h('span', { className: 'ws-tag m' }, `${accounts.length} 个`),
              ),
              accounts.length
                ? accounts.map((a) => h(AccountCard, { key: a.account, acc: a }))
                : h('div', { className: 'ws-tasks' },
                    h('div', { className: 'ws-empty' }, '日志里还没有账号记录，先跑一次签到'),
                  ),
              h(AddAccount, { key: `add-${state.tokens && state.tokens.cn ? state.tokens.cn.count : 0}`, busy: addBusy, onAction: onAddAccount, auth: intlAuth }),
            ),

            // 计划任务
            h('div', { className: 'ws-in-item ws-d4' },
              h('div', { className: 'ws-sec' }, '自动签到'),
              h('div', { className: 'ws-tasks' },
                h(TaskRow, { task: state.tasks && state.tasks.main, desc: '主任务：签到 + 成长中心全套' }),
                h(TaskRow, { task: state.tasks && state.tasks.poll, desc: '轮询：补签、领旅行礼物、兜底' }),
              ),
              h('div', { className: 'ws-left', style: { marginTop: 8 } },
                `令牌库：国内 ${state.tokens && state.tokens.cn ? state.tokens.cn.count : 0} 个账号` +
                ` · 国际 ${state.tokens && state.tokens.intl ? state.tokens.intl.count : 0} 个` +
                ` · 日志 ${state.log ? fmtSize(state.log.size) : '—'}`,
              ),
            ),

            logLines ? h('div', { className: 'ws-in-item' },
              h('div', { className: 'ws-sec' }, '日志'),
              h('div', { className: 'ws-log' }, logLines.join('\n') || '（空）'),
            ) : null,
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
            { name: 'sidebar.panellist', id: NS, order: 31, label: 'WB 签到' },
            (props) => h(PanelIcon, props),
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: NS, label: 'WB 签到' }, () => h(SigninPanel)),
        )
      },
    }
  },
})
