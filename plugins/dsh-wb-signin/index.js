/**
 * dsh-wb-signin — Host half.
 *
 * 给 DeepSeek Harness 的左侧栏「WB 签到」面板供数据：
 *  1. 解析 WorkBuddy-Daily 的 signin.log，抽出每个账号最近一次运行批次里的
 *     签到结果、连签天数、积分、成长进度、剩余任务；
 *  2. 读脱敏后的令牌库（wb_refresh_tokens.json）概览：账号数、续期时间，
 *     **绝不返回任何 token 明文**；
 *  3. 查 Windows 计划任务 WorkBuddyDailySignin / WorkBuddyGrowthPoll 的下次运行时间；
 *  4. 「立即签到」= 调 run-signin.cmd（pythonw，无窗口，写 signin.log），
 *     轮询日志批次标记直到出现新批次，返回该批次摘要。
 *
 * 日志是 GBK/UTF-8 混合写出的：解析时按 utf8 errors=replace 读，中文可能有
 * 少量问号，但正则只匹配 ASCII 数字与已知关键词，不影响取值。
 */
import { execFile } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/* ------------------------------------------------------------------ 解析 */

/**
 * 日志行形如：
 *   [07:09:04][账号1] 💰 积分: 剩余积分合计2372.32（…）
 *   [07:09:05][账号1] 🌱 成长: 等级17 签到连签21天 活跃连签4天 能量3 累签65天
 *   [10:00:08][账号1]    ✅签到: 今天已签到（签到连签22天，累计2200）
 *   [07:14:35][账号2] 🏁 15*******45: 完成16/18 等级16 剩余: 体验资料库, 关注公众号
 *   ===== 2026/11/06 7:09:01.20 args: =====
 *
 * 批次（===== 分隔）是解析单位：一个批次 = 一次完整运行 = 一次签到轮次。
 */

const RE_BATCH = /^=====\s*(.+?)\s*args:(.*?)=====\s*$/
const RE_ACCOUNT = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\[(账号\d+)\]\s*(.*)$/
const RE_CREDITS = /积分[:：]\s*剩余积分合计([\d.]+)/
const RE_GROWTH =
  /成长[:：]\s*等级(\d+)\s*签到连签(\d+)天\s*活跃连签(\d+)天\s*能量(\d+)\s*累签(\d+)天/
const RE_CHECKIN_OK = /签到成功\s*\+(\d+)积分[（(]签到连签(\d+)天，累计(\d+)[）)]/
const RE_CHECKIN_ALREADY = /今天已签到[（(]签到连签(\d+)天，累计(\d+)[）)]/
const RE_FINISH = /🏁\s*(\S+?)[:：]\s*完成(\d+)\/(\d+)\s*等级(\d+)\s*剩余[:：]\s*(.*)$/
const RE_TRAVEL = /旅行[:：]\s*(.*)$/
const RE_BLIND = /盲盒[:：]\s*(.*)$/
const RE_MANUAL = /新任务需手动[:：]\s*(.*)$/

/** 一行 → { hhmm, account, text }；解析不了返回 null。 */
function parseLine(raw) {
  const m = RE_ACCOUNT.exec(raw)
  if (!m) return null
  return { hhmm: m[1], account: m[2], text: m[3].trim() }
}

/** 手机号仅保留前三位与末四位，中间以星号遮盖。 */
function maskPhone(phone) {
  const s = String(phone || '')
  if (s.length < 7) return s
  return `${s.slice(0, 3)}${'*'.repeat(Math.max(1, s.length - 7))}${s.slice(-4)}`
}

