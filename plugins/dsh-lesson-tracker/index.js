/**
 * dsh-lesson-tracker — Host half.
 *
 * 授课进度记录器（Host 端）：
 *  1. 读取用户配置的作息表与课表，按当前时间推算「正在上的课 / 下一节课」。
 *  2. 通过 WPS / PowerPoint 的 COM 自动化接口，检测当前打开的 PPT、幻灯片总页数与
 *     正在放映/浏览到第几页，并在下课时把页码写进授课进度记录。
 *  3. 可从用户提供的授课进度表导入历史进度（表头是
 *     `0903周四` 形式的日期列，每行一个班级），也能导出回同样的表格。
 *  4. 数据落盘到 <DSH_HOME>/lesson-tracker/data.json，通过 /lesson-tracker/api/* 暴露。
 *
 * 探测 PPT 用 powershell.exe（-STA）跑一小段脚本，把结果写成 UTF-8 的 JSON 文件再读回来，
 * 避免控制台代码页把中文路径弄乱。一次探测约 0.4s，因此带缓存 + 在途去重，
 * 且只在课程时段前后才真正探测。
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { readXlsxFirstSheet } from './xlsx.js'

/* ------------------------------------------------------------------ 作息 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const SHIFT_NAMES = ['第一段', '第二段', '第三段', '第四段']

/* -------------------------------------------------------------- 小工具 */

const pad2 = (n) => String(n).padStart(2, '0')

function dateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function atTime(base, hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, 0, 0)
}

/** 从课件文件名猜一个课题：`课件_示例课题.pptx` → `示例课题`。 */
function topicFromName(name) {
  if (!name) return ''
  let s = String(name).replace(/\.(pptx?|ppsx?|odp)$/i, '')
  const parts = s.split(/[_\-—]/).map((x) => x.trim()).filter(Boolean)
  if (parts.length > 1) {
    const last = parts[parts.length - 1]
    if (last.length >= 2) return last
  }
  s = s
    .replace(/^\d{2,4}[春秋]?/, '')
    .replace(/^[a-zA-Z]{1,6}/, '')
    .replace(/^[_\-\s]+/, '')
  return s || String(name)
}

/**
 * `P48-正等轴测图` / `三视图基础` / `草图-P13` → 拆出页码与题目。
 * 页码出现在末尾时（`草图-P13`）只取页码，题目即前缀本身。
 */
function parseProgressText(text) {
  const raw = String(text || '').trim()
  if (!raw) return { topic: '', page: null }
  let page = null
  let topic = ''

  // P48-xxx（页码在前）
  const head = /^P(\d+)\s*[-—－:：]?\s*(.*)$/i.exec(raw)
  if (head) {
    page = Number(head[1])
    topic = (head[2] || '').trim()
    return { topic, page }
  }
  // xxx-P13（页码在后）
  const tail = /^(.*?)[-\s—－]\s*P(\d+)$/i.exec(raw)
  if (tail) {
    page = Number(tail[2])
    topic = tail[1].trim()
    return { topic, page }
  }
  // xxx-P13-yyy（页码居中）
  const mid = /^(.*?)[-\s—－]\s*P(\d+)\s*[-—－]?\s*(.*)$/i.exec(raw)
  if (mid) {
    page = Number(mid[2])
    topic = [mid[1].trim(), mid[3].trim()].filter(Boolean).join(' ')
    return { topic, page }
  }
  return { topic: '', page: null }
}

/* ------------------------------------------------------------ PPT 探测 */

