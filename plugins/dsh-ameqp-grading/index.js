/**
 * dsh-ameqp-grading — Host half.
 *
 * 左侧栏 AI 阅卷工作台：
 *  - 首页登录：阅卷地址 / 账号 / 密码，地址默认本场阅卷地址；
 *  - 登录后自动加载当前账号可阅卷的项目（考试 → 科目 → 题目）；
 *  - 阅卷工作台：选题后加载答卷图，逐份给分（分项 + 最终分）并提交保存，或启动 AI 自动阅卷；
 *  - 设置页：按题目维护题干/题干图、参考答案图、题目特化提示词、评分项；总提示词全局维护；模型/API 配置。
 *
 * 模型可选「DSH 当前模型」（走 Harness llm，无额外 Key）或「兼容 Chat Completions 的 API」。
 * 正式领卷与提交仅在 productionMarking 开启时允许。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ReadonlyClient } from './ameqp.js'
import { createParallelHost } from './parallel-host.js'
import { testDecisions, decodeDecisionImage } from './decisions.js'
import { sampleDecisionInput } from './decisions-samples.js'
import { appendPreview, replacePreview, newPreview, collectChatCompletion, throwIfAborted } from './streaming.js'
import { extractJson } from './json-output.js'
import { withFormatRecovery } from './format-recovery.js'
import { PROMPT_VERSION, resolveMaxScore, gradingInput, scoringSystem, gradingControls, collectLlmText,
  validateCriteria, rubricWarnings, generationRequest, validateGenerated } from './grading-policy.js'
import {
  GLOBAL_PROMPT, QUESTION_META, questionPrompt, q13Stem, DEFAULT_CRITERIA, DEFAULT_METHOD,
  answerImagePath, stemImagePath,
} from './seeds.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const QUESTION_BY_ID = Object.fromEntries(QUESTION_META.map((m) => [m.question_id, m]))

// Wait for the host services before applying the plugin. Also resolve them at
// request time so service reloads never leave a captured undefined/stale value.
export const inject = ['llm', 'attachments']

// 内置总提示词：运行时读文件，避免 ESM 模块缓存导致改了 prompt.md 不生效。
function builtinPrompt() {
  try { return fs.readFileSync(path.join(__dirname, 'seeds', 'prompt.md'), 'utf8') } catch { return GLOBAL_PROMPT }
}

/* ---------------------------------------------------------------- 工具函数 */

function roundHalfUp(n) { return Math.round(n) }

// 题目类型 → 评分方式映射（草图/设计=分段评分；三视图补线=按线评分；轴测图=整体分档）
const QUESTION_TYPES = {
  design: { label: '设计 / 草图题', method: 'rubric' },
  line: { label: '三视图补线题', method: 'line_count' },
  isometric: { label: '轴测图题', method: 'holistic_band' },
  other: { label: '其他（分项评分）', method: 'rubric' },
}
function methodForType(type) { return (QUESTION_TYPES[type] || QUESTION_TYPES.other).method }