/** 把一个批次的原始行，收敛成每个账号一条摘要。 */
function summarizeBatch(lines) {
  /** accountId -> partial */
  const accounts = new Map()
  let startedAt = null

  for (const raw of lines) {
    const b = RE_BATCH.exec(raw)
    if (b) {
      startedAt = b[1].trim()
      continue
    }
    const line = parseLine(raw)
    if (!line) continue
    let a = accounts.get(line.account)
    if (!a) {
      a = {
        account: line.account,
        name: '',
        checkedIn: false,
        checkinText: '',
        credits: null,
        growth: null,
        finished: null,
        travel: '',
        blindbox: '',
        manual: [],
        lines: [],
      }
      accounts.set(line.account, a)
    }
    a.lines.push(`${line.hhmm} ${line.text}`)
    // 只保留最后 40 行，够面板展示又不会把响应撑爆
    if (a.lines.length > 40) a.lines.shift()

    let m = RE_CREDITS.exec(line.text)
    if (m) a.credits = Number(m[1])

    m = RE_GROWTH.exec(line.text)
    if (m) {
      a.growth = {
        level: Number(m[1]),
        checkinStreak: Number(m[2]),
        activeStreak: Number(m[3]),
        energy: Number(m[4]),
        totalDays: Number(m[5]),
      }
    }

    m = RE_CHECKIN_OK.exec(line.text)
    if (m) {
      a.checkedIn = true
      a.checkinText = `签到成功 +${m[1]} 积分 · 连签 ${m[2]} 天 · 累计 ${m[3]}`
      a.checkinStreak = Number(m[2])
      a.checkinCredit = Number(m[1])
    }

    m = RE_CHECKIN_ALREADY.exec(line.text)
    if (m) {
      a.checkedIn = true
      a.checkinText = `今天已签到 · 连签 ${m[1]} 天 · 累计 ${m[2]}`
      a.checkinStreak = Number(m[1])
    }

    m = RE_FINISH.exec(line.text)
    if (m) {
      a.name = maskPhone(m[1])
      a.finished = { done: Number(m[2]), total: Number(m[3]), level: Number(m[4]), left: m[5] }
    }

    m = RE_TRAVEL.exec(line.text)
    if (m) a.travel = m[1].trim()

    m = RE_BLIND.exec(line.text)
    if (m) a.blindbox = m[1].trim()

    m = RE_MANUAL.exec(line.text)
    if (m && m[1].trim() && m[1].trim().length < 120) a.manual.push(m[1].trim())
  }

  return { startedAt, accounts: [...accounts.values()] }
}

/** 从整份日志里切出「最近 N 个批次」，新的在前。 */
function recentBatches(text, limit = 8) {
  const lines = text.split(/\r?\n/)
  const marks = []
  for (let i = 0; i < lines.length; i++) {
    if (RE_BATCH.test(lines[i])) marks.push(i)
  }
  const out = []
  for (let k = marks.length - 1; k >= 0 && out.length < limit; k--) {
    const start = marks[k]
    const end = k + 1 < marks.length ? marks[k + 1] : lines.length
    out.push(summarizeBatch(lines.slice(start, end)))
  }
  return out
}

/* ---------------------------------------------------------------- 计划任务 */

function runPowerShell(script, timeout = 12000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          resolve({ ok: false, error: String((err && err.message) || err) })
          return
        }
        resolve({ ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') })
      },
    )
  })
}

/** Get-ScheduledTask 的 PS 输出不可靠时退回 schtasks /Query /FO CSV。 */
function schtasksInfo(name) {
  return new Promise((resolve) => {
    execFile(
      'schtasks',
      ['/Query', '/TN', name, '/FO', 'CSV', '/NH'],
      { timeout: 12000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve(null)
          return
        }
        // CSV: "TaskName","Next Run Time","Status","Logon Mode",...
        const line = String(stdout).split(/\r?\n/).find((l) => l.includes(name))
        if (!line) {
          resolve(null)
          return
        }
        const cells = line
          .split('","')
          .map((c) => c.replace(/^"|"$/g, '').trim())
        resolve({ next: cells[1] || '', status: cells[2] || '' })
      },
    )
  })
}

