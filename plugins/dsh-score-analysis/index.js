/**
 * 小题成绩分析 · Host 半端
 *
 * 把「成绩分析」项目里的“小题成绩处理”搬进 DSH：
 *  1. 接收 .xls / .xlsx / .zip 原始小题分成绩（压缩包自动提取 `全体报表/小题分(...).xls`）；
 *  2. 用教学班映射表生成信息/通用教学班分类（映射表可由面板导入并记住，也可在配置里指定）；
 *  3. 调用内置 Python 分析核心产出分析工作簿、成绩单 PDF 压缩包与结构化结果；
 *  4. 提供下载、草图标红阈值重生成，以及考试项目的保存 / 改名 / 删除 / 读取。
 *
 * 所有落盘状态都在 <DSH_HOME>/score-analysis，重启后仍在；成绩本身不写进会话日志。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, stat, copyFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PYTHON_DIR = join(HERE, 'python')
const RUNNER = join(PYTHON_DIR, 'run_analysis.py')

const MAX_SHEET_BYTES = 32 * 1024 * 1024
const MAX_ZIP_BYTES = 100 * 1024 * 1024
const MAX_SAVED_RESULT_BYTES = 50 * 1024 * 1024
const MAX_UPLOAD_BODY = 128 * 1024 * 1024
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const ZIP_MIME = 'application/zip'

// 与旧站 api.examAnalysis 保存的字段保持一致，方便迁移历史项目。
const SAVED_RESULT_KEYS = [
  'ok',
  'summary',
  'warnings',
  'class_averages',
  'info_analysis',
  'general_analysis',
  'info_teaching_analysis',
  'general_teaching_analysis',
  'question_choice_distributions',
  'question_choice_distributions_by_group',
  'report_cards_count',
  'reportCardsError',
  'reportCardsError',
  'teachingAdvice',
  'outputFilename',
  'sourceFilename',
  'extractedFilename',
  'extractedEntryName',
  'downloadFilename',
  'downloadUrl',
  'reportCardsFilename',
  'reportCardsDownloadFilename',
  'reportCardsUrl',
  'mappingSource',
]

const DEFAULT_SETTINGS = {
  pythonPath: '',
  timeoutMs: 240000,
  mappingFile: '',
  classes: [],
}

/* ------------------------------------------------------------------ 小工具 */

const pad2 = (n) => String(n).padStart(2, '0')

function timestamp() {
  const d = new Date()
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  )
}

function nowText() {
  const d = new Date()
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  )
}

const normalizeText = (value) => String(value ?? '').trim()

function httpError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

/* --------------------------------------------------- 教学班映射（兼容旧实现） */

function classifyTeachingClassName(className) {
  const text = normalizeText(className)
  if (/信|信息|职/.test(text)) return 'info'
  if (/通|通用|劳/.test(text)) return 'general'
  return 'other'
}

