import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { PassThrough } from 'node:stream'
import { ModelScheduler } from './model-scheduler.js'

const PREFIX = '/ameqp-grading/api/'
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } }
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n')
  fs.renameSync(temporary, file)
}
function canonicalBase(value) {
  const url = new URL(String(value || '').trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('阅卷地址须为 HTTP/HTTPS 地址，且不含凭证或查询参数')
  url.pathname = url.pathname.replace(/\/+$/, '') + '/'
  return url.href
}
async function bodyOf(req) {
  let length = 0
  const chunks = []
  for await (const chunk of req) {
    length += Buffer.byteLength(chunk)
    if (length > 8 * 1024 * 1024) throw new Error('请求内容超过大小限制')
    chunks.push(Buffer.from(chunk))
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求必须为JSON对象')
  return value
}
function json(res, data, status = 200) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(data))
}

// No worker is selected globally: every request has an explicit account or the
// permanently reserved default account. A UI tab cannot redirect an in-flight write.
export function createParallelHost(ctx, config = {}, createRuntime) {
  const root = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'ameqp-grading')
  const registryFile = path.join(root, 'parallel-accounts.json')
  const scheduler = new ModelScheduler(config)
  const accounts = new Map()
  const adding = new Set()
  let disposed = false
  async function activeBody(req) {
    const body = await bodyOf(req)
    if (disposed) throw new Error('插件已卸载，操作已取消')
    return body
  }
  function create(record) {
    const runtime = createRuntime(ctx, config, {
      accountId: record.accountId, accountRecord: { username: record.username, base: record.base, name: record.name },
      dataDir: record.accountId === 'default' ? root : path.join(root, 'accounts', record.accountId),
      legacyDataDir: root,
      scheduler,
      onChange: () => {},
    })
    const item = { ...record, runtime }
    accounts.set(record.accountId, item)
    return item
  }
  const saved = read(registryFile, { accounts: [] })
  const previousDefault = (saved.accounts || []).find((a) => a.accountId === 'default')
  create({ accountId: 'default', username: String(previousDefault?.username || ''), base: canonicalBase(previousDefault?.base || config.ameqpBase || 'https://example.invalid/AMEQP/'), name: String(previousDefault?.name || ''), isDefault: true })
  for (const record of saved.accounts || []) {
    if (record.accountId === 'default') {
      Object.assign(accounts.get('default'), { username: record.username || '', name: record.name || '', base: record.base || accounts.get('default').base })
    } else if (/^[a-f0-9-]{36}$/.test(record.accountId || '')) {
      try { create({ accountId: record.accountId, username: String(record.username || ''), base: canonicalBase(record.base), name: String(record.name || ''), isDefault: false }) } catch { /* Invalid saved record is never executed. */ }
    }
  }
  function persist() {
    atomic(registryFile, { version: 1, accounts: [...accounts.values()].map(({ accountId, username, base, name, isDefault }) => ({ accountId, username, base, name, isDefault })) })
  }
  function summary(item) {
    const state = item.runtime.view()
    const am = state.autoMark
    return {
      accountId: item.accountId, isDefault: item.isDefault,
      username: state.username || item.username, name: state.name || item.name, base: state.connected ? state.base : item.base,
      connected: state.connected, taskId: state.taskId, recovery: state.recovery,
      autoMark: am ? { taskId: state.taskId, status: am.status, phase: am.phase, submitted: am.submitted, review: am.review, failed: am.failed,
        inFlight: am.inFlight, selection: am.selection, submissionUncertain: am.submissionUncertain,
        model: am.model, tModelMs: am.tModelMs, lastCostSec: am.lastCostSec } : null,
      manualPending: !!state.manualMark,
      job: state.job ? { status: state.job.status, processed: state.job.processed, requested: state.job.requested, phase: state.job.phase } : null,
    }
  }
  function overview() {
    return { accounts: [...accounts.values()].map(summary), defaultAccountId: 'default', maxConcurrentModels: scheduler.limit, scheduler: scheduler.view() }
  }
  function identity(base, username) { return `${canonicalBase(base)}\n${String(username).trim()}` }
  function ensureUnique(base, username, ownId) {
    const key = identity(base, username)
    if (!username) throw new Error('请输入账号')
    for (const item of accounts.values()) {
      const state = item.runtime.view()
      const user = state.username || item.username
      const addr = state.connected ? state.base : item.base
      if (item.accountId !== ownId && user && identity(addr, user) === key) throw new Error('该站点账号已存在，请切换查看或重新连接原账号')
    }
    if (adding.has(key)) throw new Error('该账号正在连接，请勿重复登录')
    return key
  }
  const concurrentReads = new Set(['question-config', 'llm-models', 'review-get', 'decisions-test'])
  const interrupts = new Set(['marking-auto-pause', 'marking-auto-stop', 'stop'])
  async function exclusive(item, operation, action) {
    if (disposed) throw new Error('插件已卸载，操作已取消')
    if (concurrentReads.has(operation) || interrupts.has(operation)) return action()
    if (item.requestBusy) throw new Error('该账号另一个操作尚未结束，请稍候')
    item.requestBusy = true
    try { return await action() } finally { item.requestBusy = false }
  }
  async function invoke(item, operation, body, scoped = true) {
    return exclusive(item, operation, async () => {
    const req = new PassThrough()
    req.url = PREFIX + operation; req.method = 'POST'; req.accountScoped = scoped
    let data, status
    const response = { statusCode: 200, setHeader() {}, end(value) { data = JSON.parse(String(value)); status = this.statusCode } }
    const pending = item.runtime.handler(req, response)
    req.end(JSON.stringify(body))
    await pending
    return { data, status }
    })
  }
  function updateRecord(item) {
    if (disposed) throw new Error('插件已卸载，操作已取消')
    const state = item.runtime.view()
    if (state.username) { item.username = state.username; item.base = state.base; item.name = state.name }
    persist()
  }
  async function addAccount(body) {
    const base = canonicalBase(body.base || config.ameqpBase || 'https://example.invalid/AMEQP/')
    const username = String(body.username || '').trim()
    const key = ensureUnique(base, username)
    adding.add(key)
    // Use the reserved default connection on first login so old endpoints keep
    // addressing the first account, regardless of subsequent UI selection.
    const first = accounts.get('default')
    const item = !first.username && !first.reserved && !first.requestBusy && !first.runtime.view().connected && !first.runtime.view().recovery ? first
      : create({ accountId: crypto.randomUUID(), username, base, name: String(body.name || ''), isDefault: false })
    item.reserved = true
    try {
      const result = await invoke(item, 'login', { ...body, base, username })
      if (result.status !== 200) {
        if (!item.isDefault) { item.runtime.dispose(); accounts.delete(item.accountId) }
        return result
      }
      updateRecord(item)
      return result
    } finally { item.reserved = false; adding.delete(key) }
  }
  async function handler(req, res) {
    try {
      if (disposed) return json(res, { error: '插件已卸载' }, 503)
      const url = new URL(req.url || '/', 'http://localhost')
      const operation = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : ''
      if (operation === 'accounts') {
        if (req.method === 'GET') return json(res, overview())
        if (req.method !== 'POST') return json(res, { error: 'method not allowed' }, 405)
        const result = await addAccount(await activeBody(req))
        return json(res, result.data, result.status)
      }
      if (operation === 'tasks/pause-all' && req.method === 'POST') {
        await activeBody(req)
        const results = await Promise.all([...accounts.values()].map(async (item) => {
          const state = item.runtime.view()
          if (['running', 'stopping'].includes(state.autoMark?.status) || state.autoMark?.inFlight) {
            return invoke(item, 'marking-auto-pause', { taskId: state.taskId })
          }
          if (['running', 'stopping'].includes(state.job?.status)) return invoke(item, 'stop', { taskId: state.taskId })
          return { status: 200 }
        }))
        return json(res, { ...overview(), errors: results.filter((r) => r.status !== 200).map((r) => r.data.error) })
      }
      const match = /^accounts\/([^/]+)\/(.+)$/.exec(operation)
      if (operation.startsWith('accounts/') && !match) return json(res, { error: '无效账号路径' }, 404)
      const item = accounts.get(match ? match[1] : 'default')
      if (!item) return json(res, { error: '账号不存在' }, 404)
      const localOperation = match ? match[2] : operation
      if (req.method === 'POST' && localOperation === 'login') {
        const body = await activeBody(req)
        const base = canonicalBase(body.base || item.base)
        const username = String(body.username || item.username || '').trim()
        const previous = item.runtime.view()
        const mayReplaceDefault = item.isDefault && !previous.connected && !previous.recovery
        if (item.username && identity(base, username) !== identity(item.base, item.username) && !mayReplaceDefault) throw new Error('请通过添加账号建立其他连接，不能替换已有账号身份')
        const key = ensureUnique(base, username, item.accountId)
        adding.add(key)
        try {
          const result = await invoke(item, 'login', { ...body, base, username }, !!match)
          if (result.status === 200) updateRecord(item)
          return json(res, result.data, result.status)
        } finally { adding.delete(key) }
      }
      // The stream remains untouched. The worker verifies taskId after reading
      // its body, so the identity guard and business operation share one read.
      const originalUrl = req.url
      req.url = match ? PREFIX + localOperation + url.search : req.url
      req.accountScoped = !!match
      try {
        return req.method === 'POST' ? await exclusive(item, localOperation, () => item.runtime.handler(req, res)) : await item.runtime.handler(req, res)
      } finally { req.url = originalUrl }
    } catch (error) { return json(res, { error: error.message || String(error) }, 400) }
  }
  function dispose() {
    disposed = true
    for (const item of accounts.values()) item.runtime.dispose()
    scheduler.dispose()
  }
  ctx.inject(['webServer'], (host) => {
    host.effect(() => host.webServer.register({ kind: 'prefix', path: '/ameqp-grading', handler }), 'ameqp-grading: multi-account api')
    // Context effects own Host work, not a selected Client panel.
    host.effect(() => dispose, 'ameqp-grading: account runtimes')
  })
  return { handler, view: overview, dispose }
}
