/**
 * dsh-exam-archive — Host half.
 *
 * 阅卷评分标准归档 + 备课组长提醒：
 *  1. 读「各年级各科任课教师名单…组长.xlsx」（自动挑最新一份），
 *     从每个年级 sheet 的末两列提取「科目 → 备课组长」映射。
 *  2. 扫描阅卷数据根目录下的考试文件夹（如 `20300101高一期末考`），
 *     逐科目目录判定主客观评分标准是否收齐（精确到子单元：技术 = 信息 + 通用）。
 *  3. 从用户配置的钉钉群按考试名拉取 `[文件] xx.xlsx fileId: …` 消息，
 *     下载到本地 staging 再复制归档到对应科目目录（dws 只允许写工作目录内相对路径）。
 *  4. 考试开始/结束时，对未收齐科目生成一对一 DM 提醒（默认 dry-run，只落日志，
 *     绝不真正发送；把 sendReminders 置 true 才真正发）。
 *
 * 考试时间：文件夹里的「…考试时间安排.png」仅作人工对照展示；每科时间以 UI 手动填
 * 写为主，落盘到 <DSH_HOME>/exam-archive/data.json。
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, stat, copyFile, writeFile, rename, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { readXlsxAllSheets } from './xlsx.js'

/* ------------------------------------------------------------------ 常量 */

// 科目关键词 → 规范科目名。用于（a）组长表末列科目归一化，（b）文件名 → 科目识别。
const SUBJECT_ALIASES = [
  { key: '语文', re: /语文/ },
  { key: '数学', re: /数学/ },
  { key: '英语', re: /英语|外语/ },
  { key: '物理', re: /物理/ },
  { key: '化学', re: /化学/ },
  { key: '生物', re: /生物/ },
  { key: '政治', re: /政治/ },
  { key: '历史', re: /历史/ },
  { key: '地理', re: /地理/ },
  { key: '信息', re: /信息|信息选/ },
  { key: '通用', re: /通用/ },
  { key: '技术', re: /技术/ },
]

// 年级关键词（高一/高二/高三），从文件夹名与文件名都能识别。
const GRADE_ALIASES = [
  { key: '高一', re: /高一|高一年级/ },
  { key: '高二', re: /高二|高二年级/ },
  { key: '高三', re: /高三|高三年级/ },
]

const pad2 = (n) => String(n).padStart(2, '0')

function dateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function nowText() {
  const d = new Date()
  return `${dateKey(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/* ------------------------------------------------------------------ 小工具 */

function pickSubject(text) {
  if (!text) return null
  for (const a of SUBJECT_ALIASES) if (a.re.test(text)) return a.key
  return null
}

function pickGrade(text) {
  if (!text) return null
  for (const a of GRADE_ALIASES) if (a.re.test(text)) return a.key
  return null
}

/** 文件是「主观」还是「客观」评分标准。 */
function pickKind(name) {
  if (/主观|划分要求/.test(name)) return 'subjective'
  if (/客观|答案及分值/.test(name)) return 'objective'
  return null
}

/**
 * 技术科文件归属的子单元：信息 或 通用。
 * - 含「信息」「信息选」「选考」→ 信息
 * - 含「通用」「学考」→ 通用
 * - 无法判断 → 技术（不拆）
 */
function techSubUnit(name) {
  if (/信息/.test(name)) return '信息'
  if (/通用/.test(name)) return '通用'
  if (/选考/.test(name)) return '信息'
  if (/学考/.test(name)) return '通用'
  return '技术'
}

/* ------------------------------------------------------------------ 配置 */

export function apply(ctx, config) {
  const settings = Object.assign(
    {
      archiveRoot: '',
      rosterDir: '',
      groupName: '',
      sendReminders: false,
      pollSec: 30,
      dwsCommand: 'dws',
    },
    config && typeof config === 'object' ? config : {},
  )

  const dataDir = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'exam-archive')
  const dataFile = join(dataDir, 'data.json')
  const stagingDir = join(dataDir, 'staging')

  async function ensureDir() {
    await mkdir(stagingDir, { recursive: true })
  }

  /* ------------------------------------------------------------------ 存储 */

  async function loadData() {
    try {
      const parsed = JSON.parse(await readFile(dataFile, 'utf8'))
      return {
        version: 1,
        activeExam: parsed.activeExam || null,
        examTimes: parsed.examTimes || {}, // { "<考试名>": { "<年级>|<科目>": {start, end} } }
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
        lastPoll: parsed.lastPoll || null,
      }
    } catch {
      return { version: 1, activeExam: null, examTimes: {}, reminders: [], lastPoll: null }
    }
  }

  let data
  // Handle initialization rejection immediately, even before the first HTTP request.
  const ready = loadData().then(value => { data = value })
  let saveQueue = Promise.resolve()

  async function saveData() {
    data.lastPoll = new Date().toISOString()
    const snapshot = JSON.stringify(data, null, 2)
    const pending = saveQueue.then(async () => {
      await ensureDir()
      const temp = dataFile + '.tmp'
      await writeFile(temp, snapshot, 'utf8')
      await rename(temp, dataFile)
    })
    saveQueue = pending.catch(() => {})
    await pending
  }

  /* ------------------------------------------------------------ 组长表解析 */

  let rosterCache = { at: 0, value: [] }

  /** 找到 rosterDir 下最新的一份「…组长.xlsx」。 */
  async function latestRosterFile() {
    if (!settings.rosterDir) return null
    const entries = await readdir(settings.rosterDir)
    const hits = entries.filter(n => /组长\.xlsx$/i.test(n) && !n.startsWith('~$'))
    const files = []
    for (const name of hits) {
      const info = await stat(join(settings.rosterDir, name))
      if (info.isFile()) files.push({ name, at: info.mtimeMs })
    }
    files.sort((a, b) => b.at - a.at)
    return files.length ? join(settings.rosterDir, files[0].name) : null
  }

  /**
   * 解析组长表：每个 sheet（年级）末两列 = 「科目 → 备课组长」。
   * 返回 [{ grade, subject, leader }]。
   */
  async function parseRoster(buf, fileName) {
    const { sheets } = await readXlsxAllSheets(buf, fileName)
    const out = []
    for (const sheet of sheets) {
      const grade = pickGrade(sheet.name || '') || null
      if (!grade) continue // 只处理真正的年级 sheet（跳过「一些提示词」等）
      const rows = sheet.rows || []
      // 先定位标题行：同时含「科目」与「姓名/组长」两列的那行。
      // 组长表的形态是「前 11 列 = 科目×老师矩阵，末两列 = 竖排的科目→组长映射」；
      // 纯名单 sheet（如「高一 (含分校)」）没有这两列，直接跳过，避免误判。
      let subjectCol = -1
      let nameCol = -1
      let headerIdx = -1
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || []
        const sc = row.findIndex((c) => /科目/.test(c || ''))
        const nc = row.findIndex((c) => /姓名|组长|备课组长/.test(c || ''))
        if (sc >= 0 && nc >= 0) {
          subjectCol = sc
          nameCol = nc
          headerIdx = i
          break
        }
      }
      if (headerIdx < 0) continue // 没有「科目→姓名」映射结构，跳过该 sheet
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i] || []
        const subjectRaw = String(row[subjectCol] || '').trim()
        const leaderRaw = String(row[nameCol] || '').trim()
        if (!subjectRaw || !leaderRaw) continue
        const subject = pickSubject(subjectRaw)
        if (!subject) continue
        const leader = leaderRaw.replace(/★/g, '').replace(/（.*?）|\(.*?\)/g, '').trim()
        if (!leader) continue
        out.push({ grade, subject, leader })
      }
    }
    // 去重（同年级同科目只保留一个）
    const seen = new Set()
    return out.filter((r) => {
      const k = `${r.grade}|${r.subject}|${r.leader}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }

  let rosterPending
  function getRoster(force) {
    if (!rosterPending) rosterPending = loadRoster(force).finally(() => { rosterPending = null })
    return rosterPending
  }
  async function loadRoster(force) {
    const now = Date.now()
    if (!force && now - rosterCache.at < 60_000) return rosterCache.value
    let file
    try { file = await latestRosterFile() } catch (e) {
      rosterCache = { at: now, value: [], file: null, error: String(e.message || e) }
      return []
    }
    if (!file) {
      rosterCache = { at: now, value: [], file: null, error: '找不到组长表（…组长.xlsx）' }
      return rosterCache.value
    }
    try {
      if ((await stat(file)).size > 32 * 1024 * 1024) throw new Error('组长表超过 32 MiB 限制')
      const parsed = await parseRoster(await readFile(file), basename(file))
      rosterCache = { at: now, value: parsed, file: basename(file), error: null }
    } catch (e) {
      rosterCache = { at: now, value: [], file: basename(file), error: String((e && e.message) || e) }
    }
    return rosterCache.value
  }

  function leaderFor(grade, subject, roster) {
    const hit = roster.find((r) => r.grade === grade && r.subject === subject)
    return hit ? hit.leader : ''
  }

  /**
   * 一个「年级 × 科目」对应的备课组长列表（可多位）。
   * 技术科 = 信息组长 + 通用组长两位；其余科目各一位。
   */
  function leadersFor(grade, subject, roster) {
    if (subject === '技术') {
      const info = leaderFor(grade, '信息', roster)
      const gen = leaderFor(grade, '通用', roster)
      const list = []
      if (info) list.push(info)
      if (gen) list.push(gen)
      // 去重 + 保序
      return [...new Set(list)]
    }
    const one = leaderFor(grade, subject, roster)
    return one ? [one] : []
  }

  /* ------------------------------------------------------------ 考试目录扫描 */

  /** 列出 archiveRoot 下形如「日期+考试名」的考试文件夹，按名称倒序（最新在前）。 */
  async function listExams() {
    if (!settings.archiveRoot) return []
    try {
      const names = (await readdir(settings.archiveRoot, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .filter((n) => /\d{8}/.test(n)) // 含 8 位日期
      names.sort().reverse()
      return names
    } catch (e) {
      throw new Error(`考试目录读取失败: ${e.message || e}`)
    }
  }

  /**
   * 某考试文件夹下的「收件单元」清单。
   *
   * 每个单元 = 一个「年级 × 子科目 × 目录」三元组，文件按主/客观归类。
   * 「技术」目录里的文件会按文件名再拆成「信息」和「通用」两个子单元
   * （信息选主/客 + 通用主/客 = 4 个文件，各配各的备课组长）。
   * 返回 [{ grade, subject, dir, files, subjective, objective, complete }]。
   */
  async function scanExam(examName) {
    if (typeof examName !== 'string' || !examName || /[\\/]/.test(examName) || examName === '.' || examName === '..') throw new Error('考试名无效')
    const examRoot = join(settings.archiveRoot, examName)
    const units = []
    try {
      const gradeDirs = (await readdir(examRoot, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
      for (const gd of gradeDirs) {
        const grade = pickGrade(gd) || gd
        const gradePath = join(examRoot, gd)
        const subDirs = (await readdir(gradePath, { withFileTypes: true }))
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
        for (const sd of subDirs) {
          const dirSubject = pickSubject(sd) || sd
          const unitPath = join(gradePath, sd)
          const files = (await readdir(unitPath)).filter((f) => !f.startsWith('~$') && /\.xlsx?$/i.test(f))
          if (dirSubject === '技术') {
            // 技术目录：按文件名拆「信息」/「通用」两组（学考/选考也归并到信息/通用）
            // Both technical subjects are required even when one has no files yet.
            // Otherwise an empty directory disappears, or one complete subject hides
            // the entirely missing other subject from the dashboard and reminders.
            const groups = new Map([['信息', []], ['通用', []]])
            for (const f of files) {
              const key = techSubUnit(f)
              if (!groups.has(key)) groups.set(key, [])
              groups.get(key).push(f)
            }
            for (const [subj, fs] of groups) {
              units.push(classifyUnit(grade, subj, `${gd}/${sd}`, unitPath, fs))
            }
          } else {
            units.push(classifyUnit(grade, dirSubject, `${gd}/${sd}`, unitPath, files))
          }
        }
      }
    } catch (e) { throw new Error(`考试扫描失败: ${e.message || e}`) }
    return units
  }

  /** 把一组文件按主/客观归类，产出收件单元。 */
  function classifyUnit(grade, subject, dir, path, files) {
    let sub = 0
    let obj = 0
    for (const f of files) {
      const kind = pickKind(f)
      if (kind === 'subjective') sub += 1
      else if (kind === 'objective') obj += 1
    }
    return {
      grade,
      subject,
      dir,
      path,
      files,
      subjective: sub,
      objective: obj,
      complete: sub >= 1 && obj >= 1,
    }
  }

  /** 考试整体收件概览：按「年级 × 科目」聚合子单元。 */
  async function examStatus(examName) {
    const units = await scanExam(examName)
    const roster = await getRoster(false)
    // 合并同「年级×科目」下的多个子单元（如 技术 → 信息/通用）
    const map = new Map()
    for (const u of units) {
      const key = `${u.grade}|${u.subject}`
      if (!map.has(key)) map.set(key, { grade: u.grade, subject: u.subject, units: [] })
      map.get(key).units.push(u)
    }
    const subjects = []
    for (const [key, s] of map) {
      const perUnit = s.units.map((u) => ({
        dir: u.dir,
        subjective: u.subjective,
        objective: u.objective,
        complete: u.complete,
        files: u.files,
      }))
      const complete = perUnit.every((u) => u.complete)
      const leaders = leadersFor(s.grade, s.subject, roster)
      const times = data.examTimes[examName] || {}
      const t = times[key] || {}
      subjects.push({
        grade: s.grade,
        subject: s.subject,
        leaders,
        leader: leaders.join('、'),
        start: t.start || '',
        end: t.end || '',
        complete,
        units: perUnit,
      })
    }
    subjects.sort((a, b) => (a.grade === b.grade ? a.subject.localeCompare(b.subject, 'zh') : a.grade.localeCompare(b.grade, 'zh')))
    const total = subjects.length
    const done = subjects.filter((s) => s.complete).length
    return { examName, total, done, complete: done >= total && total > 0, subjects }
  }

  /* ------------------------------------------------------------ 提醒预演 */

  /**
   * 生成考试开始/结束时未收齐科目的提醒文案（不发送）。
   * phase: 'start' | 'end'
   */
  async function buildReminders(examName, phase) {
    const status = await examStatus(examName)
    const now = nowText()
    const out = []
    for (const s of status.subjects) {
      if (s.complete) continue
      const leaders = s.leaders && s.leaders.length ? s.leaders : ['']
      for (const leader of leaders) {
        const text = phase === 'start'
          ? `【阅卷提醒】${examName}·${s.grade}${s.subject}：该场考试已开始，请尽快提交主客观评分标准。`
          : `【阅卷提醒】${examName}·${s.grade}${s.subject}：该场考试已结束，请尽快提交主客观评分标准，否则会影响扫卷阅卷进度。`
        out.push({
          phase,
          grade: s.grade,
          subject: s.subject,
          leader: leader,
          to: leader,
          text,
          dryRun: !settings.sendReminders,
          at: now,
        })
      }
    }
    return out
  }

  /** 落一份提醒记录（dry-run 也记录，标注未发送）。 */
  async function recordReminders(examName, phase) {
    const list = await buildReminders(examName, phase)
    for (const r of list) {
      data.reminders.push({
        id: `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        examName,
        ...r,
        sent: false,
      })
    }
    // 只保留最近 500 条，避免无限增长
    if (data.reminders.length > 500) data.reminders = data.reminders.slice(-500)
    await saveData()
    return list
  }

  /* ------------------------------------------------------------ dws 调用 */

  // dws 的真实可执行入口：优先 node 直接跑包内 bin/dws.js（绕过 .cmd/.ps1 引号问题）。
  async function dwsEntry() {
    const candidate = join(process.env.APPDATA || homedir(), 'npm', 'node_modules', 'dingtalk-workspace-cli', 'bin', 'dws.js')
    try { await access(candidate); return candidate } catch { return null }
  }

  /** 跑 dws（用 --format json），返回 { code, stdout, stderr }。 */
  async function runDws(args, cwd) {
    const workdir = cwd || stagingDir
    try { await mkdir(workdir, { recursive: true }) } catch (e) {
      return { code: 1, stdout: '', stderr: String(e.message || e) }
    }
    const DWS_ENTRY = await dwsEntry()
    return new Promise((resolve) => {

      const done = (err, stdout, stderr) => {
        resolve({
          code: err ? (err.code || 1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        })
      }
      const options = {
        cwd: workdir,
        windowsHide: true,
        timeout: 180_000,
        maxBuffer: 64 * 1024 * 1024,
        env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }),
      }

      try {
        if (DWS_ENTRY) {
          // Desktop execPath is Electron; RUN_AS_NODE may be disabled by its fuse.
          // Use a standalone Node from PATH and fail normally if it is unavailable.
          execFile(process.versions.electron ? 'node' : process.execPath, [DWS_ENTRY, ...args], options, done)
        } else {
          execFile(settings.dwsCommand, args, options, done)
        }
      } catch (e) { done(e, '', String(e.message || e)) }
    })
  }

  /** 从群拉取最新消息，返回文件消息列表 [{ name, fileId, sender, time }]。 */
  async function fetchGroupFiles(groupName, hoursBack = 72) {
    if (!groupName || !groupName.trim()) return { ok: false, error: '请先配置 groupName' }
    const since = new Date(Date.now() - hoursBack * 3600_000)
    const start = `${dateKey(since)} 00:00:00`
    const res = await runDws([
      'chat', '+chat-messages', '--group', groupName, '--no-reactions',
      '--start', start, '--page-all', '--order', 'desc', '--format', 'json',
    ])
    if (res.code !== 0) return { ok: false, error: res.stderr || res.stdout || 'dws 调用失败', raw: res }
    let parsed
    try {
      parsed = JSON.parse(res.stdout)
    } catch {
      return { ok: false, error: 'dws 输出不是 JSON', raw: res.stdout.slice(0, 500) }
    }
    const files = []
    const msgs = parsed && Array.isArray(parsed.messages) ? parsed.messages : []
    for (const m of msgs) {
      if (!m || typeof m !== 'object') continue
      const text = String(m.text || '')
      const fm = /\[文件\]\s*(.+?)\s+fileId:\s*([A-Za-z0-9+/=]+)/.exec(text)
      if (fm) {
        files.push({ name: fm[1].trim(), fileId: fm[2], sender: m.sender || '', time: m.createTime || '' })
      }
    }
    return { ok: true, files }
  }

  /**
   * 下载一个 fileId 到 staging，返回 staging 里实际落盘的新文件完整路径。
   * dws 只允许写「工作目录内相对路径」，因此先把文件下到 stagingDir，
   * 再 diff 出新增文件。下载后用消息里的原名重命名，保证后续按名识别科目。
   */
  async function downloadFile(fileId, name) {
    if (typeof name !== 'string' || !name || /[\\/]/.test(name) || name === '.' || name === '..') {
      return { ok: false, fileId, name, error: '文件名不安全' }
    }
    await ensureDir()
    // 记录下载前 staging 已有文件快照
    const before = new Set()
    try {
      for (const f of await readdir(stagingDir)) before.add(f)
    } catch { /* ignore */ }

    const res = await runDws([
      'chat', '+messages-resource-download', '--type', 'fileId',
      '--resource-id', fileId, '--output', '.', '--format', 'json',
    ])
    if (res.code !== 0) {
      return { ok: false, fileId, name, error: (res.stderr || res.stdout || '下载失败').slice(0, 400) }
    }

    // diff 出新文件
    let newFile = null
    try {
      for (const f of (await readdir(stagingDir))) {
        if (!before.has(f)) { newFile = f; break }
      }
    } catch { /* ignore */ }

    if (!newFile) return { ok: false, fileId, name, error: '下载后未在 staging 找到新文件' }

    // 用原名重命名（覆盖同名），保证后续识别用原名
    const src = join(stagingDir, newFile)
    const dst = join(stagingDir, name)
    if (src !== dst) {
      try { await rename(src, dst) } catch {
        try { await copyFile(src, dst) } catch (e) {
          return { ok: false, fileId, name, error: String(e.message || e) }
        }
      }
    }
    return { ok: true, fileId, name, path: dst }
  }

  /**
   * 把一个文件归档到对应科目目录。
   * 用文件名识别年级 + 科目，落入 archiveRoot/<考试名>/<年级目录>/<序号科目目录>/。
   * 找不到对应科目目录时，落到考试根目录下的「_未归档」目录，避免丢失。
   */
  async function archiveFile(examName, filePath, fileName) {
    const grade = pickGrade(fileName)
    const subject = pickSubject(fileName)
    if (!grade || !subject) {
      return { ok: false, fileName, reason: '无法识别年级或科目' }
    }

    const examRoot = join(settings.archiveRoot, examName)
    // 找年级目录 + 匹配科目目录
    let targetDir = null
    try {
      const gradeDirs = (await readdir(examRoot, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
      for (const gd of gradeDirs) {
        if (pickGrade(gd) !== grade) continue
        const gradePath = join(examRoot, gd)
        const subDirs = (await readdir(gradePath, { withFileTypes: true }))
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
        for (const sd of subDirs) {
          const ds = pickSubject(sd)
          // 科目匹配：目录科目 == 文件名科目，或（目录是技术 且 文件名是信息/通用）
          if (ds === subject || (ds === '技术' && (subject === '信息' || subject === '通用'))) {
            targetDir = join(gradePath, sd)
            break
          }
        }
        if (targetDir) break
      }
    } catch { /* ignore */ }

    if (!targetDir) {
      // 兜底：落到 _未归档
      const fallback = join(examRoot, '_未归档')
      await mkdir(fallback, { recursive: true })
      targetDir = fallback
    }

    if (typeof fileName !== 'string' || basename(fileName) !== fileName || /[\\/]/.test(fileName)) throw new Error('文件名无效')
    const dest = join(targetDir, fileName)
    try {
      await copyFile(filePath, dest)
      return { ok: true, fileName, dest }
    } catch (e) {
      return { ok: false, fileName, reason: String((e && e.message) || e) }
    }
  }

  /* ---------------------------------------------------------------- HTTP */

  function sendJson(res, body, code = 200) {
    if (res.destroyed || res.writableEnded) return
    const text = JSON.stringify(body)
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(text)
  }

  function readBody(req, limit = 2 * 1024 * 1024) {
    return new Promise((resolve) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > limit) { req.destroy(); resolve(null); return }
        chunks.push(c)
      })
      req.on('aborted', () => resolve(null))
      req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0)))
      req.on('error', () => resolve(null))
    })
  }

  let actionBusy = false
  let stateBusy = false
  async function handler(req, res) {
    const mutating = req.method === 'POST'
    if (mutating && actionBusy) return sendJson(res, { ok: false, error: '上一项操作仍在进行' }, 409)
    if (!mutating && stateBusy) return sendJson(res, { ok: false, error: '状态仍在读取，请稍后重试' }, 503)
    if (mutating) actionBusy = true
    else stateBusy = true
    try {
      await ready
      const url = new URL(req.url || '/', 'http://localhost')
      const p = url.pathname
      if (req.method === 'POST' && !settings.archiveRoot && p !== '/exam-archive/api/fetch') {
        return sendJson(res, { ok: false, error: '请先配置 archiveRoot' }, 400)
      }
      if (p === '/exam-archive/api/state') {
        const exams = await listExams()
        const active = data.activeExam
        const roster = await getRoster(false)
        const state = {
          ok: true,
          settings: {
            archiveRoot: settings.archiveRoot,
            groupName: settings.groupName,
            sendReminders: settings.sendReminders,
            pollSec: settings.pollSec,
          },
          roster: { file: rosterCache.file || null, error: rosterCache.error || null, count: roster.length, rows: roster },
          exams,
          activeExam: active,
          activeStatus: active ? await examStatus(active) : null,
          reminders: data.reminders.slice(-50).reverse(),
          now: nowText(),
        }
        sendJson(res, state)
        return
      }

      if (p === '/exam-archive/api/activate' && req.method === 'POST') {
        const raw = await readBody(req)
        if (raw === null) return sendJson(res, { ok: false, error: '请求体读取失败或过大' }, 400)
        let body
        try { body = JSON.parse(raw.toString('utf8')) } catch { return sendJson(res, { ok: false, error: '无效 JSON' }, 400) }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, { ok: false, error: '请求体必须为对象' }, 400)
        const examName = body && body.examName
        if (!examName) return sendJson(res, { ok: false, error: '缺少考试名' }, 400)
        if (!(await listExams()).includes(examName)) return sendJson(res, { ok: false, error: '考试文件夹不存在：' + examName }, 400)
        data.activeExam = examName
        if (!data.examTimes[examName]) data.examTimes[examName] = {}
        await saveData()
        sendJson(res, { ok: true, activeExam: examName, status: await examStatus(examName) })
        return
      }

      if (p === '/exam-archive/api/times' && req.method === 'POST') {
        const raw = await readBody(req)
        if (raw === null) return sendJson(res, { ok: false, error: '请求体读取失败或过大' }, 400)
        let body
        try { body = JSON.parse(raw.toString('utf8')) } catch { return sendJson(res, { ok: false, error: '无效 JSON' }, 400) }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, { ok: false, error: '请求体必须为对象' }, 400)
        const examName = body.examName || data.activeExam
        if (!examName) return sendJson(res, { ok: false, error: '缺少考试名' }, 400)
        if (!data.examTimes[examName]) data.examTimes[examName] = {}
        if (body && body.entry) {
          const { grade, subject, start, end } = body.entry
          const key = `${grade}|${subject}`
          data.examTimes[examName][key] = { start: start || '', end: end || '' }
        }
        await saveData()
        sendJson(res, { ok: true, examTimes: data.examTimes[examName] })
        return
      }

      if (p === '/exam-archive/api/scan' && req.method === 'POST') {
        const raw = await readBody(req)
        if (raw === null) return sendJson(res, { ok: false, error: '请求体读取失败或过大' }, 400)
        let body
        try { body = JSON.parse(raw.toString('utf8')) } catch { return sendJson(res, { ok: false, error: '无效 JSON' }, 400) }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, { ok: false, error: '请求体必须为对象' }, 400)
        const examName = body.examName || data.activeExam
        if (!examName) return sendJson(res, { ok: false, error: '缺少考试名' }, 400)
        sendJson(res, { ok: true, status: await examStatus(examName) })
        return
      }

      if (p === '/exam-archive/api/fetch' && req.method === 'POST') {
        const raw = await readBody(req)
        if (raw === null) return sendJson(res, { ok: false, error: '请求体读取失败或过大' }, 400)
        let body
        try { body = JSON.parse(raw.toString('utf8')) } catch { return sendJson(res, { ok: false, error: '无效 JSON' }, 400) }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, { ok: false, error: '请求体必须为对象' }, 400)
        const hoursBack = Number(body.hoursBack) || 72
        const r = await fetchGroupFiles(settings.groupName, hoursBack)
        sendJson(res, r)
        return
      }

      if (p === '/exam-archive/api/archive' && req.method === 'POST') {
        const raw = await readBody(req)
        if (raw === null) return sendJson(res, { ok: false, error: '请求体读取失败或过大' }, 400)
        let body
        try { body = JSON.parse(raw.toString('utf8')) } catch { return sendJson(res, { ok: false, error: '无效 JSON' }, 400) }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, { ok: false, error: '请求体必须为对象' }, 400)
        const examName = body.examName || data.activeExam
        const hoursBack = Number(body.hoursBack) || 72
        if (!examName) return sendJson(res, { ok: false, error: '缺少考试名' }, 400)
        // Resolve against existing exam folders before any download or filesystem write.
        if (!(await listExams()).includes(examName)) return sendJson(res, { ok: false, error: '考试文件夹不存在' }, 400)

        const fetched = await fetchGroupFiles(settings.groupName, hoursBack)
        if (!fetched.ok) return sendJson(res, fetched)

        const results = []
        const seenNames = new Set()
        for (const f of fetched.files) {
          // Messages are requested newest first. Never let an older attachment
          // with the same Windows filename overwrite the newest version.
          const normalizedName = f.name.toLowerCase()
          if (seenNames.has(normalizedName)) {
            results.push({ ok: false, name: f.name, reason: '同名旧版本，跳过' }); continue
          }
          seenNames.add(normalizedName)
          // 只归档评分标准类文件（主观题/客观题），跳过其他（如插件 zip、条形码）
          const kind = pickKind(f.name)
          if (!kind) { results.push({ ok: false, name: f.name, reason: '非评分标准文件，跳过' }); continue }
          const dl = await downloadFile(f.fileId, f.name)
          if (!dl.ok) { results.push(dl); continue }
          const ar = await archiveFile(examName, dl.path, f.name)
          results.push(ar)
        }
        const done = results.filter((r) => r.ok).length
        const failed = results.length - done
        sendJson(res, { ok: true, examName, total: results.length, done, failed, results })
        return
      }

      if (p === '/exam-archive/api/remind' && req.method === 'POST') {
        const raw = await readBody(req)
        if (raw === null) return sendJson(res, { ok: false, error: '请求体读取失败或过大' }, 400)
        let body
        try { body = JSON.parse(raw.toString('utf8')) } catch { return sendJson(res, { ok: false, error: '无效 JSON' }, 400) }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, { ok: false, error: '请求体必须为对象' }, 400)
        const examName = body.examName || data.activeExam
        const phase = body.phase === 'end' ? 'end' : 'start'
        if (!examName) return sendJson(res, { ok: false, error: '缺少考试名' }, 400)
        const list = await recordReminders(examName, phase)
        const willSend = settings.sendReminders
        // 若开启发送，才真正一对一 DM（默认关，这里只预演）
        if (willSend) {
          for (const r of list) {
            if (!r.to) continue
            await runDws([
              'chat', '+dm', '--to', r.to, '--content', r.text, '--format', 'json',
            ])
          }
        }
        sendJson(res, { ok: true, sent: willSend, count: list.length, reminders: list })
        return
      }

      sendJson(res, { ok: false, error: 'not found' }, 404)
    } catch (error) {
      sendJson(res, { ok: false, error: String((error && error.message) || error) }, 500)
    } finally { if (mutating) actionBusy = false; else stateBusy = false }
  }

  ctx.inject(['webServer'], (host) => {
    // Styles are owned by the Client component; no unowned CSS route remains.

    host.effect(
      () => host.webServer.register({ kind: 'prefix', path: '/exam-archive', handler }),
      'exam-archive: http api',
    )
  })
}