const PROBE_PS1 = `param([string]$Out)
$ErrorActionPreference = 'SilentlyContinue'
function Probe-($progid) {
  try { $app = [Runtime.InteropServices.Marshal]::GetActiveObject($progid) } catch { return $null }
  if (-not $app) { return $null }
  $path = $null; $name = $null; $slide = 0; $total = 0
  try {
    $win = $app.ActiveWindow
    if ($win -ne $null) {
      $pres = $win.Presentation
      if ($pres -ne $null) {
        $path = [string]$pres.FullName
        $name = [string]$pres.Name
        $total = [int]$pres.Slides.Count
        try { $slide = [int]$win.View.Slide.SlideIndex } catch { }
      }
    }
  } catch { }
  if (-not $name) {
    try {
      $pres = $app.Presentations.Item(1)
      if ($pres -ne $null) {
        $path = [string]$pres.FullName
        $name = [string]$pres.Name
        $total = [int]$pres.Slides.Count
      }
    } catch { }
  }
  return [pscustomobject]@{ progid = $progid; path = $path; name = $name; slide = $slide; total = $total }
}
$r = Probe- 'Kwpp.Application'
if ($r -eq $null) { $r = Probe- 'PowerPoint.Application' }
$payload = @{ found = [bool]($r -ne $null); app = $r; at = (Get-Date).ToString('o') }
$json = $payload | ConvertTo-Json -Compress -Depth 6
[IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
`

/* ---------------------------------------------------------------- 主逻辑 */