// 原站 formatDate：yyyy-M-d H:m:s（月、日、时、分、秒不补零）
function formatDate(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`
}

function finalizeScore(criteria, totalMax) {
  const max = Number(totalMax)
  let subtotal = 0
  for (const c of criteria) {
    if (c.score == null) throw new Error('存在未判定评分项')
    const v = Number(c.score)
    if (!Number.isFinite(v) || v < 0 || v > Number(c.max_score)) throw new Error('分项超出允许范围')
    subtotal += v
  }
  return { raw_score: subtotal, score: Math.max(0, Math.min(max, roundHalfUp(subtotal))), max_score: max, rounding: 'ROUND_HALF_UP_ONCE_AFTER_SUM' }
}

function validatePrediction(prediction, config) {
  if (!prediction || typeof prediction !== 'object') throw new Error('模型返回的评分对象无效')
  if (prediction.needs_human_review !== undefined && typeof prediction.needs_human_review !== 'boolean') throw new Error('人工复核标记必须为布尔值')
  const limits = Object.create(null)
  for (const c of config.criteria) limits[c.id] = Number(c.max_score)
  const canonical = Object.hasOwn(prediction, 'criteria')
  const translated = Object.hasOwn(prediction, '标准')
  // One observed model variant translates only the container key. Accept that
  // spelling, but validate every ID and numeric value exactly as before.
  if (canonical && translated) throw new Error('模型返回多个评分项字段，请核对当前答卷后重试')
  const supplied = canonical ? prediction.criteria : prediction['标准']
  if (!Array.isArray(supplied) || supplied.length !== Object.keys(limits).length) throw new Error('模型返回的评分项与本题配置不一致')
  const ids = new Set()
  const criteria = []
  for (const item of supplied) {
    if (item == null || typeof item !== 'object') throw new Error('评分项格式错误')
    if (ids.has(item.id)) throw new Error('评分项重复')
    ids.add(item.id)
    const maximum = limits[item.id]
    if (maximum == null) throw new Error('评分项与本题配置不一致')
    const score = item.score
    if (score != null) {
      if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > maximum) throw new Error('模型返回非法分项分数')
    }
    if ((item.id === 'overall_shape' || config.grading_method === 'holistic_band') && score != null && Number(score) !== Math.trunc(Number(score))) throw new Error('轴测整体档位必须为整数')
    if (config.grading_method === 'line_count' && score != null && !(Number(score) === 0 || Number(score) === 1)) throw new Error('补线每条只允许0或1分')
    criteria.push({ id: item.id, score: score == null ? null : Number(score), max_score: maximum,
      image_evidence: String(item.image_evidence || '').slice(0, 5000), reason: String(item.reason || '').slice(0, 3000) })
  }
  const unresolved = criteria.some((c) => c.score == null)
  // 非必要不暂停：仅当模型显式 needs_human_review 时才标记人工；
  // 分项 score=null（个别无法判断）按保守原则记 0 分，不阻断自动提交。
  const explicitReview = prediction.needs_human_review === true
  const result = { criteria: criteria.map((c) => c.score == null ? { ...c, score: 0, auto_resolved: true } : c), score: null, raw_score: null, needs_human_review: explicitReview, reason: String(prediction.reason || '').slice(0, 5000) }
  // 只要没有显式要求人工，即便原本有未决项也已按 0 分补齐，可以继续算总分
  if (!explicitReview) {
    const total = finalizeScore(result.criteria, config.max_score)
    const extra = prediction.extra_lines == null ? 0 : prediction.extra_lines
    if (typeof extra !== 'number') throw new Error('多补线数量必须为整数')
    if (!Number.isInteger(extra) || extra < 0 || extra > 100) throw new Error('模型返回非法多补线数量')
    const penalty = extra * Number(config.extra_line_penalty || 0)
    const raw = Math.max(0, total.raw_score - penalty)
    result.raw_score = raw
    result.score = Math.min(config.max_score, roundHalfUp(raw))
    result.extra_lines = extra
    result.penalty = penalty
  } else {
    result.unresolved = unresolved
  }
  return result
}

function parseDataUrl(s) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(s || '').trim())
  if (!m) throw new Error('图片格式无效')
  return { bytes: Buffer.from(m[2], 'base64'), mediaType: m[1].toLowerCase() }
}

/* ---------------------------------------------------------------- 状态存储 */

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }) }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } }
function writeJson(file, value) {
  ensureDir(path.dirname(file))
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
}
function imagePart(bytes, mediaType) {
  return { type: 'image_url', image_url: { url: `data:${mediaType || 'image/png'};base64,${Buffer.from(bytes).toString('base64')}` } }
}

/* ---------------------------------------------------------------- 评分器 */

async function callApi(model, prompt, config, images, { signal, onText } = {}) {
  const content = [{ type: 'text', text: '本题配置：\n' + JSON.stringify(gradingInput(config)) }]
  if (images.stem) content.push({ type: 'text', text: '本题题干图（原题）：' }, imagePart(images.stem.bytes, images.stem.mediaType))
  if (images.standard) content.push({ type: 'text', text: '标准/参考答案图（不是学生作答）：' }, imagePart(images.standard.bytes, images.standard.mediaType))
  content.push({ type: 'text', text: '以下才是学生作答图，请评分：' })
  for (const im of images.answers) content.push(imagePart(im.bytes, im.mediaType))
  const body = {
    model: model.model,
    messages: [
      { role: 'system', content: scoringSystem(prompt, config) },
      { role: 'user', content },
    ],
    response_format: { type: 'json_object' },
    stream: true,
  }
  const startedAt = Date.now()
  const res = await fetch(model.base_url.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (model.api_key || '') }, body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error('模型服务返回 HTTP ' + res.status + (text ? '：' + text.slice(0, 200) : '，请检查模型名称、Key 及视觉/JSON 支持'))
  }
  const raw = await collectChatCompletion(res, { signal, onText })
  return { ...validatePrediction(extractJson(raw, { validate: (value) => validatePrediction(value, config) }), config), timings: { attachmentMs: 0, modelMs: Date.now() - startedAt } }
}

async function callHarness(llm, attachments, prompt, config, images, model, refCache, controls, { signal, onText, onSnapshot } = {}) {
  if (!llm) throw new Error('当前环境未提供 llm 服务，无法使用 DSH 当前模型')
  if (!attachments) throw new Error('当前环境未提供图像附件服务，无法使用 DSH 当前模型')
  const tAttach = Date.now()
  throwIfAborted(signal)
  const content = [{ type: 'text', text: '本题配置：\n' + JSON.stringify(gradingInput(config)) }]
  // 题干图/标准图在一批里是同一张：只保存一次并复用 attachment ref，
  // 复用固定图像引用，减少重复保存与解析；实际耗时需按阶段测量。
  const cache = refCache || {}
  async function refFor(key, bytes, mediaType, name) {
    if (cache[key]) return cache[key]
    const ref = await attachments.saveImage({ data: new Uint8Array(bytes), mediaType: mediaType || 'image/png', name })
    cache[key] = ref
    return ref
  }
  if (images.stem) { content.push({ type: 'text', text: '本题题干图（原题）：' }); content.push({ type: 'image', attachment: await refFor('stem', images.stem.bytes, images.stem.mediaType, 'stem') }) }
  if (images.standard) { content.push({ type: 'text', text: '标准/参考答案图（不是学生作答）：' }); content.push({ type: 'image', attachment: await refFor('standard', images.standard.bytes, images.standard.mediaType, 'standard') }) }
  content.push({ type: 'text', text: '以下才是学生作答图，请评分：' })
  for (const im of images.answers) content.push({ type: 'image', attachment: await attachments.saveImage({ data: new Uint8Array(im.bytes), mediaType: im.mediaType || 'image/png', name: 'answer' }) })
  const options = {
    provider: model.provider, model: model.model,
    ...controls,
    signal,
    system: scoringSystem(prompt, config),
    messages: [{ role: 'user', content }],
  }
  const attachmentMs = Date.now() - tAttach
  const tModel = Date.now()
  throwIfAborted(signal)
  const text = await collectLlmText(llm.stream(options), { signal, onText, onSnapshot })
  return { ...validatePrediction(extractJson(text, { validate: (value) => validatePrediction(value, config) }), config), timings: { attachmentMs, modelMs: Date.now() - tModel } }
}

/* ---------------------------------------------------------------- 运行时 */

export function apply(ctx, config) {
  return createParallelHost(ctx, config, createAccountRuntime)
}

export function createAccountRuntime(ctx, config, runtimeOptions = {}) {
  const settings = Object.assign({ ameqpBase: 'https://example.invalid/AMEQP/', examId: null, subjectId: null, productionMarking: false, autoMaxPapers: 200 }, config && typeof config === 'object' ? config : {})

  const dataDir = runtimeOptions.dataDir || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'ameqp-grading')
  ensureDir(dataDir)
  const configsFile = path.join(dataDir, 'question-configs.json')
  const promptFile = path.join(dataDir, 'prompt.txt')
  const reviewsFile = path.join(dataDir, 'reviews.json')
  const settingsFile = path.join(dataDir, 'settings.json') // { [username]: { model, prompt } }
  const cacheDir = path.join(dataDir, 'cache')

  const state = {
    client: null, connected: false, name: runtimeOptions.accountRecord?.name || '', base: runtimeOptions.accountRecord?.base || settings.ameqpBase,
    username: runtimeOptions.accountRecord?.username || '',
    model: null, gradingControls: null,
    exams: [], subjects: [], questions: [],
    exam: '', subject: '', question: '',
    job: null, stopRequested: false,
    paperStudents: null, // { key, list, total }
    markingSession: null, // { key, sessionId }
    autoMark: null,
    manualMark: null, taskId: null,
  }
  const autoRuntime = new WeakMap()
  let markingBusy = false
  let jobController = null
  let heartbeatTimer = null
  let heartbeatBusy = false
  let heartbeatTarget = null
  function beginHeartbeat(selection, session) {
    heartbeatTarget = { selection: { ...selection }, session, client: state.client }
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    const reported = Number(session.timeout)
    const seconds = Number.isFinite(reported) && reported >= 30 ? reported : 180
    heartbeatTimer = setInterval(async () => {
      const target = heartbeatTarget
      if (!target || heartbeatBusy || !state.connected || target.client !== state.client) return
      const occupied = state.manualMark || pendingAutoClaim() || state.autoMark?.inFlight || state.job?.status === 'running'
      if (!occupied) return
      heartbeatBusy = true
      try {
        const { exam, subject, question } = target.selection
        await target.client.keepAlive(exam, subject, question, target.session.sessionId)
      } catch (error) {
        if (target !== heartbeatTarget) return
        const am = state.autoMark
        if (am?.status === 'running') {
          am.status = 'paused'; am.pauseReason = 'session_error'; am.phase = '会话保活失败，已暂停：' + error.message
          autoRuntime.get(am)?.controller?.abort()
        }
      } finally { heartbeatBusy = false }
    }, (seconds - 10) * 1000)
    heartbeatTimer.unref?.()
  }

  const legacyDir = runtimeOptions.legacyDataDir || dataDir
  const normalizedSite = (value) => { try { const url = new URL(value); return url.origin + url.pathname.replace(/\/+$/, '') + '/' } catch { return String(value) } }
  const sameLegacySite = normalizedSite(state.base) === normalizedSite(settings.ameqpBase)
  let configs = readJson(configsFile, sameLegacySite ? readJson(path.join(legacyDir, 'question-configs.json'), {}) : {})
  let reviews = readJson(reviewsFile, {})
  let userSettings = readJson(settingsFile, sameLegacySite ? readJson(path.join(legacyDir, 'settings.json'), {}) : {}) // { [username]: { model, prompt } }
  // 总提示词：优先用已保存版本；但若保存的是旧版（含旧项目格式标记），则回退到内置新版并覆盖。
  let prompt = (() => {
    const fresh = builtinPrompt()
    try {
      const t = fs.readFileSync(promptFile, 'utf8')
      // Preserve custom prompts, including compact prompts; migration is explicit.
      if (t && t.trim() && !t.includes('AI 阅卷总提示词 v2') && !t.includes('sample_id')) return t
    } catch { /* ignore */ }
    try { fs.writeFileSync(promptFile, fresh, 'utf8') } catch { /* ignore */ }
    return fresh
  })()
  let decisionTestBusy = false
  let decisionTestController = null
  let runtimeDisposed = false
  const journalFile = path.join(dataDir, 'task-journal.json')
  let recovery = readJson(journalFile, null)
  if (!recovery?.pending) recovery = null
  function checkpoint() {
    if (runtimeDisposed) return
    const am = state.autoMark
    const current = state.manualMark || (am?.current && !am.current.submitted ? am.current : null)
    writeJson(journalFile, { version: 1, accountId: runtimeOptions.accountId || 'default', taskId: state.taskId,
      username: state.username, base: state.base, at: new Date().toISOString(),
      pending: !!current || !!recovery?.pending || !!am?.inFlight || markingBusy,
      claim: current ? { ansQueSN: current.ansQueSN, selection: current.selection || am?.selection, submissionUncertain: !!(current.submissionUncertain || autoRuntime.get(am)?.submissionUncertain) }
        : recovery?.claim || (am?.inFlight || markingBusy ? { ansQueSN: null, selection: am?.selection, claimUncertain: true } : null),
      auto: am ? { status: am.status, selection: am.selection, submitted: am.submitted, phase: am.phase, model: am.model } : null,
    })
  }
  function recordUnknownClaim(selection) {
    recovery = { version: 1, pending: true, accountId: runtimeOptions.accountId || 'default', taskId: state.taskId,
      username: state.username, base: state.base, at: new Date().toISOString(),
      claim: { ansQueSN: null, selection: { ...selection }, claimUncertain: true },
      phase: '领卷结果未确认，请先在原系统核对，禁止自动再次领卷' }
    checkpoint()
  }
  function assertNoHeldClaim() {
    if (state.manualMark || pendingAutoClaim()) throw new Error('仍有未提交答卷，请处理当前答卷后再切换或退出账号')
  }
  function harnessServices(requireImages = true) {
    const llm = ctx.get('llm')
    const attachments = ctx.get('attachments')
    if (typeof llm?.stream !== 'function') throw new Error('DSH 模型服务尚未就绪，请等待服务加载后重试')
    if (requireImages && typeof attachments?.saveImage !== 'function') throw new Error('DSH 图像附件服务尚未就绪，请等待服务加载后重试')
    return { llm, attachments }
  }
  function assertModelServices(model) {
    if (model?.mode === 'harness') harnessServices()
  }

  function persistConfigs() { writeJson(configsFile, configs) }
  function persistPrompt() { fs.writeFileSync(promptFile, prompt, 'utf8') }
  function persistReviews() { writeJson(reviewsFile, reviews) }
  function persistUserSettings() { writeJson(settingsFile, userSettings) }
  function assertIdle() {
    if (markingBusy || state.autoMark?.inFlight || ['running', 'stopping'].includes(state.autoMark?.status) || ['running', 'stopping'].includes(state.job?.status)) throw new Error('当前请求尚未结束，请先停止阅卷并等待请求结束')
  }
  function assertConfigReady(config) {
    validateCriteria(config.criteria, Number(config.max_score), config.grading_method)
    const warnings = rubricWarnings(config.criteria)
    if (warnings.length) throw new Error(warnings.join('；'))
  }
  function settleFormatDiagnostic(selection, paperId, recoveryStatus, error) {
    if (runtimeDisposed) return
    try {
      const file = path.join(dataDir, 'last-model-error.json')
      const previous = readJson(file, null)
      if (previous?.paper_id === paperId && previous.taskId === state.taskId && previous.recoveryStatus === 'retrying') {
        writeJson(file, { ...previous, recoveryStatus, recoveryEndedAt: new Date().toISOString(),
          recoveryFailureCode: error?.code || null, formatRetries: Math.max(1, previous.formatRetries || 0) })
      }
    } catch { /* an interrupted retry diagnostic must not alter a held claim */ }
  }
  function recordModelFailure(error, selection, paperId, recoveryStatus = 'paused') {
    if (runtimeDisposed) return
    if (typeof error?.modelOutput !== 'string') {
      if (error?.formatRetries) settleFormatDiagnostic(selection, paperId, recoveryStatus, error)
      return
    }
    try {
      writeJson(path.join(dataDir, 'last-model-error.json'), {
        at: new Date().toISOString(), selection, paper_id: paperId,
        error: error.message, code: error.code || null, formatRetries: error.formatRetries || 0,
        recoveryStatus, taskId: state.taskId, chars: error.modelOutput.length,
        text: error.modelOutput.slice(0, 128000), truncated: error.modelOutput.length > 128000,
      })
    } catch { /* diagnostics must not change scoring or claim ownership */ }
  }
  function recordFormatRecovered(error, selection, paperId, attempt) {
    if (runtimeDisposed) return
    try {
      const at = new Date().toISOString()
      writeJson(path.join(dataDir, 'last-format-recovery.json'), { at, selection, paper_id: paperId, taskId: state.taskId,
        code: error.code, formatRetries: attempt, recoveryStatus: 'recovered', action: 'same-paper-model-regeneration', scoreValidation: 'unchanged' })
      const file = path.join(dataDir, 'last-model-error.json')
      const previous = readJson(file, null)
      if (previous?.paper_id === paperId && previous.taskId === state.taskId && previous.recoveryStatus === 'retrying') {
        writeJson(file, { ...previous, recoveryStatus: 'recovered', formatRetries: attempt, recoveredAt: at })
      }
    } catch { /* diagnostics must never change a validated score */ }
  }
  function invalidateAutoResult(key) {
    const am = state.autoMark
    const runtime = am && autoRuntime.get(am)
    if (!runtime || (key && key !== `${am.selection.exam}:${am.selection.subject}:${am.selection.question}`)) return
    runtime.result = null
    runtime.configDirty = true
    if (am.current && !am.current.submitted) {
      for (const field of ['score', 'raw_score', 'criteria', 'needs_human_review']) delete am.current[field]
    }
  }
  function selectionOf(body) {
    const result = { exam: Number(body.exam), subject: Number(body.subject), question: Number(body.question) }
    if (!Object.values(result).every((n) => Number.isInteger(n) && n > 0)) throw new Error('请先选择有效的考试、科目和题目')
    return result
  }
  function questionMetaFor(exam, subject, question) {
    return Number(state.exam) === Number(exam) && Number(state.subject) === Number(subject) ? state.questions.find((q) => q.id === question) : null
  }
  async function markingOperation(action) {
    assertIdle()
    if (recovery?.pending) throw new Error('存在重启前未确认答卷，请先在原系统核对并处理恢复记录')
    if (!settings.productionMarking) throw new Error('正式阅卷未开启')
    if (!state.client) throw new Error('请先连接账号')
    markingBusy = true
    checkpoint()
    try { return await action() } finally { markingBusy = false; checkpoint() }
  }
  async function ensureMarkingSession({ exam, subject }) {
    const key = `${exam}:${subject}`
    if (!state.markingSession || state.markingSession.key !== key) {
      const session = await state.client.getSessionId()
      state.markingSession = { key, sessionId: session.SessionId, teaSN: session.teaSN, timeout: session.Timeout }
    }
    return state.markingSession
  }
  function matchClaim(claim, selection, id) {
    if (!claim || claim.submitted || claim.ansQueSN !== id || ['exam', 'subject', 'question'].some((key) => claim.selection[key] !== selection[key])) throw new Error('请求与当前占用答卷不一致，请刷新页面')
    return claim
  }
  function ownedClaim(selection, id) {
    if (state.manualMark) return matchClaim(state.manualMark, selection, id)
    return matchClaim(state.autoMark?.current ? { ...state.autoMark.current, selection: state.autoMark.selection } : null, selection, id)
  }
  function clearOwnedClaim(claim, phase, score) {
    const manual = state.manualMark?.ansQueSN === claim.ansQueSN
    if (manual) state.manualMark = null
    const am = state.autoMark
    if (!manual && am?.taskId === state.taskId && am?.current?.ansQueSN === claim.ansQueSN) {
      if (am.current.needs_human_review) am.review = Math.max(0, (am.review || 0) - 1)
      const runtime = autoRuntime.get(am)
      if (runtime) { runtime.claim = runtime.images = runtime.result = null; runtime.submissionUncertain = false }
      if (score !== undefined) { am.submitted += 1; am.batchSubmitted = (am.batchSubmitted || 0) + 1; am.current.score = score; am.current.submitted = true; am.current.needs_human_review = false }
      else am.current = null
      if (am.current) am.current.submissionUncertain = false
      am.status = 'stopped'; am.phase = phase; am.submissionUncertain = false; am.pauseReason = null
      if (am.stream && score === undefined) am.stream.status = 'cancelled'
    }
    checkpoint()
  }

  // 当前账号的持久化设置（模型 + 总提示词）
  function currentUserKey() { return state.username ? state.base + '\n' + state.username : '_default_' }
  // api_key 不落盘：持久化时剥离，登录后需重新填写（或仅本次会话有效）。
  function stripSecret(model) {
    if (!model) return null
    const { api_key, ...rest } = model
    return rest
  }
  function loadUserSettings() {
    const k = currentUserKey()
    const s = userSettings[k] || (state.base === settings.ameqpBase ? userSettings[state.username] : null) || {}
    if (s.prompt) { prompt = s.prompt; persistPrompt() }
    // 恢复非敏感模型配置；api_key 不回填（安全）
    if (s.model) state.model = { ...s.model, api_key: '' }
  }
  function saveUserSettings() {
    const k = currentUserKey()
    userSettings[k] = { model: stripSecret(state.model), prompt }
    persistUserSettings()
  }

  function seedConfig(meta, title, maxScore) {
    return {
      question_prompt: questionPrompt(meta.key),
      question: meta.key === 'q13' ? q13Stem() : meta.title,
      criteria: (DEFAULT_CRITERIA[meta.key] || []).map((c) => ({ ...c })),
      extra_line_penalty: meta.key === 'q11' ? 1 : 0,
      rubric_version: 'bundled-v1',
      grading_method: DEFAULT_METHOD[meta.key] || 'rubric',
      question_type: meta.kind === 'line' ? 'line' : meta.kind === 'band' ? 'isometric' : 'design',
      max_score: maxScore != null ? maxScore : meta.max_score,
      title,
      stem_image: null,
      reference_image: null,
    }
  }

  function resolveConfig(payload) {
    const { exam, subject, question } = selectionOf(payload)
    const meta = questionMetaFor(exam, subject, question)
    const key = `${exam}:${subject}:${question}`
    // Online positive totals take precedence; missing/zero metadata must not erase saved totals.
    const metaMax = meta && Number(meta.max_score) > 0 ? Number(meta.max_score) : null
    const base = configs[key]
    if (base) {
      return { ...base, stem_image: base.stem_image || null, reference_image: base.reference_image || null,
        exam, subject, question_id: question, title: meta ? meta.name : (base.title || ''),
        max_score: resolveMaxScore({ online: metaMax, saved: base.max_score, criteria: base.criteria }) }
    }
    const demoMeta = QUESTION_BY_ID[question]
    if (exam === settings.examId && subject === settings.subjectId && demoMeta) {
      const seeded = seedConfig(demoMeta, demoMeta.title, metaMax || demoMeta.max_score)
      return { ...seeded, exam, subject, question_id: question, title: demoMeta.title, max_score: metaMax || demoMeta.max_score }
    }
    const fallbackMax = metaMax
    return { question_prompt: '', question: '', criteria: [{ id: 'total', description: '按本题标准整体评分', max_score: fallbackMax }],
      extra_line_penalty: 0, rubric_version: 'custom-v1', grading_method: 'rubric', stem_image: null, reference_image: null,
      exam, subject, question_id: question, title: meta ? meta.name : '', max_score: fallbackMax }
  }

  function resolveHarnessModel(model) {
    if (model.provider && model.model) return model
    const adm = ctx.get('agentDefaultModel')
    let sel = null
    try { sel = adm && typeof adm.currentSelection === 'function' ? adm.currentSelection() : null } catch { sel = null }
    return { ...model, mode: 'harness', provider: model.provider || (sel && sel.provider) || '', model: model.model || (sel && sel.model) || '' }
  }

  // 判断模型是否真正可用（空配置不算），用于启动前校验和 UI 状态
  function modelReady(m) {
    if (!m) return false
    if (m.mode === 'api') return !!m.base_url && !!m.model
    const r = resolveHarnessModel(m)
    return !!(r.provider && r.model)
  }

  // 题干图/标准图的 attachment ref 缓存：跨份复用固定图像引用。
  const attachmentRefCache = new Map()
  const gradingControlCache = new WeakMap()

  async function gradeOne(model, config, images, cacheKey, progress = {}) {
    const resolved = model.mode === 'harness' ? resolveHarnessModel(model) : model
    const provider = model.mode === 'harness' ? resolved.provider : 'api:' + model.base_url
    const queuedAt = Date.now()
    const release = runtimeOptions.scheduler ? await runtimeOptions.scheduler.acquire(provider, progress) : () => {}
    progress.onAcquired?.(Date.now() - queuedAt)
    const frozenPrompt = progress.prompt ?? prompt
    try {
      throwIfAborted(progress.signal)
      return await withFormatRecovery(({ formatInstruction }) => gradeOneNow(resolved, config, images, cacheKey, { ...progress, prompt: frozenPrompt + formatInstruction }), {
        signal: progress.signal, onRetry: progress.onFormatRetry, onRecovered: progress.onFormatRecovered,
      })
    } finally { release() }
  }

  async function gradeOneNow(model, config, images, cacheKey, progress = {}) {
    throwIfAborted(progress.signal)
    if (model.mode === 'harness') {
      const { llm, attachments } = harnessServices()
      const resolved = resolveHarnessModel(model)
      if (!resolved.provider || !resolved.model) throw new Error('请填写模型名，或确认当前会话已选择模型')
      let refCache = cacheKey ? attachmentRefCache.get(cacheKey) : null
      if (!refCache) { refCache = {}; if (cacheKey) attachmentRefCache.set(cacheKey, refCache) }
      let controls = gradingControlCache.get(model)
      if (!controls) {
        controls = await gradingControls(llm, resolved, progress.signal)
        gradingControlCache.set(model, controls)
      }
      state.gradingControls = { reasoningEffort: controls.reasoningEffort || 'default' }
      return callHarness(llm, attachments, progress.prompt ?? prompt, config, images, resolved, refCache, controls, progress)
    }
    if (!model.base_url || !model.model) throw new Error('请先配置 API 接口')
    return callApi(model, progress.prompt ?? prompt, config, images, progress)
  }

  // 题干图/标准图在一批任务里是固定的，缓存起来避免每份都重复读盘+base64 编码。
  const staticImageCache = new Map()
  function getStaticImages(exam, subject, question, config) {
    const key = `${exam}:${subject}:${question}:` + crypto.createHash('sha256').update((config.stem_image || '') + '\0' + (config.reference_image || '')).digest('hex')
    if (staticImageCache.has(key)) return staticImageCache.get(key)
    const stem = config.stem_image ? parseDataUrl(config.stem_image) : builtinStemImage(exam, subject, question)
    const standard = config.reference_image ? parseDataUrl(config.reference_image) : builtinReferenceImage(exam, subject, question)
    const value = { stem, standard }
    if (staticImageCache.size >= 16) staticImageCache.delete(staticImageCache.keys().next().value)
    staticImageCache.set(key, value)
    return value
  }

  function builtinReferenceImage(exam, subject, questionId) {
    if (exam !== settings.examId || subject !== settings.subjectId) return null
    const meta = QUESTION_BY_ID[questionId]
    if (!meta) return null
    const p = answerImagePath(meta.key)
    return p ? { bytes: fs.readFileSync(p), mediaType: 'image/png' } : null
  }

  function builtinStemImage(exam, subject, questionId) {
    if (exam !== settings.examId || subject !== settings.subjectId) return null
    const meta = QUESTION_BY_ID[questionId]
    if (!meta) return null
    const p = stemImagePath(meta.key)
    return p ? { bytes: fs.readFileSync(p), mediaType: 'image/png' } : null
  }

  function buildImages(config, answers) {
    const standard = config.reference_image ? parseDataUrl(config.reference_image) : null
    const stem = config.stem_image ? parseDataUrl(config.stem_image) : null
    return { stem, standard, answers }
  }

  function saveJob(dir) { writeJson(path.join(dir, 'result.json'), state.job) }

  async function runJob(model, config, limit, exam, subject, question, dir, sessionId, frozenPrompt) {
    const client = state.client
    const privateMap = []
    let count = 0, page = 1
    try {
      while (count < limit && !state.stopRequested) {
        const batch = await client.listStudents(exam, subject, page, Math.min(100, limit))
        if (!batch.length) break
        for (const student of batch) {
          if (count >= limit || state.stopRequested) break
          count += 1
          const anonymous = 'paper' + String(count).padStart(5, '0')
          state.job.phase = `正在评分第 ${count} 份`
          let result
          state.job.stream = newPreview(anonymous)
          try {
            const meta = await client.studentMeta(exam, subject, student.ansStuSN)
            privateMap.push({ paper_id: anonymous, ansStuSN: student.ansStuSN, stuSN: meta.stuSN })
            writeJson(path.join(dir, 'private-map.json'), privateMap)
            // 优先只读取图（getStuImgList + GetDefQuestionInfo），回退 getimgandque
            let answers
            try {
              answers = await client.questionCropImages(exam, subject, question, student.ansStuSN, sessionId)
            } catch (e) {
              answers = await client.answerImages(exam, subject, question, meta.stuSN)
            }
            for (let i = 0; i < answers.length; i++) fs.writeFileSync(path.join(dir, `${anonymous}-${i}.png`), answers[i].bytes)
            if (state.stopRequested) break
            const builtinStd = builtinReferenceImage(exam, subject, question)
            const builtinStem = builtinStemImage(exam, subject, question)
            const images = {
              stem: config.stem_image ? parseDataUrl(config.stem_image) : builtinStem,
              standard: config.reference_image ? parseDataUrl(config.reference_image) : builtinStd,
              answers,
            }
            result = await gradeOne(model, config, images, `${exam}:${subject}:${question}`, {
              prompt: frozenPrompt,
              signal: AbortSignal.any([jobController.signal, AbortSignal.timeout(180000)]),
              onFormatRetry: ({ attempt, error }) => {
                if (runtimeDisposed || state.stopRequested) return
                state.job.totalFormatRetries = (state.job.totalFormatRetries || 0) + 1
                state.job.phase = `第 ${count} 份输出格式异常，正在同卷重试（${attempt}/1）`
                state.job.stream = newPreview(anonymous)
                recordModelFailure(error, { exam, subject, question }, anonymous, 'retrying')
              },
              onFormatRecovered: ({ attempt, error }) => {
                if (!state.stopRequested) recordFormatRecovered(error, { exam, subject, question }, anonymous, attempt)
              },
              onText: (delta) => { if (!state.stopRequested) appendPreview(state.job.stream, delta) },
              onSnapshot: (text) => { if (!state.stopRequested) replacePreview(state.job.stream, text) },
            })
            if (state.stopRequested) break
            state.job.stream.status = 'completed'
            result.paper_id = anonymous; result.image_count = answers.length
            result.status = result.needs_human_review ? 'review' : 'scored'
          } catch (error) {
            if (state.stopRequested) { settleFormatDiagnostic({ exam, subject, question }, anonymous, 'interrupted', error); state.job.stream.status = 'cancelled'; break }
            recordModelFailure(error, { exam, subject, question }, anonymous)
            state.job.stream.status = 'error'
            const message = error instanceof Error ? error.message : String(error)
            result = { paper_id: anonymous, status: 'failed', score: null, reason: message.slice(0, 300) }
          }
          state.job.results.push(result); state.job.processed += 1
          if (result.status === 'scored') state.job.scored += 1
          else if (result.status === 'review') state.job.review += 1
          else if (result.status === 'failed') state.job.failed += 1
          saveJob(dir)
        }
        page += 1
      }
      state.job.status = state.stopRequested ? 'stopped' : 'completed'
      state.job.phase = state.stopRequested ? '已停止' : '当前批次已结束'
    } catch (error) {
      state.job.status = 'failed'
      state.job.phase = `任务读取失败（${(error && error.name) || 'Error'}）：${(error && error.message) || ''}`.slice(0, 300)
    } finally { if (state.stopRequested && state.job.stream) state.job.stream.status = 'cancelled'; jobController = null; saveJob(dir) }
  }

  /**
   * AI 逐份实时流水线：领卷 → 取图 → AI 评分 →（需人工则暂停，否则）提交 → 下一份。
   * 仅 productionMarking=true 时可用。每一步更新 state.autoMark 供前端实时显示。
   */
  function pendingAutoClaim() {
    return state.autoMark?.current && !state.autoMark.current.submitted
  }

  async function readClaimImages(client, exam, subject, question, sessionId, data) {
    let images
    try {
      images = await client.claimCropImages(exam, subject, question, sessionId, data)
    } catch (error) {
      const failures = ['裁切取图：' + error.message]
      // Some exams return ready-cropped images without full page records.
      // Preserve all regions; never accept a partially downloaded answer.
      for (const [label, records] of [['题目区域图', data.AnsImageQuestionAreaRec], ['整页图', data.AnsImagePageRec]]) {
        const rows = Array.isArray(records) ? records : records && typeof records === 'object' ? [records] : []
        if (!rows.length) continue
        try {
          const files = rows.map((row) => row.FileName || row.ansImgPath)
          if (files.some((file) => typeof file !== 'string' || !file.trim())) throw new Error('部分图像缺少文件路径')
          images = await Promise.all(files.map((file) => client.fetchByFileName(file)))
          break
        } catch (fallbackError) { failures.push(label + '：' + fallbackError.message) }
      }
      if (!images?.length) throw new Error('取图失败：' + failures.join('；'))
    }
    if (!images.length || images.some((im) => !im.bytes?.length)) throw new Error('未取到完整答卷图像')
    return images
  }

  function cacheClaim(data, images, { exam, subject, question }) {
    ensureDir(cacheDir); pruneCache()
    const cached = images.map((im, i) => {
      fs.writeFileSync(path.join(cacheDir, `mark-${exam}-${subject}-${question}-${data.ansQueSN}-${i}.png`), im.bytes)
      return `/ameqp-grading/api/marking-image?exam=${exam}&subject=${subject}&question=${question}&ans=${data.ansQueSN}&page=${i}`
    })
    return { taskId: state.taskId, accountId: runtimeOptions.accountId || 'default', ansQueSN: data.ansQueSN, ansStuSN: data.ansStuSN, ansMultiMethod: data.ansMultiMethod,
      max_score: resolveConfig({ exam, subject, question }).max_score,
      stuSecNo: data.stuInfo?.stuSecNo == null ? null : String(data.stuInfo.stuSecNo),
      ansQueMarkState: data.ansQueMarkState, marIsTryMark: data.marIsTryMark,
      ansQueMarkValue: data.ansQueMarkValue, points: data.Point || [], images: cached, submitted: false }
  }

  function autoBatchLimit() {
    const value = Number(settings.autoMaxPapers)
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 200
  }

  function launchAuto(am, model, config, selection, session) {
    if (runtimeDisposed) throw new Error('账号运行实例已关闭')
    if (am.inFlight) throw new Error('上一份请求尚未结束，请稍候')
    const runtime = autoRuntime.get(am) || { client: state.client, session, claim: null, images: null, result: null }
    autoRuntime.set(am, runtime)
    if (!runtime.snapshot) runtime.snapshot = { model: structuredClone(model.mode === 'harness' ? resolveHarnessModel(model) : model), config: structuredClone(config), prompt }
    if (runtime.configDirty) { runtime.snapshot.config = structuredClone(config); runtime.snapshot.prompt = prompt; runtime.configDirty = false }
    am.model = stripSecret(runtime.snapshot.model)
    beginHeartbeat(selection, session)
    runtime.controller = new AbortController()
    am.gen = (am.gen || 0) + 1
    am.inFlight = true
    am.pauseReason = null
    am.status = 'running'
    checkpoint()
    void runMarkingAuto(am, runtime, runtime.snapshot.model, runtime.snapshot.config, selection, am.gen)
  }

  async function runMarkingAuto(am, runtime, model, config, selection, generation) {
    const { exam, subject, question } = selection
    const { client, session } = runtime
    const signal = runtime.controller.signal
    const active = () => !runtimeDisposed && state.autoMark === am && am.gen === generation && am.status === 'running'
    try {
      const maxPapers = am.batchLimit || autoBatchLimit()
      while (active()) {
        if (am.batchSubmitted >= maxPapers && !runtime.claim) {
          am.status = 'paused'; am.pauseReason = 'batch_limit'
          am.phase = `本批已完成 ${maxPapers} 份（累计 ${am.submitted} 份），可继续下一批`
          break
        }
        // Resume reuses the already-claimed paper and any complete result.
        if (!runtime.claim) {
          am.phase = '领取答卷'
          const started = Date.now()
          const data = await client.getQuestion(exam, subject, question, session.sessionId, false)
          am.tClaimMs = Date.now() - started
          if (!data || !data.ansQueSN) { am.status = 'completed'; am.phase = '当前试题已无可评试卷'; break }
          runtime.claim = data; runtime.images = null; runtime.result = null
          am.current = cacheClaim(data, [], selection)
          checkpoint()
          am.stream = newPreview(data.ansQueSN)
          am.tImgMs = am.tAttachmentMs = am.tModelMs = null
        }
        if (!active()) break
        const data = runtime.claim
        if (!runtime.images) {
          am.phase = '读取答卷图像'
          const started = Date.now()
          runtime.images = await readClaimImages(client, exam, subject, question, session.sessionId, data)
          am.tImgMs = Date.now() - started
          am.current = cacheClaim(data, runtime.images, selection)
        }
        if (!active()) break
        if (!runtime.result) {
          am.phase = 'AI 评分中'
          am.formatRetries = 0; am.formatRecovered = false
          am.startedAt = Date.now()
          am.stream = newPreview(data.ansQueSN)
          const statics = getStaticImages(exam, subject, question, config)
          runtime.result = await gradeOne(model, config, { ...statics, answers: runtime.images }, `${exam}:${subject}:${question}:` + crypto.createHash('sha256').update((config.stem_image || '') + '\0' + (config.reference_image || '')).digest('hex'), {
            prompt: runtime.snapshot.prompt,
            signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
            onFormatRetry: ({ attempt, error }) => {
              if (!active()) return
              am.formatRetries = attempt; am.totalFormatRetries = (am.totalFormatRetries || 0) + 1
              am.phase = `评分输出格式异常，正在同卷重试（${attempt}/1）`
              am.stream = newPreview(data.ansQueSN)
              recordModelFailure(error, selection, data.ansQueSN, 'retrying')
            },
            onFormatRecovered: ({ attempt, error }) => {
              if (!active()) return
              am.formatRecovered = true
              recordFormatRecovered(error, selection, data.ansQueSN, attempt)
            },
            onWaiting: () => { if (active()) am.phase = '等待模型名额' },
            onAcquired: (ms) => { if (active()) { am.tQueueMs = ms; am.phase = 'AI 评分中' } },
            onText: (delta) => { if (active()) appendPreview(am.stream, delta) },
            onSnapshot: (text) => { if (active()) replacePreview(am.stream, text) },
          })
          am.elapsedMs = Date.now() - am.startedAt
          am.lastCostSec = Math.round(am.elapsedMs / 100) / 10
          am.tAttachmentMs = runtime.result.timings?.attachmentMs
          am.tModelMs = runtime.result.timings?.modelMs
          am.reasoningEffort = state.gradingControls?.reasoningEffort || 'default'
          am.stream.status = 'completed'
        }
        if (!active()) break
        const result = runtime.result
        Object.assign(am.current, { score: result.score, raw_score: result.raw_score, criteria: result.criteria, needs_human_review: result.needs_human_review, review_reason: result.needs_human_review ? result.reason : '' })
        if (result.needs_human_review) {
          am.review += 1; am.status = 'paused'; am.pauseReason = 'human_review'
          am.phase = '需人工复核，答卷未提交，请人工处理或取消领卷'
          break
        }
        // Some deployments omit teaSN and resolve the authenticated teacher
        // server-side. Preserve the existing automatic submission contract.
        const teaSN = session.teaSN || 0
        if (!Number.isFinite(result.score) || result.score < 0 || result.score > config.max_score) throw new Error('评分结果超出本题满分')
        am.phase = '提交评分'
        const started = Date.now()
        const ansMar = {
          sigSN: 0, marQueSpotCheck_Updated: false, IsReview: false, Point: [], Count: 0,
          marQueSN: 0, teaSN, queSN: question, ansQueSN: data.ansQueSN,
          marQueMarkKind: data.ansQueMarkState, ansMultiMethod: data.ansMultiMethod || '',
          marQueMarkPostTime: formatDate(new Date()), marQueMarkValue: result.score,
          marQueRefEna: false, marIsTryMark: !!data.marIsTryMark, marQueSignEna: false,
          marQueMarkOutTime: formatDate(new Date()), marQuePostilExist: false,
        }
        // A lost submission response is ambiguous. Never retry it automatically.
        runtime.submissionUncertain = true
        checkpoint()
        await client.submitScore(exam, subject, question, session.sessionId, ansMar, [], 0, data.ansMultiMethod || 'A')
        runtime.submissionUncertain = false
        am.tSubmitMs = Date.now() - started
        am.submitted += 1; am.batchSubmitted = (am.batchSubmitted || 0) + 1; am.current.submitted = true
        runtime.claim = runtime.images = runtime.result = null
        checkpoint()
        am.phase = `已提交 ${result.score} 分，领取下一份`
      }
    } catch (error) {
      if (error.claimUncertain) recordUnknownClaim(selection)
      if (active()) {
        recordModelFailure(error, selection, runtime.claim?.ansQueSN)
        am.failed += 1; am.status = 'paused'; am.pauseReason = 'error'
        am.lastError = { code: error.code || null, message: error.message || String(error), formatRetries: error.formatRetries || 0 }
        am.phase = error.claimUncertain ? '领卷结果未确认，已暂停；请先在原系统核对，禁止再次领卷' : runtime.submissionUncertain ? '提交结果未确认，已暂停；请先在原系统核对，禁止自动重试' : error.formatRetries ? '同卷格式恢复后仍未通过校验，已暂停：' + (error.message || String(error)) : '阅卷失败，已暂停：' + (error.message || String(error))
        if (am.stream && am.stream.status !== 'completed') am.stream.status = 'error'
      }
    } finally {
      if (state.autoMark === am && am.formatRetries && !am.formatRecovered && runtime.claim) {
        settleFormatDiagnostic(selection, runtime.claim.ansQueSN, signal.aborted ? 'interrupted' : 'paused')
      }
      am.inFlight = false
      am.submissionUncertain = !!runtime.submissionUncertain
      checkpoint()
      if (am.status === 'stopping') am.status = 'stopped'
      if (am.status === 'stopped' || am.status === 'paused') {
        if (am.stream && ['waiting', 'streaming'].includes(am.stream.status)) am.stream.status = 'cancelled'
        if (am.pauseReason !== 'batch_limit' && !am.phase.includes('失败') && !am.phase.includes('复核') && !am.phase.includes('未确认')) {
          am.phase = (am.status === 'stopped' ? '已停止' : '已暂停') + (runtime.claim ? '（当前答卷未提交，可继续或取消领卷）' : '')
        }
      }
    }
  }

  /* ------------------------------------------------------------------ HTTP */

  function sendJson(res, value, code = 200) {
    const text = JSON.stringify(value, (_key, item) => {
      if (typeof item === 'string' && /^\/ameqp-grading\/api\/(?:image|paper-image|job-image|marking-image)\?/.test(item)) {
        return item.replace('/ameqp-grading/api/', '/ameqp-grading/api/accounts/' + (runtimeOptions.accountId || 'default') + '/')
      }
      return item
    })
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(text)
  }
  function sendBytes(res, bytes, mediaType) {
    res.statusCode = 200
    res.setHeader('Content-Type', mediaType || 'image/png')
    res.setHeader('Cache-Control', 'no-store')
    res.end(Buffer.from(bytes))
  }
  function readBody(req, limit = 8 * 1024 * 1024) {
    return new Promise((resolve) => {
      let size = 0; const chunks = []
      req.on('data', (c) => { size += c.length; if (size > limit) { req.destroy(); resolve(null); return } chunks.push(c) })
      req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0)))
      req.on('error', () => resolve(null))
    })
  }

  function stateView() {
    const model = state.model ? { mode: state.model.mode, provider: state.model.provider, model: state.model.model, base_url: state.model.base_url, grading_effort: state.model.grading_effort || 'low' } : null
    return {
      connected: state.connected, name: state.name, base: state.base, defaultBase: settings.ameqpBase,
      username: state.username, accountId: runtimeOptions.accountId || 'default', taskId: state.taskId, recovery,
      productionMarking: !!settings.productionMarking,
      model, exam: state.exam, subject: state.subject, question: state.question,
      exams: state.exams, subjects: state.subjects, questions: state.questions,
      job: state.job, autoMark: state.autoMark, manualMark: state.manualMark, prompt, prompt_version: PROMPT_VERSION, plugin_version: '2.0.0-candidate.4', gradingControls: state.gradingControls,
      services: { llm: typeof ctx.get('llm')?.stream === 'function', attachments: typeof ctx.get('attachments')?.saveImage === 'function' },
    }
  }

  function paperCachePath(exam, subject, question, index, page) {
    return path.join(cacheDir, `${exam}-${subject}-${question}-${index}-${page}.png`)
  }

  // 清理缓存：保留最近 1 小时、最多 300 个文件，避免 cacheDir 无限增长。
  function pruneCache() {
    try {
      const entries = fs.readdirSync(cacheDir).map((name) => {
        const full = path.join(cacheDir, name)
        try { return { full, mtime: fs.statSync(full).mtimeMs } } catch { return null }
      }).filter(Boolean)
      const cutoff = Date.now() - 60 * 60 * 1000
      let kept = 0
      entries.sort((a, b) => b.mtime - a.mtime)
      for (const e of entries) {
        if (kept < 300 && e.mtime >= cutoff) { kept += 1; continue }
        try { fs.unlinkSync(e.full) } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  async function ensurePaperStudents(exam, subject, uptoIndex) {
    const key = `${exam}:${subject}`
    if (!state.paperStudents || state.paperStudents.key !== key) state.paperStudents = { key, list: [], lastPage: 0, total: 0 }
    const ps = state.paperStudents
    // 从上次停的页继续翻，避免重复拉取
    while (ps.list.length <= uptoIndex) {
      const page = ps.lastPage + 1
      const batch = await state.client.listStudents(exam, subject, page, 100)
      if (!batch.length) break
      ps.list.push(...batch)
      ps.lastPage = page
      if (batch.length < 100) break
    }
    return ps
  }

  async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    const p = url.pathname
    try {
      if (req.method === 'GET') {
        if (p === '/ameqp-grading/api/state') return sendJson(res, stateView())
        const img = url.searchParams
        if (p === '/ameqp-grading/api/image') {
          const kind = img.get('kind'); const key = img.get('key')
          if (kind === 'standard' && key) { const ap = answerImagePath(key); if (!ap) return sendJson(res, { error: '无标准答案图' }, 404); return sendBytes(res, fs.readFileSync(ap), 'image/png') }
          if (kind === 'stem' && key) { const sp = stemImagePath(key); if (!sp) return sendJson(res, { error: '无题干图' }, 404); return sendBytes(res, fs.readFileSync(sp), 'image/png') }
          return sendJson(res, { error: '无效图像参数' }, 400)
        }
        if (p === '/ameqp-grading/api/paper-image') {
          const exam = img.get('exam'); const subject = img.get('subject'); const question = img.get('question'); const index = img.get('index'); const page = img.get('page') || '0'
          if (!/^\d+$/.test(exam || '') || !/^\d+$/.test(subject || '') || !/^\d+$/.test(question || '') || !/^\d+$/.test(index || '') || !/^\d{1,2}$/.test(page)) return sendJson(res, { error: '无效标识' }, 400)
          const fp = paperCachePath(exam, subject, question, index, page)
          if (!fs.existsSync(fp)) return sendJson(res, { error: '图像不存在' }, 404)
          return sendBytes(res, fs.readFileSync(fp), 'image/png')
        }
        if (p === '/ameqp-grading/api/job-image') {
          const job = img.get('job'); const paper = img.get('paper'); const page = img.get('page') || '0'
          if (!/^[a-f0-9]{32}$/.test(job || '') || !/^paper\d{5}$/.test(paper || '') || !/^\d{1,2}$/.test(page)) return sendJson(res, { error: '无效标识' }, 400)
          const fp = path.join(dataDir, 'jobs', job, `${paper}-${page}.png`)
          if (!fs.existsSync(fp)) return sendJson(res, { error: '图像不存在' }, 404)
          return sendBytes(res, fs.readFileSync(fp), 'image/png')
        }
        if (p === '/ameqp-grading/api/marking-image') {
          const exam = img.get('exam'); const subject = img.get('subject'); const question = img.get('question'); const ans = img.get('ans'); const page = img.get('page') || '0'
          if (!/^\d+$/.test(exam || '') || !/^\d+$/.test(subject || '') || !/^\d+$/.test(question || '') || !/^\d+$/.test(ans || '') || !/^\d{1,2}$/.test(page)) return sendJson(res, { error: '无效标识' }, 400)
          const fp = path.join(cacheDir, `mark-${exam}-${subject}-${question}-${ans}-${page}.png`)
          if (!fs.existsSync(fp)) return sendJson(res, { error: '图像不存在' }, 404)
          return sendBytes(res, fs.readFileSync(fp), 'image/png')
        }
        return sendJson(res, { error: 'not found' }, 404)
      }

      const raw = await readBody(req, p === '/ameqp-grading/api/decisions-test' ? 14 * 1024 * 1024 : 8 * 1024 * 1024)
      if (runtimeDisposed) throw new Error('账号运行实例已关闭')
      if (raw === null) throw new Error('请求内容读取失败或超过大小限制')
      let body = {}
      try { body = raw && raw.length ? JSON.parse(raw.toString('utf8')) : {} } catch { throw new Error('请求JSON格式无效') }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('请求必须为JSON对象')

      if (p === '/ameqp-grading/api/decisions-test') {
        if (decisionTestBusy) throw new Error('该账号的Decisions试验尚未完成，请勿重复计费请求')
        if (body.sample && (body.config || body.answer_images)) throw new Error('请选择内置样本或自定义图片模式，不能混合')
        const input = body.sample ? sampleDecisionInput(body.sample, body.score_step ?? 0.25) : {
          config: structuredClone(body.config), prompt: String(body.prompt || ''), scoreStep: body.score_step ?? 0.25,
          images: { stem: body.config?.stem_image ? decodeDecisionImage(body.config.stem_image) : null,
            standard: body.config?.reference_image ? decodeDecisionImage(body.config.reference_image) : null,
            answers: Array.isArray(body.answer_images) ? body.answer_images.map(decodeDecisionImage) : [] },
        }
        decisionTestBusy = true
        const controller = new AbortController()
        decisionTestController = controller
        let release = () => {}
        try {
          if (runtimeOptions.scheduler) release = await runtimeOptions.scheduler.acquire('decisions-api.dev', { signal: controller.signal })
          throwIfAborted(controller.signal)
          const result = await testDecisions(input, { apiKey: body.api_key || process.env.DECISIONS_API_KEY, signal: controller.signal })
          if (runtimeDisposed) throw new Error('账号运行实例已关闭，试验结果未展示')
          return sendJson(res, result)
        } finally { release(); decisionTestBusy = false; if (decisionTestController === controller) decisionTestController = null }
      }
      const taskOperations = ['marking-auto-pause', 'marking-auto-stop', 'marking-auto-resume', 'marking-submit', 'marking-cancel', 'stop']
      if (req.accountScoped && taskOperations.includes(p.split('/').pop()) && (!body.taskId || body.taskId !== state.taskId)) throw new Error('任务标识已过期，请刷新当前账号后再操作')
      if (p === '/ameqp-grading/api/recovery-resolve') {
        assertIdle()
        if (!recovery?.pending || body.ansQueSN !== recovery.claim?.ansQueSN || !['confirmed_submitted', 'confirmed_cancelled'].includes(body.resolution)) throw new Error('恢复核对信息无效')
        if (!String(body.note || '').trim()) throw new Error('请填写原系统核对结果说明')
        writeJson(path.join(dataDir, 'recovery-' + Date.now() + '.json'), { ...recovery, resolution: body.resolution, note: String(body.note).slice(0, 2000), at: new Date().toISOString() })
        recovery = null; checkpoint()
        return sendJson(res, stateView())
      }
      if (p === '/ameqp-grading/api/login') {
        assertIdle()
        assertNoHeldClaim()
        if (state.client) { await state.client.logout().catch(() => {}) }
        state.client = null; state.connected = false; state.username = ''; state.model = null
        state.markingSession = null; state.autoMark = null; state.manualMark = null; state.job = null
        state.exams = []; state.subjects = []; state.questions = []; state.exam = state.subject = state.question = ''
        const base = String(body.base || settings.ameqpBase).trim()
        const client = new ReadonlyClient(base)
        client.productionMarking = !!settings.productionMarking
        await client.login(String(body.username || ''), String(body.password || ''))
        if (runtimeDisposed) throw new Error('账号运行实例已关闭，登录回执不再生效')
        state.client = client; state.connected = true; state.name = String(body.name || ''); state.base = base
        state.username = String(body.username || '')
        state.exams = []; state.subjects = []; state.questions = []; state.exam = state.subject = state.question = ''
        state.paperStudents = null
        state.markingSession = null; state.autoMark = null; state.gradingControls = null
        state.manualMark = null
        state.job = null
        loadUserSettings()
        try { state.exams = await client.listExams() } catch (e) { /* 不阻断登录 */ }
        return sendJson(res, stateView())
      }
      if (p === '/ameqp-grading/api/disconnect') {
        assertIdle()
        assertNoHeldClaim()
        if (state.client) { await state.client.logout().catch(() => {}) }
        state.client = null; state.connected = false; state.name = ''; state.model = null; state.username = ''
        state.exams = []; state.subjects = []; state.questions = []; state.exam = state.subject = state.question = ''
        state.paperStudents = null
        state.markingSession = null; state.autoMark = null; state.gradingControls = null
        state.manualMark = null
        state.job = null
        return sendJson(res, stateView())
      }
      if (p === '/ameqp-grading/api/exams') { if (!state.client) throw new Error('请先连接账号'); state.exams = await state.client.listExams(); return sendJson(res, state.exams) }
      if (p === '/ameqp-grading/api/subjects') {
        assertIdle()
        assertNoHeldClaim()
        if (!state.client) throw new Error('请先连接账号')
        state.exam = String(body.exam || ''); state.subjects = await state.client.listSubjects(Number(body.exam))
        state.subject = ''; state.questions = []; state.question = ''; state.paperStudents = null
        return sendJson(res, state.subjects)
      }
      if (p === '/ameqp-grading/api/questions') {
        assertIdle()
        assertNoHeldClaim()
        if (!state.client) throw new Error('请先连接账号')
        state.subject = String(body.subject || '')
        const sub = state.subjects.find((s) => s.id === Number(body.subject))
        if (!sub) throw new Error('请选择该考试下的科目')
        const exam = Number(body.exam); const subject = Number(body.subject)
        // 优先走阅卷会话（GetSessionId + GetDefQuestion + GetDefQuestionInfo）拿真实分值；
        // 失败则回退到只读列表接口 getExamQuestion（分值可能为 0）。
        try {
          const key = `${exam}:${subject}`
          if (!state.markingSession || state.markingSession.key !== key) {
            const sess = await state.client.getSessionId()
            state.markingSession = { key, sessionId: sess.SessionId, teaSN: sess.teaSN || null, timeout: sess.Timeout }
          }
          const qs = await state.client.defQuestions(exam, subject, state.markingSession.sessionId)
          const withScore = []
          for (const q of qs) {
            let max_score = 0
            try {
              const info = await state.client.defQuestionInfo(exam, subject, q.id, state.markingSession.sessionId)
              max_score = Number(info.queScore) || 0
            } catch (e) { /* 分值读取失败则保留 0 */ }
            const saved = configs[`${exam}:${subject}:${q.id}`]
            withScore.push({ ...q, max_score: resolveMaxScore({ online: max_score, saved: saved?.max_score, criteria: saved?.criteria }) })
          }
          state.questions = withScore
        } catch (e) {
          state.questions = (await state.client.listQuestions(exam, subject, sub.is_create)).map((q) => {
            const saved = configs[`${exam}:${subject}:${q.id}`]
            return { ...q, max_score: resolveMaxScore({ online: q.max_score, saved: saved?.max_score, criteria: saved?.criteria }) }
          })
        }
        state.question = ''; state.paperStudents = null
        return sendJson(res, state.questions)
      }
      // 纯查询：不修改 state.question（避免与前端轮询/选择状态互相覆盖）
      if (p === '/ameqp-grading/api/question-config') { return sendJson(res, resolveConfig(body)) }
      if (p === '/ameqp-grading/api/save-config') {
        assertIdle()
        const selection = selectionOf(body)
        const cfg = body.config || {}
        const question = Number(body.question)
        const meta = questionMetaFor(selection.exam, selection.subject, question)
        const key = `${body.exam}:${body.subject}:${question}`
        if (!String(cfg.question_prompt || '').trim()) throw new Error('请填写本题提示词及评分标准')
        const maxScore = resolveMaxScore({ online: meta?.max_score, saved: configs[key]?.max_score, explicit: cfg.max_score, criteria: configs[key]?.criteria })
        const criteria = validateCriteria(cfg.criteria, maxScore, cfg.grading_method || 'rubric')
        const conflicts = rubricWarnings(criteria)
        if (conflicts.length) throw new Error(conflicts.join('；'))
        const penalty = Number(cfg.extra_line_penalty || 0)
        if (!Number.isFinite(penalty) || penalty < 0) throw new Error('多补线扣分必须为非负数')
        // 图片（可选，dataURL）；校验并限制大小
        const stem_image = cfg.stem_image ? (() => { const d = parseDataUrl(cfg.stem_image); if (d.bytes.length > 2 * 1024 * 1024) throw new Error('题干图请控制在2MB以内'); return String(cfg.stem_image) })() : null
        const reference_image = cfg.reference_image ? (() => { const d = parseDataUrl(cfg.reference_image); if (d.bytes.length > 2 * 1024 * 1024) throw new Error('参考答案图请控制在2MB以内'); return String(cfg.reference_image) })() : null
        const clean = {
          question_prompt: String(cfg.question_prompt || '').slice(0, 30000),
          question: String(cfg.question || '').slice(0, 30000),
          teacher_standard: String(cfg.teacher_standard || '').slice(0, 30000),
          criteria: criteria.map((c) => ({ id: String(c.id), description: String(c.description || ''), max_score: Number(c.max_score) })),
          max_score: maxScore,
          extra_line_penalty: penalty,
          rubric_version: String(cfg.rubric_version || 'custom-v1'),
          grading_method: cfg.grading_method || 'rubric',
          question_type: cfg.question_type || 'other',
          stem_image, reference_image,
        }
        configs[key] = clean
        staticImageCache.delete(key)
        attachmentRefCache.delete(key)
        invalidateAutoResult(key)
        persistConfigs()
        return sendJson(res, { ...clean, exam: Number(body.exam), subject: Number(body.subject), question_id: question, max_score: maxScore })
      }
      if (p === '/ameqp-grading/api/llm-models') {
        // 列出 DSH 当前已注册的 provider 及其可用模型，供前端下拉选择。
        const out = []
        try {
          const llm = ctx.get('llm')
          if (llm && typeof llm.listProviders === 'function') {
            const providers = llm.listProviders()
            for (const pv of providers || []) {
              const entry = { provider: pv.id, name: pv.name || pv.id, models: [] }
              try {
                const models = await llm.listModels(pv.id)
                entry.models = (models || []).map((m) => ({
                  id: m.id, name: m.name || m.id,
                  image: Array.isArray(m.inputModalities) ? m.inputModalities.includes('image') : false,
                }))
              } catch (e) { entry.error = e && e.message ? e.message : String(e) }
              out.push(entry)
            }
          }
        } catch (e) { /* 返回空列表 */ }
        // 当前会话默认选择
        let def = null
        try { const adm = ctx.get('agentDefaultModel'); def = adm && adm.currentSelection ? adm.currentSelection() : null } catch { /* ignore */ }
        return sendJson(res, { providers: out, current: def ? { provider: def.provider, model: def.model } : null })
      }
      if (p === '/ameqp-grading/api/model') {
        assertIdle()
        if (body.grading_effort && !['low', 'default'].includes(body.grading_effort)) throw new Error('阅卷推理强度无效')
        const mode = body.mode === 'api' ? 'api' : 'harness'
        if (mode === 'api') {
          const endpoint = String(body.base_url || '').trim()
          let parsed
          try { parsed = new URL(endpoint) } catch { throw new Error('模型地址格式无效') }
          if (!(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)))) throw new Error('模型地址须为 HTTPS 或本机 HTTP，且不含凭证')
          if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('模型地址不能包含凭证或查询参数')
          if (!String(body.model || '').trim()) throw new Error('请填写模型名称')
          state.model = { mode: 'api', base_url: endpoint, model: String(body.model).trim(), api_key: String(body.api_key || '') }
        } else { state.model = { mode: 'harness', provider: String(body.provider || ''), model: String(body.model || '').trim() } }
        state.model.grading_effort = body.grading_effort || 'low'
        invalidateAutoResult()
        state.gradingControls = null
        saveUserSettings()
        return sendJson(res, stateView())
      }
      if (p === '/ameqp-grading/api/save-prompt') {
        assertIdle()
        const text = String(body.prompt || '')
        if (!text.trim()) throw new Error('总提示词不能为空')
        prompt = text.slice(0, 100000)
        invalidateAutoResult()
        persistPrompt()
        saveUserSettings()
        return sendJson(res, { prompt, prompt_version: PROMPT_VERSION })
      }
      if (p === '/ameqp-grading/api/reset-defaults') {
        assertIdle()
        // 一键恢复默认：清空当前账号的模型与总提示词，并恢复内置总提示词。
        const k = currentUserKey()
        delete userSettings[k]
        persistUserSettings()
        state.model = null
        invalidateAutoResult()
        prompt = builtinPrompt()
        persistPrompt()
        return sendJson(res, stateView())
      }
      if (p === '/ameqp-grading/api/config-generate') {
        assertIdle()
        if (!state.model) throw new Error('尚未配置模型，请先到下方配置模型')
        const exam = Number(body.exam); const subject = Number(body.subject); const question = Number(body.question)
        if (![exam, subject, question].every((n) => Number.isInteger(n) && n > 0)) throw new Error('请先选择有效考试、科目和题目')
        const mode = body.mode || 'generate'
        if (!['generate', 'optimize'].includes(mode)) throw new Error('生成模式无效')
        const type = body.question_type || 'other'
        if (!QUESTION_TYPES[type]) throw new Error('题目类型无效')
        const meta = questionMetaFor(exam, subject, question)
        const savedConfig = configs[`${exam}:${subject}:${question}`]
        const maxScore = resolveMaxScore({ online: meta?.max_score, saved: savedConfig?.max_score, explicit: body.max_score, criteria: savedConfig?.criteria })
        if (!Number.isFinite(maxScore) || maxScore <= 0) throw new Error('缺少有效题目满分，请重新载入题目')
        const method = methodForType(type)
        const existing = body.existing && typeof body.existing === 'object' ? body.existing : configs[`${exam}:${subject}:${question}`]
        if (mode === 'optimize') {
          validateCriteria(existing?.criteria, maxScore, method)
          if (existing.grading_method && existing.grading_method !== method) throw new Error('优化现有配置不能改变评分方式；如需变更题型请使用首次生成')
        }
        const teacherStandard = String(body.teacher_standard ?? existing?.teacher_standard ?? '').slice(0, 30000)
        const stemImage = body.stem_image ? parseDataUrl(body.stem_image) : null
        const refImage = body.reference_image ? parseDataUrl(body.reference_image) : null
        if ([stemImage, refImage].some((im) => im && im.bytes.length > 2 * 1024 * 1024)) throw new Error('图片请控制在2MB以内')
        if (!stemImage && !refImage && !String(existing?.question || '').trim() && !teacherStandard.trim()) throw new Error('请提供题干文字、题干图或教师标准后生成')
        const request = generationRequest({ mode, typeLabel: QUESTION_TYPES[type].label, method, maxScore, existing, teacherStandard, questionType: type })
        const generationValidation = { mode, existing, maxScore, method, teacherStandard, questionType: type }
        const textContent = [{ type: 'text', text: request.text }]
        let generated
        // Configuration authoring keeps the model's normal reasoning default.
        // Only per-paper grading receives the low-effort override.
        if (state.model.mode === 'harness') {
          const { llm, attachments } = harnessServices(!!(stemImage || refImage))
          const resolved = resolveHarnessModel(state.model)
          if (!resolved.provider || !resolved.model) throw new Error('请填写模型名，或确认当前会话已选择模型')
          for (const [label, im] of [['题干图', stemImage], ['参考答案图（非学生作答）', refImage]]) {
            if (!im) continue
            textContent.push({ type: 'text', text: label }, { type: 'image', attachment: await attachments.saveImage({ data: new Uint8Array(im.bytes), mediaType: im.mediaType, name: label }) })
          }
          const text = await collectLlmText(llm.stream({ provider: resolved.provider, model: resolved.model, system: request.system, messages: [{ role: 'user', content: textContent }] }))
          generated = extractJson(text, { validate: (value) => validateGenerated(value, generationValidation) })
        } else {
          if (stemImage) textContent.push({ type: 'text', text: '题干图：' }, imagePart(stemImage.bytes, stemImage.mediaType))
          if (refImage) textContent.push({ type: 'text', text: '参考答案图（非学生作答）：' }, imagePart(refImage.bytes, refImage.mediaType))
          const body2 = { model: state.model.model, messages: [{ role: 'system', content: request.system }, { role: 'user', content: textContent }], response_format: { type: 'json_object' } }
          const res2 = await fetch(state.model.base_url.replace(/\/+$/, '') + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (state.model.api_key || '') }, body: JSON.stringify(body2) })
          if (!res2.ok) throw new Error('生成失败：HTTP ' + res2.status)
          const r2 = await res2.json()
          generated = extractJson(r2.choices?.[0]?.message?.content || '', { validate: (value) => validateGenerated(value, generationValidation) })
        }
        const clean = validateGenerated(generated, { mode, existing, maxScore, method, teacherStandard, questionType: type })
        return sendJson(res, { ...clean, teacher_standard: teacherStandard, grading_method: method, question_type: type, max_score: maxScore })
      }
      if (p === '/ameqp-grading/api/paper-load') {
        assertIdle()
        assertNoHeldClaim()
        if (recovery?.pending) throw new Error('存在未确认答卷，请先核对恢复记录')
        if (!state.client) throw new Error('请先连接账号')
        const exam = Number(body.exam); const subject = Number(body.subject); const question = Number(body.question)
        const index = Number(body.index || 0)
        const students = await ensurePaperStudents(exam, subject, index)
        const student = students.list[index]
        if (!student) throw new Error('该位置没有答卷')
        const config = resolveConfig({ exam, subject, question })
        const meta = await state.client.studentMeta(exam, subject, student.ansStuSN)
        // 优先走「只读取图」路径（getStuImgList + GetDefQuestionInfo + Show_Image），进行中考试也可用；
        // 回退到已完成考试的 getimgandque 路径。
        let answers = []
        try {
          const key = `${exam}:${subject}`
          if (!state.markingSession || state.markingSession.key !== key) {
            const sess = await state.client.getSessionId()
            state.markingSession = { key, sessionId: sess.SessionId, teaSN: sess.teaSN || null, timeout: sess.Timeout }
          }
          answers = await state.client.questionCropImages(exam, subject, question, student.ansStuSN, state.markingSession.sessionId)
        } catch (e) {
          try { answers = await state.client.answerImages(exam, subject, question, meta.stuSN) }
          catch (e2) { throw new Error('答卷图读取失败：' + (e2.message || e.message)) }
        }
        // 写磁盘缓存
        ensureDir(cacheDir); pruneCache()
        for (let i = 0; i < answers.length; i++) fs.writeFileSync(paperCachePath(exam, subject, question, index, i), answers[i].bytes)
        const images = answers.map((a, i) => `/ameqp-grading/api/paper-image?exam=${exam}&subject=${subject}&question=${question}&index=${index}&page=${i}`)
        return sendJson(res, {
          paper_id: 'paper' + String(index + 1).padStart(5, '0'),
          index, total: students.list.length, image_count: answers.length, images,
          max_score: config.max_score, criteria: config.criteria, grading_method: config.grading_method, extra_line_penalty: config.extra_line_penalty,
        })
      }
      if (p === '/ameqp-grading/api/save-review') {
        const exam = Number(body.exam); const subject = Number(body.subject); const question = Number(body.question)
        const index = Number(body.index)
        const key = `${exam}:${subject}:${question}`
        const paper_id = 'paper' + String(index + 1).padStart(5, '0')
        if (!reviews[key]) reviews[key] = {}
        const scores = body.scores || {}
        reviews[key][paper_id] = {
          paper_id, scores, final_score_override: body.final_score_override ?? null, notes: String(body.notes || '').slice(0, 10000), at: new Date().toISOString(),
        }
        persistReviews()
        return sendJson(res, { ok: true, paper_id, review: reviews[key][paper_id] })
      }
      if (p === '/ameqp-grading/api/review-get') {
        const exam = Number(body.exam); const subject = Number(body.subject); const question = Number(body.question)
        const index = Number(body.index)
        const key = `${exam}:${subject}:${question}`
        const paper_id = 'paper' + String(index + 1).padStart(5, '0')
        return sendJson(res, (reviews[key] && reviews[key][paper_id]) || null)
      }
      if (p === '/ameqp-grading/api/start') {
        assertIdle()
        assertNoHeldClaim()
        if (recovery?.pending) throw new Error('存在未确认答卷，请先在原系统核对恢复记录')
        if (!state.client) throw new Error('请先连接账号')
        if (state.job && ['running', 'stopping'].includes(state.job.status)) throw new Error('已有任务在运行')
        if (!state.model) throw new Error('尚未配置模型，请先到设置页配置')
        assertModelServices(state.model)
        const exam = Number(body.exam); const subject = Number(body.subject); const question = Number(body.question)
        const config = resolveConfig({ exam, subject, question })
        if (!String(config.question_prompt || '').trim()) throw new Error('请先保存本题提示词和评分标准')
        assertConfigReady(config)
        const limit = Number(body.limit || 10)
        if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw new Error('每批数量须为1至2000')
        const id = crypto.randomBytes(16).toString('hex')
        state.stopRequested = false
        jobController = new AbortController()
        // 准备阅卷会话（供只读取图使用）
        let sessionId = ''
        try {
          const key = `${exam}:${subject}`
          if (!state.markingSession || state.markingSession.key !== key) {
            const sess = await state.client.getSessionId()
            state.markingSession = { key, sessionId: sess.SessionId, teaSN: sess.teaSN || null, timeout: sess.Timeout }
          }
          sessionId = state.markingSession.sessionId
        } catch (e) { /* 会话失败则依赖回退路径 */ }
        state.job = { id, status: 'running', phase: '准备读取答卷', requested: limit, processed: 0, scored: 0, review: 0, failed: 0, results: [], selection: { exam, subject, question }, title: config.title || '', model: state.model.model || '(DSH 当前模型)', prompt_version: PROMPT_VERSION }
        const dir = path.join(dataDir, 'jobs', id)
        ensureDir(dir)
        writeJson(path.join(dir, 'frozen-input.json'), { config, prompt, prompt_version: PROMPT_VERSION, model: { mode: state.model.mode, model: state.model.model } })
        saveJob(dir)
        state.taskId = crypto.randomUUID()
        const frozenModel = structuredClone(state.model.mode === 'harness' ? resolveHarnessModel(state.model) : state.model)
        ;(async () => { await runJob(frozenModel, structuredClone(config), limit, exam, subject, question, dir, sessionId, prompt) })()
        return sendJson(res, stateView())
      }
      if (p === '/ameqp-grading/api/stop') {
        if (state.job && state.job.status === 'running') { state.stopRequested = true; jobController?.abort(); state.job.status = 'stopping'; state.job.phase = '当前请求结束后停止' }
        return sendJson(res, stateView())
      }

      /* ---------- 正式阅卷：领卷 / 提交评分 / 取消领卷（仅 productionMarking=true 时可用） ---------- */

      if (p === '/ameqp-grading/api/marking-get') {
        return await markingOperation(async () => {
          const selection = selectionOf(body)
          if (pendingAutoClaim()) throw new Error('AI仍有未提交答卷，请继续当前份或取消领卷')
          if (state.manualMark) {
            matchClaim(state.manualMark, selection, state.manualMark.ansQueSN)
            return sendJson(res, state.manualMark)
          }
          const session = await ensureMarkingSession(selection)
          if (runtimeDisposed) throw new Error('账号运行实例已关闭')
          state.taskId = crypto.randomUUID()
          let data
          try { data = await state.client.getQuestion(selection.exam, selection.subject, selection.question, session.sessionId, false) }
          catch (error) { if (error.claimUncertain) recordUnknownClaim(selection); throw error }
          if (!data?.ansQueSN) throw new Error('当前试题已无可评试卷')
          beginHeartbeat(selection, session)
          state.manualMark = { ...cacheClaim(data, [], selection), selection, teaSN: session.teaSN }
          checkpoint()
          const images = await readClaimImages(state.client, selection.exam, selection.subject, selection.question, session.sessionId, data)
          state.manualMark = { ...cacheClaim(data, images, selection), selection, teaSN: session.teaSN }
          return sendJson(res, state.manualMark)
        })
      }
      if (p === '/ameqp-grading/api/marking-submit') {
        return await markingOperation(async () => {
          const selection = selectionOf(body)
          const claim = ownedClaim(selection, Number(body.ansQueSN))
          if (claim.submissionUncertain || autoRuntime.get(state.autoMark)?.submissionUncertain) throw new Error('上一份提交结果未确认，请先在原系统核对，禁止重复提交')
          const session = state.markingSession
          if (!session?.teaSN) throw new Error('缺少有效阅卷会话，请重新登录')
          const maxScore = resolveConfig(selection).max_score
          const value = body.value
          if (!Number.isFinite(maxScore) || maxScore <= 0) throw new Error('满分未知，禁止提交；请先载入题目配置')
          if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > maxScore) throw new Error('最终分须为整数且在0至本题满分之间')
          const points = Array.isArray(body.points) ? body.points : []
          if (points.some((p) => typeof p.value !== 'number' || !Number.isFinite(p.value) || p.value < 0)) throw new Error('分项分数无效')
          const teaSN = session.teaSN
          const mPois = points.map((p) => ({ poiSN: p.poiSN, marPoiSN: p.marPoiSN, teaSN, ansQueSN: claim.ansQueSN, queSN: selection.question, ansPoiSN: p.ansPoiSN,
            marQueMarkKind: claim.ansQueMarkState, marPoiMarkValue: p.value, marIsTryMark: !!claim.marIsTryMark }))
          const ansMar = {
            sigSN: Number(body.sigSN) || 0, marQueSpotCheck_Updated: false, IsReview: !!body.isReview,
            Point: mPois, Count: mPois.length, marQueSN: Number(body.marQueSN) || 0,
            teaSN, queSN: selection.question, ansQueSN: claim.ansQueSN, marQueMarkKind: claim.ansQueMarkState,
            ansMultiMethod: claim.ansMultiMethod || '', marQueMarkPostTime: formatDate(new Date()), marQueMarkValue: value,
            marQueRefEna: false, marIsTryMark: !!claim.marIsTryMark, marQueSignEna: !!body.sigSN,
            marQueMarkOutTime: formatDate(new Date()), marQuePostilExist: false,
          }
          const tracked = state.manualMark || state.autoMark.current
          tracked.submissionUncertain = true
          checkpoint()
          const runtime = state.autoMark && autoRuntime.get(state.autoMark)
          if (runtime) runtime.submissionUncertain = true
          const data = await state.client.submitScore(selection.exam, selection.subject, selection.question, session.sessionId, ansMar, [], Number(body.oldVal) || 0, claim.ansMultiMethod || 'A')
          clearOwnedClaim(claim, '已人工提交', value)
          return sendJson(res, { ok: true, data })
        })
      }
      if (p === '/ameqp-grading/api/marking-cancel') {
        return await markingOperation(async () => {
          const selection = selectionOf(body)
          const claim = ownedClaim(selection, Number(body.ansQueSN))
          if (claim.submissionUncertain || autoRuntime.get(state.autoMark)?.submissionUncertain) throw new Error('上一份提交结果未确认，请先在原系统核对后处理')
          if (!state.markingSession) throw new Error('阅卷会话已失效，请重新登录')
          await state.client.cancelQuestion(selection.exam, selection.subject, selection.question, state.markingSession.sessionId, claim.ansQueSN, claim.ansQueMarkState, !!body.isReview, claim.ansMultiMethod)
          clearOwnedClaim(claim, '已取消领卷')
          return sendJson(res, { ok: true })
        })
      }
      if (p === '/ameqp-grading/api/marking-auto-start') {
        if (['running', 'stopping'].includes(state.autoMark?.status)) {
          const selection = selectionOf(body)
          if (['exam', 'subject', 'question'].some((key) => state.autoMark.selection[key] !== selection[key])) throw new Error('该账号已有其他题目的阅卷任务，请先结束当前任务')
          return sendJson(res, stateView())
        }
        return await markingOperation(async () => {
          if (pendingAutoClaim() || state.manualMark) throw new Error('仍有未提交答卷，请继续当前份或取消领卷后再启动')
          if (!modelReady(state.model)) throw new Error('请先配置可用的评分模型')
          assertModelServices(state.model)
          const selection = selectionOf(body)
          const config = resolveConfig(selection)
          if (!config.question_prompt?.trim()) throw new Error('请先保存本题提示词和评分标准')
          assertConfigReady(config)
          const session = await ensureMarkingSession(selection)
          const am = { status: 'running', inFlight: false, current: null, phase: '启动', submitted: 0, batchSubmitted: 0, batchNumber: 1, batchLimit: autoBatchLimit(), pauseReason: null, review: 0, failed: 0, selection, gen: 0, stream: newPreview(null) }
          state.taskId = crypto.randomUUID()
          am.taskId = state.taskId
          state.autoMark = am
          launchAuto(am, { ...state.model }, config, selection, { ...session })
          return sendJson(res, stateView())
        })
      }
      if (p === '/ameqp-grading/api/marking-auto-stop' || p === '/ameqp-grading/api/marking-auto-pause') {
        const am = state.autoMark
        if (am) {
          const pause = p.endsWith('-pause')
          am.status = pause ? 'paused' : am.inFlight ? 'stopping' : 'stopped'
          am.phase = am.inFlight ? (pause ? '暂停中，等待当前请求结束' : '正在停止，等待当前请求结束') : (pause ? '已暂停' : '已停止')
          autoRuntime.get(am)?.controller?.abort()
        }
        return sendJson(res, stateView())
      }
      if (p === '/ameqp-grading/api/marking-auto-resume') {
        return await markingOperation(async () => {
          if (!modelReady(state.model)) throw new Error('请先配置可用的评分模型')
          assertModelServices(state.model)
          const am = state.autoMark
          if (state.manualMark) throw new Error('该账号有手工占用答卷，请先处理手工答卷')
          if (!am || am.taskId !== state.taskId || !['paused', 'stopped'].includes(am.status)) throw new Error('当前不在可继续状态')
          const runtime = autoRuntime.get(am)
          if (!runtime) throw new Error('阅卷上下文已失效，请重新启动')
          if (runtime.submissionUncertain) throw new Error('上一份提交结果未确认，请先在原系统核对，不能自动重复提交')
          if (runtime.result?.needs_human_review) throw new Error('当前答卷需要人工复核，请人工提交或取消领卷')
          const config = runtime.configDirty ? resolveConfig(am.selection) : runtime.snapshot.config
          assertConfigReady(config)
          if (!runtime.claim && (am.pauseReason === 'batch_limit' || am.batchSubmitted >= (am.batchLimit || autoBatchLimit()))) {
            am.batchSubmitted = 0
            am.batchNumber = (am.batchNumber || 1) + 1
            am.batchLimit = autoBatchLimit()
          }
          launchAuto(am, { ...state.model }, config, am.selection, runtime.session)
          return sendJson(res, stateView())
        })
      }
      return sendJson(res, { error: 'not found' }, 404)
    } catch (error) {
      sendJson(res, { error: String((error && error.message) || error) }, 500)
    }
  }

  return { handler, view: stateView, dispose() {
    decisionTestController?.abort()
    heartbeatTarget = null
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    state.stopRequested = true
    jobController?.abort()
    const am = state.autoMark
    if (am) { am.status = am.inFlight ? 'stopping' : 'stopped'; autoRuntime.get(am)?.controller?.abort() }
    checkpoint()
    runtimeDisposed = true
  } }
}