function sortTeachingClasses(values) {
  return [...new Set(values.map(normalizeText).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN', { numeric: true }),
  )
}

/**
 * 把「班级 → 学生 → 教学班」关系整理成 班级/姓名/教学班1/教学班2 的行。
 * 与旧站 buildTeachingClassMappingRows 一致：信息班在前、通用班其次。
 */
export function buildTeachingClassMappingRows(classes) {
  const studentMap = new Map()

  for (const cls of classes || []) {
    const className = normalizeText(cls?.name)
    if (!className) continue
    for (const student of cls?.students || []) {
      const name = normalizeText(student?.name)
      const homeClass = normalizeText(student?.homeClass)
      if (!name || !homeClass) continue
      const key = `${homeClass}|||${name}`
      if (!studentMap.has(key)) {
        studentMap.set(key, { homeClass, name, info: [], general: [], other: [] })
      }
      studentMap.get(key)[classifyTeachingClassName(className)].push(className)
    }
  }

  return [...studentMap.values()]
    .map((row) => {
      const info = sortTeachingClasses(row.info)
      const general = sortTeachingClasses(row.general)
      const other = sortTeachingClasses(row.other)
      return {
        班级: row.homeClass,
        姓名: row.name,
        教学班1: info[0] || '',
        教学班2: general[0] || other[0] || '',
      }
    })
    .sort(
      (a, b) =>
        a.班级.localeCompare(b.班级, 'zh-Hans-CN', { numeric: true }) ||
        a.姓名.localeCompare(b.姓名, 'zh-Hans-CN'),
    )
}

/* ------------------------------------------------------- 文件名 / 显示名 */

function sanitizeLabel(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripExtension(name) {
  const ext = extname(name || '')
  return ext ? name.slice(0, -ext.length) : name
}

export function buildAnalysisDisplayName(originalFilename, extractedEntryName = null) {
  const ext = extname(originalFilename || '').toLowerCase()

  if (ext === '.zip' && extractedEntryName) {
    const examTitle = sanitizeLabel(
      stripExtension(originalFilename).replace(/^\d{6,}/, '').split('_原始成绩')[0],
    )
    const baseName = (extractedEntryName.split('/').pop() || extractedEntryName).replace(/\\/g, '/')
    const subjectStem = stripExtension(baseName)
    const subjectMatch = subjectStem.match(/^小题分[（(](.+)[）)]$/)
    const subject = sanitizeLabel(subjectMatch?.[1] || subjectStem)
    return `${examTitle || '小题成绩'}+${subject || '成绩'}`
  }

  return sanitizeLabel(stripExtension(originalFilename)) || '小题成绩分析'
}

export function sanitizeAttachmentName(name, extension = '.xlsx') {
  let safe = sanitizeLabel(name) || `小题成绩分析${extension}`
  if (!safe.toLowerCase().endsWith(extension.toLowerCase())) safe += extension
  if (safe.length <= 150) return safe
  return `${safe.slice(0, 150 - extension.length).replace(/\s+$/, '') || '小题成绩分析'}${extension}`
}

function sanitizeStoredFilename(name) {
  const ext = extname(name || '').toLowerCase()
  const stem = stripExtension(name || 'exam').replace(/[^\p{L}\p{N}._-]+/gu, '_')
  return `${stem || 'exam'}${ext}`
}

export function isAllowedWorkbookName(name) {
  return ['.xls', '.xlsx'].includes(extname(name || '').toLowerCase())
}

export function isAllowedUploadName(name) {
  return ['.xls', '.xlsx', '.zip'].includes(extname(name || '').toLowerCase())
}

function isScoreWorkbookZipEntry(name) {
  const normalized = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const parts = normalized.split('/').filter(Boolean)
  const base = parts[parts.length - 1] || ''
  return parts.includes('全体报表') && /^小题分[（(].+[）)]\.xlsx?$/i.test(base)
}

/** 在压缩包条目里挑出真正的小题分工作簿（优先“技术（选）”）。 */
export function findScoreWorkbookEntry(names) {
  const candidates = (names || [])
    .filter(isScoreWorkbookZipEntry)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))
  if (candidates.length === 0) return null
  return (
    candidates.find((name) => /小题分[（(]技术[（(]选[）)][）)]\.xlsx?$/i.test(name)) || candidates[0]
  )
}

/* ------------------------------------------------------------- 错误归一化 */