export function apply(ctx, config) {
  const settings = Object.assign(
    {
      teacher: '',
      autoRecord: false,
      endGraceSec: 90,
      importPath: '',
      periods: {},
      classes: [],
      courses: [],
      subject: '',
    },
    config && typeof config === 'object' ? config : {},
  )

  const PERIODS = settings.periods && typeof settings.periods === 'object' ? settings.periods : {}
  const CLASSES = Array.isArray(settings.classes) ? settings.classes : []
  const COURSES = Array.isArray(settings.courses) ? settings.courses : []
  const SUBJECT = typeof settings.subject === 'string' ? settings.subject : ''

  const dataDir = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'lesson-tracker')
  const dataFile = join(dataDir, 'data.json')
  const probeScript = join(dataDir, 'probe-ppt.ps1')

  function ensureDir() {
    try {
      if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
    } catch { /* ignore */ }
  }

  /* -------------------------------------------------------------- 存储 */

  function loadData() {
    try {
      const parsed = JSON.parse(readFileSync(dataFile, 'utf8'))
      return {
        version: 2,
        teacher: parsed.teacher || settings.teacher,
        autoRecord: parsed.autoRecord === true,
        records: Array.isArray(parsed.records) ? parsed.records : [],
        courses: COURSES,
        updatedAt: parsed.updatedAt || null,
      }
    } catch {
      return {
        version: 2,
        teacher: settings.teacher,
        autoRecord: settings.autoRecord === true,
        records: [],
        courses: COURSES,
        updatedAt: null,
      }
    }
  }

  const data = loadData()

  function saveData() {
    ensureDir()
    data.updatedAt = new Date().toISOString()
    writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8')
  }

  const recordKey = (date, period, className) => `${date}#${period}#${className}`

  function findRecord(date, period, className) {
    const key = recordKey(date, period, className)
    return data.records.find((r) => recordKey(r.date, r.period, r.className) === key)
  }

  function upsertRecord(patch) {
    const now = new Date().toISOString()
    const existing = findRecord(patch.date, patch.period, patch.className)
    if (existing) {
      Object.assign(existing, patch, { updated: now })
      saveData()
      return existing
    }
    const record = Object.assign(
      {
        id: `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        date: patch.date,
        period: patch.period,
        className: patch.className,
        subject: SUBJECT,
        page: null,
        topic: '',
        note: '',
        pptName: '',
        pptPath: '',
        total: 0,
        firstSlide: null,
        lastSlide: null,
        auto: false,
        imported: false,
        created: now,
        updated: now,
      },
      patch,
    )
    data.records.push(record)
    saveData()
    return record
  }

  /* -------------------------------------------------------------- 探测 */

  let pptCache = { at: 0, value: { found: false, pending: true } }
  let pptInflight = null

  function timelineFor(date) {
    const wd = date.getDay()
    const courses = Array.isArray(data.courses) ? data.courses : COURSES
    return courses
      .filter((c) => c && c.d === wd && typeof c.className === 'string' && CLASSES.some(x => x.name === c.className) && Array.isArray(PERIODS[c.period]) && PERIODS[c.period].length === 2 && PERIODS[c.period].every(t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) && PERIODS[c.period][0] < PERIODS[c.period][1])
      .map((c) => {
        const [start, end] = PERIODS[c.period] || ['00:00', '00:00']
        const meta = CLASSES.find((x) => x.name === c.className)
        return {
          period: c.period,
          className: c.className,
          leader: meta ? meta.leader : '',
          subject: SUBJECT,
          start,
          end,
          startAt: atTime(date, start),
          endAt: atTime(date, end),
        }
      })
      .sort((a, b) => a.period - b.period)
  }

  /** 只有临近或正在上课时才值得启动 PowerShell 探测，其余时间直接复用缓存。 */
  function inLessonWindow(now) {
    const pad = 10 * 60 * 1000
    for (const e of timelineFor(now)) {
      if (now >= e.startAt - pad && now <= e.endAt + pad) return true
    }
    return false
  }

  function runProbe() {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') {
        resolve({ found: false, unsupported: true, at: new Date().toISOString() })
        return
      }
      ensureDir()
      try {
        writeFileSync(probeScript, PROBE_PS1, 'utf8')
      } catch {
        resolve({ found: false, error: '无法写入探测脚本', at: new Date().toISOString() })
        return
      }
      const outFile = join(dataDir, `probe-${process.pid}.json`)
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', probeScript, outFile],
        { timeout: 9000, windowsHide: true },
        () => {
          try {
            const parsed = JSON.parse(readFileSync(outFile, 'utf8'))
            const app = parsed && parsed.app
            resolve({
              found: Boolean(parsed && parsed.found && app),
              progid: app ? app.progid : null,
              name: app ? app.name : null,
              path: app ? app.path : null,
              slide: app ? Number(app.slide) || 0 : 0,
              total: app ? Number(app.total) || 0 : 0,
              at: (parsed && parsed.at) || new Date().toISOString(),
            })
          } catch {
            resolve({ found: false, error: 'probe-failed', at: new Date().toISOString() })
          } finally {
            try {
              unlinkSync(outFile)
            } catch { /* ignore */ }
          }
        },
      )
    })
  }

  function getPpt(force) {
    const now = Date.now()
    if (!data.autoRecord && !force) return Promise.resolve({ found: false, disabled: true })
    if (!force && now - pptCache.at < 2500) return Promise.resolve(pptCache.value)
    if (!force && !inLessonWindow(new Date(now)) && pptCache.value && pptCache.value.at) {
      return Promise.resolve(pptCache.value)
    }
    if (pptInflight) return pptInflight
    pptInflight = runProbe().then((value) => {
      pptCache = { at: Date.now(), value }
      pptInflight = null
      return value
    })
    return pptInflight
  }

  /* ---------------------------------------------------------- 课程推算 */

  function withStatus(entry, now) {
    const remainMs = entry.endAt - now
    const totalMs = entry.endAt - entry.startAt
    const elapsedMs = now - entry.startAt
    let status = 'later'
    if (remainMs <= 0) status = 'done'
    else if (elapsedMs >= 0) status = 'live'
    return {
      period: entry.period,
      className: entry.className,
      leader: entry.leader,
      subject: entry.subject,
      start: entry.start,
      end: entry.end,
      status,
      remainSec: Math.max(0, Math.round(remainMs / 1000)),
      elapsedPct: Math.min(100, Math.max(0, Math.round((elapsedMs / totalMs) * 100))),
      date: dateKey(entry.startAt),
    }
  }

  /* ------------------------------------------------------- 自动进度跟踪 */

  /** key → { date, period, className, firstSlide, lastSlide, topic, pptName, pptPath, total, endAt } */
  const tracked = new Map()

  function trackTick(ppt, now) {
    if (!data.autoRecord) { tracked.clear(); return }
    const dateStr = dateKey(now)
    for (const entry of timelineFor(now)) {
      const inside = now >= entry.startAt && now < entry.endAt
      const key = recordKey(dateStr, entry.period, entry.className)
      if (inside && ppt && ppt.found) {
        let t = tracked.get(key)
        if (!t) {
          t = {
            key,
            date: dateStr,
            period: entry.period,
            className: entry.className,
            firstSlide: ppt.slide || null,
            lastSlide: ppt.slide || null,
            topic: topicFromName(ppt.name),
            pptName: ppt.name || '',
            pptPath: ppt.path || '',
            total: ppt.total || 0,
            endAt: entry.endAt.getTime(),
          }
          tracked.set(key, t)
        } else {
          if (ppt.slide) {
            t.lastSlide = ppt.slide
            if (!t.firstSlide) t.firstSlide = ppt.slide
          }
          if (ppt.name) {
            t.pptName = ppt.name
            t.pptPath = ppt.path || t.pptPath
            t.total = ppt.total || t.total
            const guess = topicFromName(ppt.name)
            if (guess) t.topic = guess
          }
        }
      }
    }

    for (const [key, t] of tracked) {
      if (now.getTime() < t.endAt + settings.endGraceSec * 1000) continue
      const existing = findRecord(t.date, t.period, t.className)
      if (!data.autoRecord || (existing && (!existing.auto || existing.imported))) {
        tracked.delete(key)
        continue // 关掉自动记录，或用户手填过/导入过：不覆盖
      }
      if (existing && existing.auto && existing.page != null) {
        tracked.delete(key)
        continue
      }
      upsertRecord({
        date: t.date,
        period: t.period,
        className: t.className,
        page: t.lastSlide || null,
        topic: t.topic || '',
        pptName: t.pptName,
        pptPath: t.pptPath,
        total: t.total,
        firstSlide: t.firstSlide,
        lastSlide: t.lastSlide,
        auto: true,
      })
      tracked.delete(key)
    }
  }

  /* --------------------------------------------------------- xlsx 导入 */

  /**
   * 导入《高一授课进度》表：首行是 `0903周四` 形式的日期表头，
   * 第二列是班级，其后每列是该班当次的进度文本。
   *
   * 表格本身不记录节次，因此一律以 period = 0（不分节次）落库，
   * 与源表「一天一格」的粒度一致；不臆造成某一节。
   * 原始文字保留在 text 里，导出时原样回写，保证往返不失真。
   */
  function importWorkbook(buf, fileName) {
    const { sheetName, rows } = readXlsxFirstSheet(buf, fileName)
    if (!rows.length) throw new Error('工作表为空')

    const header = rows[0] || []
    let classCol = 1
    for (let c = 0; c < header.length; c++) {
      if (String(header[c] || '').includes('班级')) {
        classCol = c
        break
      }
    }

    const year = new Date().getFullYear()
    const columns = []
    for (let c = classCol + 1; c < header.length; c++) {
      const text = String(header[c] || '').trim()
      if (!text) continue
      // 0903周四 / 9.3周四 / 2026-09-03
      let m = /^(\d{2})(\d{2})/.exec(text)
      let month = null
      let day = null
      if (m) {
        month = Number(m[1])
        day = Number(m[2])
      } else {
        m = /(\d{1,2})[.\-/](\d{1,2})/.exec(text)
        if (m) {
          month = Number(m[1])
          day = Number(m[2])
        }
      }
      if (!month || !day || month > 12 || day > 31) continue
      columns.push({ col: c, month, day, label: text })
    }

    if (!columns.length) throw new Error('表头里没有找到「0903周四」这类日期列')

    let created = 0
    let updated = 0
    const warnings = []

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || []
      const className = String(row[classCol] || '').trim()
      if (!className) continue
      const leader = String(row[classCol - 1 >= 0 ? classCol - 1 : 0] || '').trim()

      for (const col of columns) {
        const text = String(row[col.col] || '').trim()
        if (!text) continue
        const dk = `${year}-${pad2(col.month)}-${pad2(col.day)}`
        const { topic, page } = parseProgressText(text)
        // 同一天同一班可能并存多条（不同节次），导入只认「导入来源」的那条，
        // 避免重复导入叠加出重复行。
        const existingImported = data.records.find(
          (x) => x.className === className && x.date === dk && x.imported && x.period === 0,
        )
        if (existingImported) {
          Object.assign(existingImported, {
            page,
            topic,
            text,
            rawText: text,
            leader,
            updated: new Date().toISOString(),
          })
          updated += 1
          continue
        }
        upsertRecord({
          date: dk,
          period: 0,
          className,
          page,
          topic,
          text,
          imported: true,
          auto: false,
          leader,
          rawText: text,
        })
        created += 1
      }
    }

    // 表头写的星期与真实日历不一致时提示（源表偶有笔误）
    for (const col of columns) {
      const wd = new Date(year, col.month - 1, col.day).getDay()
      const claimed = WEEKDAYS.findIndex((w) => col.label.includes(w))
      if (claimed >= 0 && claimed !== wd) {
        warnings.push(`${col.label}：表头写「${WEEKDAYS[claimed]}」，${year} 年实际是「${WEEKDAYS[wd]}」`)
      }
    }

    return { ok: true, sheetName, created, updated, warnings, dataFile }
  }

  /** 某天该老师有哪些节次（按节次升序），用于把导入列映射到节次。 */
  function courseSlotsForDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    return timelineFor(date).map((e) => ({ period: e.period, className: e.className }))
  }

  /* -------------------------------------------------------------- 状态 */

  async function buildState(options) {
    const now = new Date()
    const ppt = await getPpt(options && options.force)
    try {
      trackTick(ppt, now)
    } catch { /* ignore */ }

    const timeline = timelineFor(now).map((e) => withStatus(e, now))
    const current = timeline.find((e) => e.status === 'live') || null
    const next = timeline.find((e) => e.status === 'later') || null

    let justEnded = null
    if (!current) {
      for (const e of timeline) {
        if (e.status !== 'done') continue
        const endAt = atTime(now, e.end)
        const gapMin = (now - endAt) / 60000
        if (gapMin >= 0 && gapMin <= 12) justEnded = e
      }
    }

    const trackedView = {}
    for (const [k, t] of tracked) trackedView[k] = t

    return {
      ok: true,
      now: now.toISOString(),
      nowText: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
      date: dateKey(now),
      weekday: WEEKDAYS[now.getDay()],
      teacher: data.teacher,
      subject: SUBJECT,
      settings: { autoRecord: data.autoRecord },
      today: timeline,
      current,
      justEnded,
      next,
      ppt,
      tracked: trackedView,
      classes: CLASSES,
      shiftNames: SHIFT_NAMES,
      records: data.records,
      dataFile,
      importPath: settings.importPath || '',
      importPathExists: Boolean(settings.importPath && existsSync(settings.importPath)),
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

  function readBody(req, limit = 24 * 1024 * 1024) {
    return new Promise((resolve) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > limit) {
          req.destroy()
          resolve(null)
          return
        }
        chunks.push(c)
      })
      req.on('end', () => {
        if (!chunks.length) return resolve({})
        resolve(Buffer.concat(chunks))
      })
      req.on('error', () => resolve(null))
    })
  }

  async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    const p = url.pathname
    try {
      if (p === '/lesson-tracker/api/state') {
        const force = url.searchParams.get('force') === '1'
        sendJson(res, await buildState({ force }))
        return
      }

      if (p === '/lesson-tracker/api/record' && req.method === 'POST') {
        const raw = await readBody(req, 1_000_000)
        if (!raw) return sendJson(res, { ok: false, error: '请求体过大' }, 413)
        let body
        try {
          body = JSON.parse(raw.toString('utf8'))
        } catch {
          return sendJson(res, { ok: false, error: 'JSON 解析失败' }, 400)
        }
        if (!body || !body.date || !body.period || !body.className) {
          sendJson(res, { ok: false, error: '缺少日期/节次/班级' }, 400)
          return
        }
        const pageValue =
          body.page === '' || body.page === null || body.page === undefined ? null : Number(body.page)
        const rec = upsertRecord({
          date: String(body.date),
          period: Number(body.period),
          className: String(body.className),
          page: pageValue,
          topic: body.topic ? String(body.topic) : '',
          note: body.note ? String(body.note) : '',
          pptName: body.pptName ? String(body.pptName) : '',
          pptPath: body.pptPath ? String(body.pptPath) : '',
          total: Number(body.total) || 0,
          lastSlide: pageValue,
          auto: Boolean(body.auto),
          imported: false,
        })
        saveData()
        sendJson(res, { ok: true, record: rec })
        return
      }

      if (p === '/lesson-tracker/api/custom' && req.method === 'POST') {
        const raw = await readBody(req, 1_000_000)
        if (!raw) return sendJson(res, { ok: false, error: '请求体过大' }, 413)
        let body
        try {
          body = JSON.parse(raw.toString('utf8'))
        } catch {
          return sendJson(res, { ok: false, error: 'JSON 解析失败' }, 400)
        }
        if (!body || !body.className) return sendJson(res, { ok: false, error: '缺少班级' }, 400)
        const date = body.date ? String(body.date) : dateKey(new Date())
        const period = Number(body.period) || 0
        const pageValue =
          body.page === '' || body.page === null || body.page === undefined ? null : Number(body.page)
        const rec = upsertRecord({
          date,
          period,
          className: String(body.className),
          page: pageValue,
          topic: body.topic ? String(body.topic) : '',
          note: body.note ? String(body.note) : '',
          text: body.text ? String(body.text) : '',
          pptName: body.pptName ? String(body.pptName) : '',
          pptPath: body.pptPath ? String(body.pptPath) : '',
          total: Number(body.total) || 0,
          lastSlide: pageValue,
          auto: false,
          imported: false,
        })
        saveData()
        sendJson(res, { ok: true, record: rec })
        return
      }

      if (p === '/lesson-tracker/api/delete' && req.method === 'POST') {
        const raw = await readBody(req, 1_000_000)
        let body = {}
        try {
          body = JSON.parse(raw.toString('utf8'))
        } catch { /* ignore */ }
        const id = body && body.id
        const idx = data.records.findIndex((r) => r.id === id)
        if (idx >= 0) data.records.splice(idx, 1)
        saveData()
        sendJson(res, { ok: true })
        return
      }

      if (p === '/lesson-tracker/api/settings' && req.method === 'POST') {
        const raw = await readBody(req, 1_000_000)
        let body = {}
        try {
          body = JSON.parse(raw.toString('utf8'))
        } catch { /* ignore */ }
        if (body && typeof body.autoRecord === 'boolean') data.autoRecord = body.autoRecord
        if (body && typeof body.teacher === 'string' && body.teacher.trim()) data.teacher = body.teacher.trim()
        saveData()
        sendJson(res, { ok: true, settings: { autoRecord: data.autoRecord, teacher: data.teacher } })
        return
      }

      if (p === '/lesson-tracker/api/forget' && req.method === 'POST') {
        tracked.clear()
        sendJson(res, { ok: true })
        return
      }

      // 导入：请求体就是 xlsx 原始字节，文件名走 query
      if (p === '/lesson-tracker/api/import' && req.method === 'POST') {
        const buf = await readBody(req)
        if (!buf || !buf.length) return sendJson(res, { ok: false, error: '没有收到文件内容' }, 400)
        const fileName = url.searchParams.get('name') || 'upload.xlsx'
        try {
          const result = importWorkbook(buf, fileName)
          sendJson(res, result)
        } catch (error) {
          sendJson(res, { ok: false, error: String((error && error.message) || error) }, 400)
        }
        return
      }

      // 导入：Host 端直接读某个本地路径（方便直接用现有表格）
      if (p === '/lesson-tracker/api/import-path' && req.method === 'POST') {
        const raw = await readBody(req, 1_000_000)
        let body = {}
        try {
          body = JSON.parse(raw.toString('utf8'))
        } catch { /* ignore */ }
        const path = body && body.path
        if (!path || !existsSync(path)) {
          return sendJson(res, { ok: false, error: '文件不存在：' + (path || '(空)') }, 400)
        }
        try {
          const result = importWorkbook(readFileSync(path), basename(path))
          sendJson(res, result)
        } catch (error) {
          sendJson(res, { ok: false, error: String((error && error.message) || error) }, 400)
        }
        return
      }

      // 导出：把当前记录按原表格形态（班级行 × 日期列）生成 CSV，便于贴回 Excel
      if (p === '/lesson-tracker/api/export') {
        const csv = buildExportCsv()
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Content-Disposition', 'attachment; filename="lesson-tracker.csv"')
        res.end('\ufeff' + csv)
        return
      }

      sendJson(res, { ok: false, error: 'not found' }, 404)
    } catch (error) {
      sendJson(res, { ok: false, error: String((error && error.message) || error) }, 500)
    }
  }

  /** 与导入表同构：课代表 / 班级 / 日期列（每格原样写回或 `P48-题目`）。 */
  function buildExportCsv() {
    const dates = [...new Set(data.records.map((r) => r.date))].sort()
    const classes = CLASSES.map((c) => c.name)
    for (const r of data.records) if (!classes.includes(r.className)) classes.push(r.className)

    const headerCell = (dk) => {
      const [y, m, d] = dk.split('-').map(Number)
      const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()]
      return `${pad2(m)}${pad2(d)}${wd}`
    }
    const lines = []
    const esc = (v) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }
    lines.push(['课代表', '班级', ...dates.map(headerCell)].map(esc).join(','))
    for (const cls of classes) {
      const leader = (CLASSES.find((c) => c.name === cls) || {}).leader || ''
      const cells = dates.map((dk) => {
        const hits = data.records
          .filter((r) => r.className === cls && r.date === dk)
          .sort((a, b) => (a.period || 0) - (b.period || 0))
        if (!hits.length) return ''
        return hits.map(recordToText).filter(Boolean).join(' / ')
      })
      lines.push([leader, cls, ...cells].map(esc).join(','))
    }
    return lines.join('\r\n')
  }

  /**
   * 一条记录 → 表格文字。
   * 导入的记录若页码在末尾（如「草图-P13」），写回时也把页码放在末尾，
   * 保证与原表往返一致；否则用 `P48-正等轴测图` 的规范形态。
   */
  function recordToText(r) {
    const text = (r.text || r.rawText || '').trim()
    if (text) return text
    const page = r.page != null ? `P${r.page}` : ''
    const topic = r.topic || r.note || ''
    if (!page) return topic
    if (!topic) return page
    return `${page}-${topic}`
  }

  ctx.inject(['webServer'], (host) => {
    host.effect(
      () => host.webServer.register({ kind: 'prefix', path: '/lesson-tracker', handler }),
      'lesson-tracker: http api',
    )
  })

  // 后台心跳：下课自动落页码。20s 一次，开销可忽略。
  ctx.effect(() => {
    let busy = false
    const tick = () => {
      if (busy) return
      busy = true
      getPpt()
        .then((ppt) => {
          try {
            trackTick(ppt, new Date())
          } catch { /* ignore */ }
        })
        .finally(() => {
          busy = false
        })
    }
    tick()
    const timer = setInterval(tick, 20000)
    return () => clearInterval(timer)
  }, 'lesson-tracker: ticker')
}