async function taskInfo(name) {
  if (process.platform !== 'win32') return { name, state: 'unsupported' }
  const ps = await runPowerShell(
    `$ErrorActionPreference='SilentlyContinue'
$t = Get-ScheduledTask -TaskName '${name}'
if ($t -eq $null) { 'STATE=missing'; exit }
$i = Get-ScheduledTaskInfo -TaskName '${name}'
'STATE=' + $t.State
'NEXT=' + $(if ($i.NextRunTime) { $i.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { '' })
'LAST=' + $(if ($i.LastRunTime) { $i.LastRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { '' })
'RESULT=' + $i.LastTaskResult`,
  )
  if (!ps.ok) {
    const fb = await schtasksInfo(name)
    return fb ? { name, state: fb.status || 'unknown', next: fb.next } : { name, state: 'unknown' }
  }
  const out = {}
  for (const line of ps.stdout.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  if (out.STATE === 'missing') return { name, state: 'missing' }
  return {
    name,
    state: out.STATE || 'unknown',
    next: out.NEXT || '',
    last: out.LAST || '',
    result: out.RESULT || '',
  }
}

/* ------------------------------------------------------------------ 主逻辑 */

export function apply(ctx, config) {
  const settings = Object.assign(
    {
      root: process.env.WORKBUDDY_DAILY_ROOT || join(homedir(), 'WorkBuddy-Daily'),
      mainTask: 'WorkBuddyDailySignin',
      pollTask: 'WorkBuddyGrowthPoll',
      runCommand: '',
      logTailBytes: 400 * 1024,
    },
    config && typeof config === 'object' ? config : {},
  )

  const root = settings.root
  const logFile = join(root, 'signin.log')
  const tokenStore = join(root, 'wb_refresh_tokens.json')
  const intlStore = join(root, 'wb_intl_tokens.json')
  const runCmd = settings.runCommand || join(root, 'run-signin.cmd')

  /* ------------------------------------------------------------ 读取日志 */

  function readLogTail(maxBytes) {
    try {
      const st = statSync(logFile)
      const size = st.size
      const start = Math.max(0, size - maxBytes)
      const buf = Buffer.alloc(size - start)
      const fd = openSync(logFile, 'r')
      try {
        readSync(fd, buf, 0, buf.length, start)
      } finally {
        closeSync(fd)
      }
      return { text: buf.toString('utf8'), size, mtimeMs: st.mtimeMs }
    } catch (error) {
      return { text: '', size: 0, mtimeMs: 0, error: String((error && error.message) || error) }
    }
  }

  function readTokenStore(file) {
    if (!existsSync(file)) return null
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      const accounts = Object.entries(parsed).map(([key, value]) => ({
        key: maskPhone(key),
        updated: (value && (value.updated || value.refreshed_at)) || null,
      }))
      return { count: accounts.length, accounts }
    } catch (error) {
      return { count: 0, accounts: [], error: String((error && error.message) || error) }
    }
  }

  /* ------------------------------------------------------------ 新增账号 */

  let loginBusy = false
  const intlSessions = new Map()

  function writeJsonAtomic(file, value) {
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(tmp, file)
  }

  /** 复用仓库里的登录函数，避免在 JS 里重新实现一套凭据格式。 */
  function runLoginPython(script, args) {
    return new Promise((resolve) => {
      execFile(
        'python',
        ['-u', '-c', script, ...args],
        { timeout: 60000, windowsHide: true, cwd: root, env: { ...process.env, PYTHONUTF8: '1' } },
        (error, stdout, stderr) => {
          if (error && !stdout) {
            resolve({ ok: false, error: String((stderr || error.message || error)).trim().slice(-400) })
            return
          }
          // workbuddy_login.py / workbuddy_intl_login.py 的函数内部会 print 日志行，
          // 与结果 JSON 混在同一份 stdout 里；只认最后一行可解析、且带 ok 字段的 JSON。
          const lines = String(stdout).split(/\r?\n/)
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim()
            if (!line.startsWith('{') || !line.endsWith('}')) continue
            try {
              const obj = JSON.parse(line)
              if (obj && typeof obj === 'object' && 'ok' in obj) {
                if (obj.error) obj.error = String(obj.error).slice(0, 300)
                resolve(obj)
                return
              }
            } catch { /* 继续往前找 */ }
          }
          resolve({ ok: false, error: String(stdout || stderr || error || '登录脚本未返回结果').trim().slice(-400) })
        },
      )
    })
  }

  const CN_SMS = `
import json, sys
from workbuddy_login import send_sms
ok, message = send_sms(sys.argv[1])
print(json.dumps({'ok': ok, 'error': message}, ensure_ascii=False))
`

  const CN_VERIFY = `
import json, sys, os, time
from workbuddy_login import login
phone = sys.argv[1]
result = login(phone, sys.argv[2])
if not result:
    print(json.dumps({'ok': False, 'error': '验证码无效或已过期，请重新发送后再试'}, ensure_ascii=False))
else:
    file = os.path.join(os.getcwd(), 'wb_refresh_tokens.json')
    try:
        with open(file, encoding='utf-8') as fh: store = json.load(fh)
        if not isinstance(store, dict): store = {}
    except Exception: store = {}
    store[phone] = {'refresh_token': result['refreshToken'], 'access_token': result['accessToken'], 'updated': time.strftime('%Y-%m-%d %H:%M')}
    with open(file, 'w', encoding='utf-8') as fh: json.dump(store, fh, ensure_ascii=False, indent=2)
    print(json.dumps({'ok': True}, ensure_ascii=False))
`

  const INTL_START = `
import json
from workbuddy_intl_login import start_login
try:
    data = start_login()
    print(json.dumps({'ok': True, 'state': data['state'], 'authUrl': data['authUrl']}, ensure_ascii=False))
except Exception as e:
    print(json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False))
`

  const INTL_POLL = `
import json, sys
from workbuddy_intl_login import poll_token
try:
    auth = poll_token(sys.argv[1], 45)
    print(json.dumps({'ok': True, 'accessToken': auth.get('accessToken', ''), 'refreshToken': auth.get('refreshToken', '')}, ensure_ascii=False))
except TimeoutError:
    print(json.dumps({'ok': True, 'pending': True}, ensure_ascii=False))
except Exception as e:
    print(json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False))
`

  const INTL_ACCOUNT = `
import json, sys
from workbuddy_intl_login import fetch_account, _uid_of
print(json.dumps({'ok': True, 'account': fetch_account(sys.argv[1], sys.argv[2]), 'uid': _uid_of(sys.argv[2])}, ensure_ascii=False))
`

  async function sendCnCode(phone) {
    if (!/^1\d{10}$/.test(phone)) return { ok: false, error: '请输入 11 位国内手机号' }
    const result = await runLoginPython(CN_SMS, [phone])
    if (!result.ok) return result
    return { ok: true, phone: maskPhone(phone), message: '验证码已发送，请在 5 分钟内输入' }
  }

  async function verifyCnCode(phone, code) {
    if (!/^1\d{10}$/.test(phone) || !/^\d{4,8}$/.test(code)) {
      return { ok: false, error: '手机号或验证码格式不正确' }
    }
    const result = await runLoginPython(CN_VERIFY, [phone, code])
    if (!result.ok) return result
    return { ok: true, account: maskPhone(phone), message: '已加入国内版令牌库，下次签到会自动包含该账号' }
  }

  async function startIntlLogin() {
    const result = await runLoginPython(INTL_START, [])
    if (!result.ok) return result
    const session = { id: `intl_${Date.now().toString(36)}`, state: result.state, polling: false, completed: false }
    intlSessions.set(session.id, session)
    for (const [id, old] of intlSessions) {
      if (old.completed) intlSessions.delete(id)
    }
    return { ok: true, id: session.id, authUrl: result.authUrl, message: '请在浏览器中打开授权链接，用 Google / GitHub / X 登录' }
  }

  async function pollIntlLogin(id) {
    const session = intlSessions.get(id)
    if (!session) return { ok: false, error: '授权会话已过期，请重新发起' }
    if (session.completed) return { ok: true, completed: true, account: session.account, message: session.message }
    if (session.polling) return { ok: true, pending: true }
    session.polling = true
    try {
      const result = await runLoginPython(INTL_POLL, [session.state])
      if (!result.ok) return result
      if (result.pending) return { ok: true, pending: true }
      if (!result.accessToken || !result.refreshToken) return { ok: false, error: '授权成功但未返回完整令牌，请重试' }
      const detail = await runLoginPython(INTL_ACCOUNT, [session.state, result.accessToken])
      const account = detail.account || {}
      const uid = account.uid || detail.uid
      if (!uid) return { ok: false, error: '授权成功但无法取得账号 uid' }
      let store = {}
      try {
        const parsed = JSON.parse(readFileSync(intlStore, 'utf8'))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) store = parsed
      } catch { /* 不存在则从空库开始 */ }
      const note = account.nickname || uid.slice(0, 8)
      store[uid] = { access_token: result.accessToken, refresh_token: result.refreshToken, note }
      writeJsonAtomic(intlStore, store)
      session.completed = true
      session.account = note
      session.message = '已加入国际版令牌库'
      return { ok: true, completed: true, account: note, message: session.message }
    } finally {
      session.polling = false
    }
  }

  async function addAccount(req) {
    const raw = await readBody(req)
    if (!raw) return { ok: false, error: '请求体过大', status: 413 }
    let body
    try { body = JSON.parse(raw.toString('utf8')) } catch { return { ok: false, error: '请求 JSON 无效', status: 400 } }
    const region = body.region === 'intl' ? 'intl' : 'cn'
    const action = String(body.action || '')
    if (region === 'intl' && action === 'poll') return await pollIntlLogin(String(body.id || ''))
    if (loginBusy) return { ok: false, error: '有另一个账号添加操作正在进行，请稍候', status: 409 }
    loginBusy = true
    try {
      if (region === 'cn' && action === 'send') return await sendCnCode(String(body.phone || '').trim())
      if (region === 'cn' && action === 'verify') return await verifyCnCode(String(body.phone || '').trim(), String(body.code || '').trim())
      if (region === 'intl' && action === 'start') return await startIntlLogin()
      return { ok: false, error: '不支持的新增账号操作', status: 400 }
    } finally {
      loginBusy = false
    }
  }

  /* ------------------------------------------------------------ 立即签到 */

  let running = false
  let lastRun = null

  async function runSignin() {
    if (running) return { ok: false, error: '上一次立即签到还在跑，等它结束' }
    if (process.platform !== 'win32') return { ok: false, error: '仅支持 Windows（计划任务 + run-signin.cmd）' }
    if (!existsSync(runCmd)) return { ok: false, error: '找不到启动脚本：' + runCmd }

    running = true
    const startedAt = new Date()
    const before = readLogTail(settings.logTailBytes)
    const batchesBefore = recentBatches(before.text, 1).length
    lastRun = { at: startedAt.toISOString(), ok: null }

    try {
      await new Promise((resolve, reject) => {
        execFile(
          'cmd.exe',
          ['/c', runCmd],
          { timeout: 30 * 60 * 1000, windowsHide: true, cwd: root },
          (err) => {
            // run-signin.cmd 用 exit /b %ERRORLEVEL% 收尾，脚本自身 0/1 都算跑完
            resolve()
          },
        )
      })

      // 等新批次落盘：批次标记数 +1 即视为新一轮完成
      let after = before
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        after = readLogTail(settings.logTailBytes)
        const batches = recentBatches(after.text, 40)
        if (batches.length > batchesBefore || after.mtimeMs > before.mtimeMs + 2000) {
          lastRun = { at: startedAt.toISOString(), ok: true, finishedAt: new Date().toISOString() }
          const latest = batches[0] || null
          return { ok: true, startedAt: startedAt.toISOString(), batch: latest }
        }
      }
      lastRun = { at: startedAt.toISOString(), ok: true, finishedAt: new Date().toISOString(), note: '已执行，但日志未出现新批次标记' }
      return { ok: true, startedAt: startedAt.toISOString(), batch: null }
    } catch (error) {
      lastRun = { at: startedAt.toISOString(), ok: false, error: String((error && error.message) || error) }
      return { ok: false, error: String((error && error.message) || error) }
    } finally {
      running = false
    }
  }

  /* -------------------------------------------------------------- 状态 */

  async function buildState() {
    const log = readLogTail(settings.logTailBytes)
    const batches = recentBatches(log.text, 8)
    const latest = batches[0] || null

    const today = new Date()
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    // 批次标记是 `2026/11/06 7:09:01.20`，可能带星期前缀
    const isTodayBatch = (startedAt) => {
      if (!startedAt) return false
      const m = /(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(startedAt)
      if (!m) return false
      const key = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
      return key === todayKey
    }

    const accounts = (latest ? latest.accounts : []).map((a) => ({
      ...a,
      today: isTodayBatch(latest.startedAt),
    }))

    const [mainTask, pollTask] = await Promise.all([
      taskInfo(settings.mainTask),
      taskInfo(settings.pollTask),
    ])

    return {
      ok: true,
      now: new Date().toISOString(),
      root,
      logFile,
      log: {
        exists: log.size > 0,
        size: log.size,
        mtimeMs: log.mtimeMs,
        error: log.error || null,
      },
      batch: latest
        ? { startedAt: latest.startedAt, today: isTodayBatch(latest.startedAt) }
        : null,
      history: batches.map((b) => ({
        startedAt: b.startedAt,
        accounts: b.accounts.map((a) => ({
          account: a.account,
          name: a.name,
          checkedIn: a.checkedIn,
          checkinText: a.checkinText,
          credits: a.credits,
        })),
      })),
      accounts,
      tokens: {
        cn: readTokenStore(tokenStore),
        intl: readTokenStore(intlStore),
      },
      tasks: { main: mainTask, poll: pollTask },
      running,
      lastRun,
      runCmd,
    }
  }

  /* --------------------------------------------------------------- HTTP */

  function sendJson(res, body, code = 200) {
    const text = JSON.stringify(body)
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(text)
  }

  function readBody(req, limit = 16 * 1024) {
    return new Promise((resolve) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > limit) { req.destroy(); resolve(null); return }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0)))
      req.on('error', () => resolve(null))
    })
  }

  async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    const p = url.pathname
    try {
      if (p === '/wb-signin/api/state') {
        sendJson(res, await buildState())
        return
      }

      if (p === '/wb-signin/api/run' && req.method === 'POST') {
        const result = await runSignin()
        if (!result.ok) {
          sendJson(res, result, 409)
          return
        }
        // 跑完再取一次完整状态，前端直接整块刷新
        sendJson(res, Object.assign(await buildState(), { run: result }))
        return
      }

      if (p === '/wb-signin/api/account' && req.method === 'POST') {
        const result = await addAccount(req)
        if (!result.ok) { sendJson(res, result, result.status || 400); return }
        sendJson(res, { ...result, state: await buildState() })
        return
      }

      if (p === '/wb-signin/api/log') {
        const tail = Number(url.searchParams.get('lines') || 200)
        const log = readLogTail(settings.logTailBytes)
        const lines = log.text.split(/\r?\n/).slice(-Math.min(4000, Math.max(10, tail)))
        sendJson(res, { ok: true, lines })
        return
      }

      sendJson(res, { ok: false, error: 'not found' }, 404)
    } catch (error) {
      sendJson(res, { ok: false, error: String((error && error.message) || error) }, 500)
    }
  }

  ctx.inject(['webServer'], (host) => {
    host.effect(
      () => host.webServer.register({ kind: 'prefix', path: '/wb-signin', handler }),
      'wb-signin: http api',
    )
  })
}