const ANALYSIS_ERROR_RULES = [
  {
    test: /ModuleNotFoundError: No module named ['"](pandas|openpyxl)['"]/,
    message: '运行环境缺少成绩分析依赖，请为该 Python 安装 pandas 与 openpyxl。',
    statusCode: 500,
  },
  {
    test: /缺少成绩单 PDF 生成依赖|No module named ['"]reportlab['"]/,
    message: '缺少成绩单 PDF 依赖 reportlab，请在该 Python 环境安装 reportlab 后再导出成绩单。',
    statusCode: 500,
  },
  {
    test: /成绩表列数不足|未找到完整的学生基础字段/,
    message: '这不像原始小题分成绩文件，请上传成绩平台导出的学生小题分原始表。',
    statusCode: 400,
  },
  {
    test: /Excel file format cannot be determined|Unsupported format|Import xlrd failed/,
    message: '文件内容无法识别为 Excel 成绩表，请重新导出 .xls 或 .xlsx 后再上传。',
    statusCode: 400,
  },
]

export function formatAnalysisError(error) {
  const text = `${error?.message || ''}\n${error?.detail || ''}`
  for (const rule of ANALYSIS_ERROR_RULES) {
    if (rule.test.test(text)) return { message: rule.message, statusCode: rule.statusCode }
  }
  // 文件系统的原始错误会带上本机的完整路径，对使用者没有意义，换成可操作的提示。
  if (error?.code === 'ENOENT' || /ENOENT: no such file or directory/.test(text)) {
    return {
      message: '分析工作目录不存在或已被清理，请重新上传成绩文件再试一次。',
      statusCode: 500,
    }
  }
  if (error?.code === 'EACCES' || error?.code === 'EPERM' || /EACCES|EPERM/.test(text)) {
    return { message: '没有权限写入分析工作目录，请检查该目录的访问权限。', statusCode: 500 }
  }
  if (error?.code === 'ENOSPC') {
    return { message: '磁盘空间不足，无法写入分析结果。', statusCode: 507 }
  }
  return {
    message: error?.message || '小题成绩处理失败',
    statusCode: Number(error?.statusCode) || 500,
  }
}

/* ------------------------------------------------------------ 教学建议生成 */

const getTableRows = (table) => (Array.isArray(table?.data) ? table.data : [])
const getTableColumns = (table) => (Array.isArray(table?.columns) ? table.columns : [])

function getRowName(table, row) {
  const first = getTableColumns(table)[0]
  return first ? String(row?.[first] ?? '') : ''
}

function toScore(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Number(number.toFixed(2)) : null
}

function getOverallRow(table) {
  return getTableRows(table).find((row) => getRowName(table, row) === '总平均值') || null
}

function buildLowQuestions(table, subject) {
  const columns = getTableColumns(table)
  const first = columns[0]
  const overall = getOverallRow(table)
  if (!overall) return []
  const excluded = new Set([first, subject])
  return columns
    .filter((column) => column && !excluded.has(column))
    .map((column) => ({ subject, question: column, average: toScore(overall[column]) }))
    .filter((item) => item.average !== null)
    .sort((a, b) => a.average - b.average)
}

function buildWeakClasses(table) {
  const first = getTableColumns(table)[0]
  if (!first) return []
  return getTableRows(table)
    .filter((row) => getRowName(table, row) && getRowName(table, row) !== '总平均值')
    .map((row) => ({
      className: getRowName(table, row),
      fullScore: toScore(row['全卷']),
      infoScore: toScore(row['信息']),
      generalScore: toScore(row['通用']),
    }))
    .filter((item) => item.fullScore !== null)
    .sort((a, b) => a.fullScore - b.fullScore)
}

function buildSubjectFocus(table) {
  const overall = getOverallRow(table)
  if (!overall) return null
  const infoScore = toScore(overall['信息'])
  const generalScore = toScore(overall['通用'])
  if (infoScore === null || generalScore === null) return null
  return infoScore <= generalScore
    ? {
        subject: '信息',
        score: infoScore,
        comparedWith: '通用',
        comparedScore: generalScore,
        gap: toScore(generalScore - infoScore),
      }
    : {
        subject: '通用',
        score: generalScore,
        comparedWith: '信息',
        comparedScore: infoScore,
        gap: toScore(infoScore - generalScore),
      }
}

export function buildTeachingAdvice(payload) {
  const lowQuestions = [
    ...buildLowQuestions(payload?.info_analysis, '信息'),
    ...buildLowQuestions(payload?.general_analysis, '通用'),
  ]
    .sort((a, b) => a.average - b.average)
    .slice(0, 8)

  const weakClasses = buildWeakClasses(payload?.class_averages).slice(0, 3)
  const subjectFocus = buildSubjectFocus(payload?.class_averages)

  const summaryCards = []
  if (lowQuestions[0]) {
    summaryCards.push({
      label: '优先讲评',
      value: lowQuestions[0].question,
      note: `${lowQuestions[0].subject}均分 ${lowQuestions[0].average}`,
    })
  }
  if (subjectFocus) {
    summaryCards.push({
      label: '学科侧重',
      value: subjectFocus.subject,
      note: `比${subjectFocus.comparedWith}低 ${subjectFocus.gap} 分`,
    })
  }
  if (weakClasses[0]) {
    summaryCards.push({
      label: '关注班级',
      value: weakClasses[0].className,
      note: `全卷均分 ${weakClasses[0].fullScore}`,
    })
  }

  return { summaryCards, lowQuestions, weakClasses, subjectFocus }
}

/* ------------------------------------------------------------------ 存储 */

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJsonAtomic(file, value) {
  await ensureDir(dirname(file))
  const temp = `${file}.${Date.now()}.tmp`
  await writeFile(temp, JSON.stringify(value), 'utf8')
  await rename(temp, file)
}

/* -------------------------------------------------------------- 插件主体 */

export function apply(ctx, config) {
  const settings = { ...DEFAULT_SETTINGS, ...(config && typeof config === 'object' ? config : {}) }
  const dataDir = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'score-analysis')
  const outputDir = join(dataDir, 'outputs')
  const projectFile = join(dataDir, 'projects.json')
  const savedMappingFile = join(dataDir, 'teaching-mapping.xlsx')

  // 目录可能在运行期被清理或由外部删除，所以每次用到前都幂等地补建一次，
  // 不能只在插件激活时 mkdir 一次。
  const ready = () => ensureDir(outputDir)

  let projects = []
  const projectsLoaded = readJson(projectFile, []).then((value) => {
    projects = Array.isArray(value) ? value : []
  })

  const saveProjects = () => writeJsonAtomic(projectFile, projects)
  let analyzing = false

  /* ------------------------------------------------------------ Python */

  function resolvePython() {
    return (
      normalizeText(settings.pythonPath) ||
      normalizeText(process.env.SCORE_ANALYSIS_PYTHON) ||
      normalizeText(process.env.EXAM_ANALYSIS_PYTHON) ||
      normalizeText(process.env.PYTHON) ||
      'python'
    )
  }

  function runPython({ inputPath, outputPath, mappingPath, reportCardsPath, sketchThreshold }) {
    const args = [RUNNER, '--input', inputPath, '--output', outputPath]
    if (mappingPath) args.push('--mapping', mappingPath)
    if (reportCardsPath) args.push('--report-cards', reportCardsPath)
    if (sketchThreshold !== null && sketchThreshold !== undefined) {
      args.push('--sketch-threshold', String(sketchThreshold))
    }

    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(resolvePython(), args, {
        cwd: PYTHON_DIR,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        windowsHide: true,
      })

      let stdout = ''
      let stderr = ''
      let settled = false
      const timeoutMs = Math.max(5000, Number(settings.timeoutMs) || DEFAULT_SETTINGS.timeoutMs)

      const finish = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn(value)
      }

      const timer = setTimeout(() => {
        child.kill()
        finish(rejectPromise, httpError('处理超时，请稍后重试或换一个更小的文件。', 504))
      }, timeoutMs)

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.stderr.on('data', (chunk) => { stderr += chunk })
      child.on('error', (error) => {
        if (error.code === 'ENOENT') {
          finish(
            rejectPromise,
            httpError('未找到 Python，请在插件配置 pythonPath 指定解释器，或确认 PATH 中的 python 可用。', 500),
          )
          return
        }
        finish(rejectPromise, error)
      })
      child.on('close', (code) => {
        let parsed = null
        const tail = stdout.trim().split('\n').pop()
        try {
          parsed = JSON.parse(tail)
        } catch {
          parsed = null
        }
        if (code !== 0 || !parsed?.ok) {
          const error = new Error(parsed?.error || stderr.trim() || '小题成绩处理失败')
          error.detail = parsed?.traceback || stderr
          finish(rejectPromise, error)
          return
        }
        finish(resolvePromise, parsed)
      })
    })
  }

  /* -------------------------------------------------------- 输入预处理 */

  async function prepareWorkbook(buffer, originalFilename) {
    if (extname(originalFilename || '').toLowerCase() !== '.zip') {
      return {
        buffer,
        filename: originalFilename,
        entryName: null,
        displayName: buildAnalysisDisplayName(originalFilename),
      }
    }

    const { readZipEntries } = await import('./xlsx-reader.js')
    const entries = await readZipEntries(buffer)
    const entryName = findScoreWorkbookEntry(entries.map((entry) => entry.name))
    if (!entryName) {
      throw httpError('压缩包中未找到 全体报表/小题分(...).xls，请确认上传的是成绩平台导出的原始成绩压缩包。', 400)
    }
    const entry = entries.find((item) => item.name === entryName)
    const entryBuffer = await entry.read()
    if (!isAllowedWorkbookName(entryName)) {
      throw httpError('压缩包中的小题分文件不是 .xls 或 .xlsx 格式。', 400)
    }
    if (entryBuffer.length === 0) throw httpError('压缩包中的小题分文件为空。', 400)
    if (entryBuffer.length > MAX_SHEET_BYTES) {
      throw httpError('压缩包中的小题分文件过大，请控制在 32MB 以内。', 413)
    }
    return {
      buffer: entryBuffer,
      filename: entryName.split('/').pop(),
      entryName,
      displayName: buildAnalysisDisplayName(originalFilename, entryName),
    }
  }

  function validateUpload(buffer, originalFilename) {
    if (!isAllowedUploadName(originalFilename)) {
      throw httpError('请上传 .xls、.xlsx 或 .zip 格式的成绩文件。', 400)
    }
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw httpError('上传文件为空。', 400)
    const isZip = extname(originalFilename).toLowerCase() === '.zip'
    if (buffer.length > (isZip ? MAX_ZIP_BYTES : MAX_SHEET_BYTES)) {
      throw httpError(`文件过大，请控制在 ${isZip ? '100MB' : '32MB'} 以内。`, 413)
    }
  }

  /* ---------------------------------------------------------- 映射表 */

  /** 解析本次要用的教学班映射表：上传 > 配置路径 > 上次导入 > 配置里的班级数据。 */
  async function resolveMapping(uploadedMapping) {
    // 映射表按原样保存，交给 Python 端用 pandas 读取，避免在这里再写一遍解析器。
    let mappingPath = null
    let source = null

    if (uploadedMapping?.buffer?.length) {
      await ready()
      if (!isAllowedWorkbookName(uploadedMapping.filename)) {
        throw httpError('教学班映射表必须是 .xls 或 .xlsx。', 400)
      }
      if (uploadedMapping.buffer.length > MAX_SHEET_BYTES) {
        throw httpError('教学班映射表过大，请控制在 32MB 以内。', 413)
      }
      await writeFile(savedMappingFile, uploadedMapping.buffer)
      mappingPath = savedMappingFile
      source = `导入：${uploadedMapping.filename}`
    } else if (normalizeText(settings.mappingFile) && existsSync(settings.mappingFile)) {
      mappingPath = settings.mappingFile
      source = `配置：${settings.mappingFile}`
    } else if (existsSync(savedMappingFile)) {
      mappingPath = savedMappingFile
      source = '上次导入的映射表'
    } else if (Array.isArray(settings.classes) && settings.classes.length > 0) {
      await ready()
      const { writeXlsxRows } = await import('./xlsx-reader.js')
      const rows = [
        ['班级', '姓名', '教学班1', '教学班2'],
        ...buildTeachingClassMappingRows(settings.classes).map((row) => [
          row.班级,
          row.姓名,
          row.教学班1,
          row.教学班2,
        ]),
      ]
      await writeXlsxRows(savedMappingFile, rows, '教学班映射')
      mappingPath = savedMappingFile
      source = '配置中的班级数据'
    }

    return { mappingPath, source }
  }

  async function analyze(buffer, originalFilename, mappingUpload) {
    validateUpload(buffer, originalFilename)
    await ready()

    const prepared = await prepareWorkbook(buffer, originalFilename)
    const mapping = await resolveMapping(mappingUpload)

    const jobId = `${timestamp()}_${Math.random().toString(16).slice(2, 10)}`
    const inputPath = join(outputDir, `${jobId}_${sanitizeStoredFilename(prepared.filename)}`)
    const uploadPath = join(outputDir, `${jobId}_${sanitizeStoredFilename(originalFilename)}`)
    const jobMappingPath = join(outputDir, `${jobId}_teaching_classes.xlsx`)
    const outputFilename = `${jobId}_exam_analysis.xlsx`
    const outputPath = join(outputDir, outputFilename)
    const reportCardsFilename = `${jobId}_report_cards.zip`
    const reportCardsPath = join(outputDir, reportCardsFilename)
    const downloadFilename = sanitizeAttachmentName(`${prepared.displayName}.xlsx`)
    const reportCardsDownloadFilename = sanitizeAttachmentName(`${prepared.displayName}_成绩单.zip`, '.zip')

    await writeFile(uploadPath, buffer)
    if (uploadPath !== inputPath) await writeFile(inputPath, prepared.buffer)

    // 把本次实际使用的映射表复制成本任务自己的副本：
    // 之后按阈值重新生成成绩单时不必依赖用户之后再导入或改写映射表。
    let effectiveMapping = null
    if (mapping.mappingPath && existsSync(mapping.mappingPath)) {
      await copyFile(mapping.mappingPath, jobMappingPath)
      effectiveMapping = jobMappingPath
    }

    let payload
    try {
      payload = await runPython({
        inputPath,
        outputPath,
        mappingPath: effectiveMapping,
        reportCardsPath,
        sketchThreshold: null,
      })
    } catch (error) {
      const formatted = formatAnalysisError(error)
      throw httpError(formatted.message, formatted.statusCode)
    }

    // 没有映射表时 Python 端本来就会跳过成绩单；这里把原因补齐，
    // 让面板能说明为什么没有「导出成绩单」按钮。
    const hasCards = Number(payload.report_cards_count) > 0
    const cardsReason =
      payload.reportCardsError ||
      (effectiveMapping ? '' : '未导入教学班映射表，无法按信息/通用教学班生成成绩单。')

    return {
      ...payload,
      teachingAdvice: buildTeachingAdvice(payload),
      sourceFilename: originalFilename,
      extractedFilename: prepared.filename,
      extractedEntryName: prepared.entryName,
      mappingSource: mapping.source,
      outputFilename,
      downloadFilename,
      downloadUrl: `/score-analysis/api/download/${encodeURIComponent(outputFilename)}?name=${encodeURIComponent(downloadFilename)}`,
      reportCardsFilename: hasCards ? reportCardsFilename : null,
      reportCardsDownloadFilename,
      reportCardsError: hasCards ? undefined : cardsReason,
      reportCardsUrl: hasCards
        ? `/score-analysis/api/report-cards/${encodeURIComponent(reportCardsFilename)}?name=${encodeURIComponent(reportCardsDownloadFilename)}`
        : null,
      createdAt: nowText(),
    }
  }

  /* ------------------------------------------------------------ 项目 */

  function normalizeProjectName(value) {
    const name = normalizeText(value).replace(/\s+/g, ' ')
    if (!name) throw httpError('请输入考试项目名称。', 400)
    if (name.length > 80) throw httpError('考试项目名称不能超过 80 个字符。', 400)
    return name
  }

  function buildStoredResult(result) {
    if (!result || typeof result !== 'object' || result.ok !== true) {
      throw httpError('没有可保存的考试分析结果。', 400)
    }
    const stored = {}
    for (const key of SAVED_RESULT_KEYS) {
      if (result[key] !== undefined) stored[key] = result[key]
    }
    const serialized = JSON.stringify(stored)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SAVED_RESULT_BYTES) {
      throw httpError('本次考试明细过大，暂时无法保存为考试项目。', 413)
    }
    return JSON.parse(serialized)
  }

  function defaultProjectName(result) {
    const downloadName = normalizeText(result?.downloadFilename).replace(/\.xlsx$/i, '')
    if (downloadName) return downloadName.slice(0, 80)
    return (stripExtension(normalizeText(result?.sourceFilename)) || '未命名考试').slice(0, 80)
  }

  async function listProjects() {
    await projectsLoaded
    return projects
      .slice()
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(({ id, name, sourceFilename, createdAt, updatedAt }) => ({
        id,
        name,
        sourceFilename,
        createdAt,
        updatedAt,
      }))
  }

  async function getProject(id) {
    await projectsLoaded
    const project = projects.find((item) => item.id === id)
    if (!project) throw httpError('考试项目不存在。', 404)
    return project
  }

  async function createProject({ name, result }) {
    await projectsLoaded
    const stored = buildStoredResult(result)
    const project = {
      id: `p${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`,
      name: normalizeProjectName(name || defaultProjectName(stored)),
      sourceFilename: normalizeText(stored.sourceFilename).slice(0, 255),
      result: stored,
      createdAt: nowText(),
      updatedAt: nowText(),
    }
    projects.unshift(project)
    await saveProjects()
    return project
  }

  async function renameProject({ id, name }) {
    await projectsLoaded
    const project = projects.find((item) => item.id === id)
    if (!project) throw httpError('考试项目不存在。', 404)
    project.name = normalizeProjectName(name)
    project.updatedAt = nowText()
    await saveProjects()
    return project
  }

  async function removeProject({ id }) {
    await projectsLoaded
    const before = projects.length
    projects = projects.filter((item) => item.id !== id)
    if (projects.length === before) throw httpError('考试项目不存在。', 404)
    await saveProjects()
    return { id }
  }

  /* ------------------------------------------------------------ 文件 */

  function resolveArtifact(filename) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(filename || '')) throw httpError('文件名无效。', 400)
    const full = resolve(outputDir, filename)
    if (!full.startsWith(resolve(outputDir) + sep)) throw httpError('文件路径无效。', 400)
    return full
  }

  async function readArtifact(filename, mime) {
    const full = resolveArtifact(filename)
    const info = await stat(full).catch(() => null)
    if (!info?.isFile()) throw httpError('文件不存在或已被清理。', 404)
    return { buffer: await readFile(full), filename, mime }
  }

  async function regenerateReportCards(filename, sketchThreshold) {
    const match = /^(.+)_report_cards\.zip$/.exec(filename || '')
    if (!match) throw httpError('成绩单文件名无效。', 400)
    const jobId = match[1]

    const files = await readdir(outputDir).catch(() => [])
    const candidates = files
      .filter((name) => name.startsWith(`${jobId}_`))
      .filter((name) => isAllowedWorkbookName(name))
      .filter((name) => !name.endsWith('_exam_analysis.xlsx'))
      .filter((name) => !name.endsWith('_teaching_classes.xlsx'))
      .filter((name) => !/^.+_report_cards_[^/]*analysis\.xlsx$/.test(name))
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))

    // 优先原始小题分文件；名字不含“小题分”时退回本次任务里剩下的第一个工作簿。
    const inputName = candidates.find((name) => /小题分/.test(name)) || candidates[0]

    if (!inputName) throw httpError('未找到本次处理的原始小题分文件，请重新上传并处理。', 404)

    const jobMappingPath = join(outputDir, `${jobId}_teaching_classes.xlsx`)
    if (!existsSync(jobMappingPath)) {
      throw httpError('本次分析没有教学班映射表，无法生成成绩单。', 400)
    }

    const thresholdPart = String(sketchThreshold).replace(/-/g, 'm').replace(/\./g, 'p').replace(/[^a-zA-Z0-9_-]/g, '')
    const nextFilename = `${jobId}_report_cards_${thresholdPart}.zip`

    try {
      await runPython({
        inputPath: join(outputDir, inputName),
        outputPath: join(outputDir, `${jobId}_report_cards_${thresholdPart}_analysis.xlsx`),
        mappingPath: jobMappingPath,
        reportCardsPath: join(outputDir, nextFilename),
        sketchThreshold,
      })
    } catch (error) {
      const formatted = formatAnalysisError(error)
      throw httpError(formatted.message, formatted.statusCode)
    }

    await copyFile(join(outputDir, nextFilename), join(outputDir, filename))
    return readArtifact(filename, ZIP_MIME)
  }

  /* -------------------------------------------------------------- HTTP */

  function sendJson(res, body, code = 200) {
    if (res.destroyed || res.writableEnded) return
    const text = JSON.stringify(body)
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Length', Buffer.byteLength(text))
    res.end(text)
  }

  function sendFile(res, { buffer, mime }, downloadName) {
    if (res.destroyed || res.writableEnded) return
    const ascii = downloadName.replace(/[^\x20-\x7E]+/g, '_').replace(/["\\]/g, '_')
    res.statusCode = 200
    res.setHeader('Content-Type', mime)
    res.setHeader('Content-Length', buffer.length)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`)
    res.end(buffer)
  }

  function readBody(req) {
    return new Promise((resolvePromise) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_UPLOAD_BODY) {
          req.destroy()
          resolvePromise(null)
          return
        }
        chunks.push(chunk)
      })
      req.on('aborted', () => resolvePromise(null))
      req.on('error', () => resolvePromise(null))
      req.on('end', () => resolvePromise(chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0)))
    })
  }

  async function readJsonBody(req) {
    const raw = await readBody(req)
    if (raw === null) throw httpError('请求体读取失败或过大。', 413)
    let body
    try {
      body = JSON.parse(raw.toString('utf8') || '{}')
    } catch {
      throw httpError('无效 JSON。', 400)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError('请求体必须为对象。', 400)
    return body
  }

  /** 手写 multipart 解析，只为取插件自己的两个上传字段，避免引入额外依赖。 */
  async function readMultipart(req) {
    const contentType = String(req.headers['content-type'] || '')
    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
    if (!contentType.toLowerCase().startsWith('multipart/form-data') || !boundaryMatch) {
      throw httpError('请以 multipart/form-data 上传文件。', 400)
    }
    const boundary = `--${(boundaryMatch[1] || boundaryMatch[2] || '').trim()}`
    const buffer = await readBody(req)
    if (buffer === null) throw httpError('上传内容过大，请控制在 100MB 以内。', 413)

    const delimiter = Buffer.from(boundary)
    const fields = {}
    const files = {}
    let cursor = buffer.indexOf(delimiter)

    while (cursor >= 0) {
      let start = cursor + delimiter.length
      const marker = buffer.toString('latin1', start, start + 2)
      if (marker === '--') break
      if (marker === '\r\n') start += 2
      const headerEnd = buffer.indexOf('\r\n\r\n', start)
      if (headerEnd < 0) break
      const headers = buffer.toString('utf8', start, headerEnd)
      const nextDelimiter = buffer.indexOf(delimiter, headerEnd + 4)
      if (nextDelimiter < 0) break

      let contentEnd = nextDelimiter
      if (buffer.toString('latin1', contentEnd - 2, contentEnd) === '\r\n') contentEnd -= 2

      const name = (/name="([^"]*)"/i.exec(headers)?.[1] || '').trim()
      const filename = /filename="([^"]*)"/i.exec(headers)?.[1]
      const content = buffer.subarray(headerEnd + 4, contentEnd)

      if (filename !== undefined) {
        if (name) files[name] = { filename: filename.replace(/^.*[\\/]/, '') || 'exam.xlsx', buffer: content }
      } else if (name) {
        fields[name] = content.toString('utf8')
      }

      cursor = nextDelimiter
    }

    return { fields, files }
  }

  async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    const path = url.pathname
    const method = req.method || 'GET'

    try {
      if (path === '/score-analysis/api/analyze' && method === 'POST') {
        if (analyzing) return sendJson(res, { ok: false, error: '上一项分析仍在进行，请稍候。' }, 409)
        analyzing = true
        try {
          const { files } = await readMultipart(req)
          const upload = files.file
          if (!upload) return sendJson(res, { ok: false, error: '请上传成绩文件。' }, 400)
          return sendJson(res, await analyze(upload.buffer, upload.filename, files.mapping))
        } finally {
          analyzing = false
        }
      }

      if (path === '/score-analysis/api/mapping' && method === 'POST') {
        const { files } = await readMultipart(req)
        const upload = files.mapping
        if (!upload) return sendJson(res, { ok: false, error: '请选择教学班映射表。' }, 400)
        const { mappingPath, source } = await resolveMapping(upload)
        return sendJson(res, { ok: true, mappingSource: source, saved: Boolean(mappingPath) })
      }

      if (path === '/score-analysis/api/projects') {
        if (method === 'GET') return sendJson(res, { ok: true, projects: await listProjects() })
        if (method === 'POST') {
          const body = await readJsonBody(req)
          return sendJson(res, { ok: true, project: await createProject(body) }, 201)
        }
        if (method === 'DELETE') {
          const body = await readJsonBody(req)
          return sendJson(res, { ok: true, ...(await removeProject(body)) })
        }
        return sendJson(res, { ok: false, error: '不支持的请求方法。' }, 405)
      }

      const projectMatch = /^\/score-analysis\/api\/projects\/([^/]+)$/.exec(path)
      if (projectMatch) {
        const id = decodeURIComponent(projectMatch[1])
        if (method === 'GET') return sendJson(res, { ok: true, project: await getProject(id) })
        if (method === 'PATCH') {
          const body = await readJsonBody(req)
          return sendJson(res, { ok: true, project: await renameProject({ id, name: body.name }) })
        }
        return sendJson(res, { ok: false, error: '不支持的请求方法。' }, 405)
      }

      const downloadMatch = /^\/score-analysis\/api\/download\/([^/]+)$/.exec(path)
      if (downloadMatch) {
        const file = await readArtifact(decodeURIComponent(downloadMatch[1]), XLSX_MIME)
        return sendFile(res, file, sanitizeAttachmentName(url.searchParams.get('name') || file.filename, '.xlsx'))
      }

      const cardsMatch = /^\/score-analysis\/api\/report-cards\/([^/]+)$/.exec(path)
      if (cardsMatch) {
        const filename = decodeURIComponent(cardsMatch[1])
        const rawThreshold = url.searchParams.get('sketchThreshold')
        const threshold = rawThreshold === null || rawThreshold.trim() === '' ? null : Number(rawThreshold)
        if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0)) {
          return sendJson(res, { ok: false, error: '草图标红阈值必须是大于等于 0 的数字。' }, 400)
        }
        const file =
          threshold === null ? await readArtifact(filename, ZIP_MIME) : await regenerateReportCards(filename, threshold)
        return sendFile(res, file, sanitizeAttachmentName(url.searchParams.get('name') || file.filename, '.zip'))
      }

      return sendJson(res, { ok: false, error: '接口不存在。' }, 404)
    } catch (error) {
      return sendJson(res, { ok: false, error: String(error?.message || error) }, Number(error?.statusCode) || 500)
    }
  }

  ctx.inject(['webServer'], (host) => {
    host.effect(
      () => host.webServer.register({ kind: 'prefix', path: '/score-analysis', handler }),
      'score-analysis: http api',
    )
  })
}
