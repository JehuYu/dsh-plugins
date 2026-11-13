import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { apply } from '../grading-host.js'
import { ReadonlyClient } from '../ameqp.js'

// Every HTTP route below is invoked in memory. No running DSH or AMEQP server
// is contacted, and DSH_HOME is replaced before apply can inspect persistence.
const realGetQuestion = ReadonlyClient.prototype.getQuestion
const selection = { exam: 1, subject: 2, question: 3 }
const rubric = {
  question: 'Offline sketch', question_prompt: 'OFFLINE_RULE', question_type: 'design',
  grading_method: 'rubric', max_score: 8,
  criteria: [{ id: 'sketch', description: 'Sketch', max_score: 4 }, { id: 'dimensions', description: 'Dimensions', max_score: 4 }],
}
const prediction = { criteria: [{ id: 'sketch', score: 4, image_evidence: 'visible' }, { id: 'dimensions', score: 3, image_evidence: 'visible' }] }
const tick = () => new Promise((resolve) => setImmediate(resolve))
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
function ok(reply) { assert.equal(reply.code, 200, JSON.stringify(reply.body)); return reply.body }
function rejected(reply) {
  assert.ok(reply.code >= 400 && reply.code !== 404, `Expected a guarded operation, got ${reply.code}: ${JSON.stringify(reply.body)}`)
  assert.equal(typeof reply.body.error, 'string')
}

function fixture(t, options = {}) {
  const external = [], logins = [], logouts = [], claims = [], writes = [], cancels = [], modelCalls = [], heartbeats = []
  t.mock.method(globalThis, 'fetch', async (...args) => {
    external.push(String(args[0]))
    throw new Error('All network access is forbidden in parallel offline tests')
  })
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ameqp-parallel-test-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const gates = [], hosts = [], clients = new Map(), counts = new Map()
  function gate() { const g = deferred(); gates.push(g); return g }
  function identity(client) { assert.ok(client.offlineUsername, 'Client must have passed mocked login'); return client.offlineUsername }
  t.mock.method(ReadonlyClient.prototype, 'login', async function (username, password) {
    this.offlineUsername = username
    logins.push({ client: this, username, password, base: this.base })
    if (options.login) await options.login(username)
    clients.set(username, this)
    this.cookies.set('offline-account', username)
  })
  t.mock.method(ReadonlyClient.prototype, 'logout', async function () { logouts.push(identity(this)) })
  t.mock.method(ReadonlyClient.prototype, 'listExams', async function () { return [{ id: 1, name: identity(this) + ' exam' }] })
  t.mock.method(ReadonlyClient.prototype, 'listStudents', async () => [])
  if (options.ansOp) t.mock.method(ReadonlyClient.prototype, 'ansOp', options.ansOp)
  t.mock.method(ReadonlyClient.prototype, 'listSubjects', async () => [{ id: 2, name: 'Offline subject' }])
  t.mock.method(ReadonlyClient.prototype, 'listQuestions', async () => [{ id: 3, name: 'Offline question', max_score: 8 }])
  t.mock.method(ReadonlyClient.prototype, 'getSessionId', async function () { return { SessionId: 'session-' + identity(this), teaSN: identity(this).charCodeAt(0), Timeout: 30 } })
  t.mock.method(ReadonlyClient.prototype, 'keepAlive', async function (...args) {
    heartbeats.push({ username: identity(this), args, client: this })
    if (options.keepAlive) await options.keepAlive(identity(this), args)
    return {}
  })
  t.mock.method(ReadonlyClient.prototype, 'defQuestions', async () => [{ id: 3, name: 'Offline question' }])
  t.mock.method(ReadonlyClient.prototype, 'defQuestionInfo', async () => ({ queScore: 8 }))
  t.mock.method(ReadonlyClient.prototype, 'getQuestion', async function (...args) {
    const username = identity(this), count = (counts.get(username) || 0) + 1
    counts.set(username, count)
    claims.push({ username, args, client: this })
    if (options.realClaim) return realGetQuestion.apply(this, args)
    if (options.claim) return options.claim(username, count, args)
    return count === 1 ? { ansQueSN: 101, ansStuSN: 202, ansQueMarkState: 'A', AnsImagePageRec: [] } : null
  })
  t.mock.method(ReadonlyClient.prototype, 'claimCropImages', async function () {
    return [{ bytes: Buffer.from('offline-image-' + identity(this)), mediaType: 'image/png' }]
  })
  t.mock.method(ReadonlyClient.prototype, 'submitScore', async function (...args) {
    const username = identity(this)
    writes.push({ username, args, client: this })
    if (options.submit) return options.submit(username, args)
    return {}
  })
  t.mock.method(ReadonlyClient.prototype, 'cancelQuestion', async function (...args) {
    cancels.push({ username: identity(this), args })
    return {}
  })
  const llm = {
    resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }),
    stream: async function* (request) {
      modelCalls.push(request)
      if (options.stream) yield* options.stream(request)
      else yield { type: 'text-delta', text: JSON.stringify(prediction) }
    },
  }
  const services = {
    llm, attachments: { saveImage: async () => ({ id: 'offline-image' }) },
    agentDefaultModel: { currentSelection: () => ({ provider: 'offline-provider', model: 'default-vision' }) },
  }
  function createHost() {
    assert.equal(process.env.DSH_HOME, root)
    const registrations = []
    const runtime = apply({ get: (name) => services[name], inject: (_, callback) => callback({
      effect: (fn) => fn(), webServer: { register: (route) => { registrations.push(route); return () => {} } },
    }) }, { productionMarking: true, ameqpBase: 'https://exam.invalid/AMEQP/', ...options.config })
    assert.ok(registrations.length > 0)
    assert.ok(registrations.every((r) => r.path.startsWith('/ameqp-grading')))
    async function call(route, body = {}, method = 'POST') {
      const req = new PassThrough()
      req.method = method; req.url = '/ameqp-grading/api/' + route
      const registered = registrations.find((r) => r.kind === 'prefix' && req.url.startsWith(r.path))
      assert.ok(registered, 'Mock webServer must own every test route')
      let output
      const res = { statusCode: 200, setHeader() {}, end(value) { output = value } }
      const pending = registered.handler(req, res)
      req.end(JSON.stringify(body))
      await pending
      assert.notEqual(output, undefined, `No response for ${route}`)
      return { code: res.statusCode, body: JSON.parse(String(output)) }
    }
    const host = {
      call, handler: registrations[0].handler, dispose: () => runtime?.dispose?.(),
      state: async (id) => ok(await call(id ? `accounts/${encodeURIComponent(id)}/state` : 'state', {}, 'GET')),
      list: async () => ok(await call('accounts', {}, 'GET')),
      scoped: (id, op, body = {}, method = 'POST') => call(`accounts/${encodeURIComponent(id)}/${op}`, body, method),
    }
    hosts.push(host)
    return host
  }
  const host = createHost()
  async function add(username, extra = {}) {
    const state = ok(await host.call('accounts', { base: 'https://exam.invalid/AMEQP/', username, password: 'OFFLINE_PASSWORD', name: username + ' display', ...extra }))
    assert.equal(typeof state.accountId, 'string'); assert.ok(state.accountId)
    assert.ok(Object.hasOwn(state, 'taskId'))
    assert.equal(state.username, username); assert.equal(state.connected, true)
    return state.accountId
  }
  async function loginDefault(username) {
    const state = ok(await host.call('login', { base: 'https://exam.invalid/AMEQP/', username, password: 'OFFLINE_PASSWORD' }))
    assert.equal(state.accountId, 'default')
    return state.accountId
  }
  async function configure(id, model, extra = {}) {
    ok(await host.scoped(id, 'model', { mode: 'harness', provider: 'offline-provider', model, ...extra }))
    ok(await host.scoped(id, 'save-config', { ...selection, config: rubric }))
  }
  async function start(id, body = selection) {
    const state = ok(await host.scoped(id, 'marking-auto-start', body))
    assert.equal(typeof state.taskId, 'string'); assert.ok(state.taskId, 'Auto start must create a task ID')
    return state.taskId
  }
  async function wait(id, predicate, description = 'expected account state') {
    let state
    for (let i = 0; i < 200; i++) {
      await tick()
      state = await host.state(id)
      if (predicate(state)) return state
    }
    assert.fail(`Did not reach ${description}: ${JSON.stringify(state)}`)
  }
  t.after(async () => {
    for (const g of gates) g.resolve()
    for (const h of hosts) await h.call('tasks/pause-all')
    for (let i = 0; i < 30; i++) await tick()
    for (const h of hosts) h.dispose()
    try { assert.deepEqual(external, [], 'An unexpected request escaped the offline client/model mocks') }
    finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
      assert.ok(path.basename(root).startsWith('ameqp-parallel-test-'))
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
  return { ...host, root, add, loginDefault, configure, start, wait, gate, createHost, clients, counts, logins, logouts, claims, writes, cancels, modelCalls, heartbeats, services }
}

test('concurrent first additions reserve distinct account runtimes before login resolves', async (t) => {
  let slow
  const f = fixture(t, { login: async (username) => { if (username === 'A') await slow.promise } })
  slow = f.gate()
  const first = f.add('A')
  try {
    await f.wait(null, () => f.logins.length === 1)
    const b = await f.add('B')
    slow.resolve()
    const a = await first
    assert.notEqual(a, b)
    assert.equal((await f.state(a)).username, 'A')
    assert.equal((await f.state(b)).username, 'B')
    assert.deepEqual(f.logins.map((entry) => entry.username), ['A', 'B'])
    assert.deepEqual(f.logouts, [])
    assert.equal((await f.list()).accounts.filter((entry) => entry.connected).length, 2)
  } finally { slow.resolve(); await first.catch(() => {}) }
})

test('readonly batch start cannot replace an unresolved manual claim or its task ID', async (t) => {
  const f = fixture(t)
  const a = await f.add('A'); await f.configure(a, 'vision-A')
  ok(await f.scoped(a, 'marking-get', selection))
  const before = await f.state(a)
  rejected(await f.scoped(a, 'start', { ...selection, limit: 1 }))
  const after = await f.state(a)
  assert.equal(after.taskId, before.taskId)
  assert.equal(after.manualMark.ansQueSN, 101)
  assert.equal(after.job, null)
  assert.equal(f.claims.length, 1); assert.equal(f.writes.length, 0)
})

test('readonly batch start cannot clear recovery or create a new task after an explicit reconnect', async (t) => {
  const f = fixture(t, { submit: async () => { throw new Error('offline acknowledgement lost') } })
  const a = await f.add('A'); await f.configure(a, 'vision-A')
  await f.start(a)
  await f.wait(a, (s) => s.autoMark?.submissionUncertain && !s.autoMark.inFlight)
  const restarted = f.createHost()
  assert.ok((await restarted.state(a)).recovery?.pending)
  ok(await restarted.scoped(a, 'login', { username: 'A', password: 'offline', base: 'https://exam.invalid/AMEQP/' }))
  const before = await restarted.state(a)
  rejected(await restarted.scoped(a, 'start', { ...selection, limit: 1 }))
  const after = await restarted.state(a)
  assert.equal(after.taskId, before.taskId)
  assert.ok(after.recovery?.pending)
  assert.equal(after.job, null)
  assert.equal(f.writes.length, 1)
})

for (const operation of ['marking-get', 'marking-auto-start']) {
  test(`a real ${operation} transport failure retains unknown claim recovery and forbids another claim`, async (t) => {
    let dispatched = 0
    const f = fixture(t, { realClaim: true, ansOp: async (op, body) => {
      assert.equal(op, 'GetQuestion')
      assert.deepEqual(body, { exaSN: 1, exaSubSN: 2, queSN: 3, IsJudge: 'false', SessionId: 'session-A' })
      dispatched++
      throw new Error('offline transport failed after request dispatch')
    } })
    const a = await f.add('A'); await f.configure(a, 'vision-A')
    const reply = await f.scoped(a, operation, selection)
    if (operation === 'marking-get') rejected(reply)
    else { ok(reply); await f.wait(a, (s) => s.autoMark?.status === 'paused' && !s.autoMark.inFlight) }
    const state = await f.state(a)
    assert.ok(state.recovery?.pending, 'A failed response cannot prove the server did not allocate a paper')
    assert.equal(state.recovery.claim.ansQueSN, null)
    assert.equal(state.recovery.claim.claimUncertain, true)
    rejected(await f.scoped(a, 'marking-get', selection))
    rejected(await f.scoped(a, 'marking-auto-start', selection))
    if (state.taskId) rejected(await f.scoped(a, 'marking-auto-resume', { taskId: state.taskId }))
    const restarted = f.createHost()
    assert.ok((await restarted.state(a)).recovery?.pending)
    assert.equal(dispatched, 1)
    assert.equal(f.writes.length, 0); assert.equal(f.cancels.length, 0)
  })
}

test('disposing while an add-account request body is incomplete prevents the eventual login', async (t) => {
  const f = fixture(t)
  const req = new PassThrough()
  req.method = 'POST'; req.url = '/ameqp-grading/api/accounts'
  let output
  const res = { statusCode: 200, setHeader() {}, end(value) { output = value } }
  const pending = f.handler(req, res)
  await tick()
  f.dispose()
  req.end(JSON.stringify({ base: 'https://exam.invalid/AMEQP/', username: 'late', password: 'offline' }))
  await pending
  rejected({ code: res.statusCode, body: JSON.parse(String(output)) })
  assert.equal(f.logins.length, 0)
  assert.equal(f.claims.length, 0)
  assert.ok(!fs.existsSync(path.join(f.root, 'ameqp-grading', 'parallel-accounts.json')))
})

test('disposing while a scoped marking request body is incomplete prevents a late claim', async (t) => {
  const f = fixture(t)
  const a = await f.add('A'); await f.configure(a, 'vision-A')
  const req = new PassThrough()
  req.method = 'POST'; req.url = `/ameqp-grading/api/accounts/${a}/marking-get`
  let output
  const res = { statusCode: 200, setHeader() {}, end(value) { output = value } }
  const pending = f.handler(req, res)
  await tick()
  f.dispose()
  req.end(JSON.stringify(selection))
  await pending
  rejected({ code: res.statusCode, body: JSON.parse(String(output)) })
  assert.equal(f.claims.length, 0)
})

test('a login response arriving after disposal cannot persist the late account registry', async (t) => {
  let slow
  const f = fixture(t, { login: async () => slow.promise })
  slow = f.gate()
  const pending = f.call('accounts', { username: 'late', password: 'offline', base: 'https://exam.invalid/AMEQP/' })
  await f.wait(null, () => f.logins.length === 1)
  f.dispose()
  slow.resolve()
  rejected(await pending)
  assert.ok(!fs.existsSync(path.join(f.root, 'ameqp-grading', 'parallel-accounts.json')))
  assert.equal(f.claims.length, 0)
})

test('readonly paper loading cannot replace the marking session while a manual claim is held', async (t) => {
  const f = fixture(t)
  const a = await f.add('A'); await f.configure(a, 'vision-A')
  ok(await f.scoped(a, 'marking-get', selection))
  const taskId = (await f.state(a)).taskId
  const reply = await f.scoped(a, 'paper-load', { ...selection, subject: 9 })
  rejected(reply)
  assert.match(reply.body.error, /答卷|占|请求|任务/)
  assert.equal((await f.state(a)).taskId, taskId)
  ok(await f.scoped(a, 'marking-submit', { ...selection, taskId, ansQueSN: 101, value: 7 }))
  assert.equal(f.writes[0].args[3], 'session-A')
})

test('a stopped automatic task cannot resume after a new manual task acquires the account', async (t) => {
  let slow
  const f = fixture(t, { stream: async function* () { await slow.promise; yield { type: 'text-delta', text: JSON.stringify(prediction) } },
    claim: async (_, count) => ({ ansQueSN: 100 + count, ansQueMarkState: 'A' }) })
  slow = f.gate()
  const a = await f.add('A'); await f.configure(a, 'vision-A')
  const automaticId = await f.start(a)
  await f.wait(a, (s) => s.autoMark?.current?.ansQueSN === 101)
  ok(await f.scoped(a, 'marking-auto-stop', { taskId: automaticId }))
  slow.resolve()
  await f.wait(a, (s) => !s.autoMark.inFlight)
  ok(await f.scoped(a, 'marking-cancel', { ...selection, taskId: automaticId, ansQueSN: 101 }))
  ok(await f.scoped(a, 'marking-get', selection))
  const manual = await f.state(a)
  assert.notEqual(manual.taskId, automaticId)
  assert.equal(manual.manualMark.ansQueSN, 102)
  rejected(await f.scoped(a, 'marking-auto-resume', { taskId: manual.taskId }))
  assert.equal(f.claims.length, 2)
  assert.equal(f.writes.length, 0)
  assert.equal((await f.state(a)).manualMark.ansQueSN, 102)
})

test('manual submission reusing an old answer ID does not increment the prior automatic task', async (t) => {
  const f = fixture(t, { claim: async (_, count) => count === 2 ? null : { ansQueSN: 101, ansQueMarkState: 'A' } })
  const a = await f.add('A'); await f.configure(a, 'vision-A')
  const oldTaskId = await f.start(a)
  const completed = await f.wait(a, (s) => s.autoMark?.status === 'completed')
  assert.equal(completed.autoMark.submitted, 1)
  ok(await f.scoped(a, 'marking-get', selection))
  const manualTaskId = (await f.state(a)).taskId
  assert.notEqual(manualTaskId, oldTaskId)
  ok(await f.scoped(a, 'marking-submit', { ...selection, taskId: manualTaskId, ansQueSN: 101, value: 6 }))
  const after = await f.state(a)
  assert.equal(after.manualMark, null)
  assert.equal(after.autoMark.submitted, 1)
  assert.equal(after.autoMark.current.score, completed.autoMark.current.score)
  assert.equal(after.autoMark.status, completed.autoMark.status)
  assert.equal(f.writes.length, 2)
})

test('accounts contract adds independent teacher clients without logging out the default account', async (t) => {
  const f = fixture(t)
  const a = await f.loginDefault('A'), b = await f.add('B')
  assert.notEqual(a, b)
  const list = await f.list()
  assert.equal(list.defaultAccountId, a)
  assert.equal(list.maxConcurrentModels, 2)
  for (const [id, username] of [[a, 'A'], [b, 'B']]) {
    const summary = list.accounts.find((x) => x.accountId === id)
    assert.ok(summary)
    for (const key of ['accountId', 'username', 'base', 'name', 'connected', 'isDefault', 'taskId', 'autoMark', 'manualPending', 'job']) assert.ok(Object.hasOwn(summary, key), `Missing summary field ${key}`)
    assert.equal(summary.username, username); assert.equal(summary.connected, true)
    assert.equal(summary.isDefault, id === a)
    assert.equal((await f.state(id)).username, username)
    assert.equal((await f.scoped(id, 'exams')).body[0].name, username + ' exam')
  }
  assert.notEqual(f.clients.get('A'), f.clients.get('B'))
  assert.equal(f.clients.get('A').cookieHeader(), 'offline-account=A')
  assert.equal(f.clients.get('B').cookieHeader(), 'offline-account=B')
  assert.deepEqual(f.logouts, [])
  assert.ok(!JSON.stringify(list).includes('OFFLINE_PASSWORD'))
})

test('normalized base and username reject duplicates, while another site remains independent', async (t) => {
  const f = fixture(t)
  const a = await f.add('teacher', { base: 'https://EXAM.invalid:443/AMEQP' })
  rejected(await f.call('accounts', { base: ' https://exam.invalid/AMEQP/ ', username: 'teacher', password: 'ignored' }))
  const b = await f.add('teacher', { base: 'https://second.invalid/AMEQP/' })
  assert.notEqual(a, b)
  assert.equal(f.logins.length, 2, 'Duplicate connection must be rejected before logging in')
  assert.deepEqual(f.logouts, [])
  assert.equal((await f.state(a)).connected, true)
})

test('a failed new login leaves existing accounts and their default mapping intact', async (t) => {
  const f = fixture(t, { login: async (name) => { if (name === 'bad') throw new Error('offline password rejected') } })
  const a = await f.loginDefault('A')
  rejected(await f.call('accounts', { username: 'bad', password: 'bad' }))
  assert.equal((await f.state(a)).connected, true)
  assert.equal((await f.state()).accountId, a)
  assert.deepEqual(f.logouts, [])
})

test('models, prompts and question types stay private to accounts including the same username at another site', async (t) => {
  const f = fixture(t)
  const a = await f.add('teacher'), b = await f.add('teacher', { base: 'https://other.invalid/AMEQP/' })
  await f.configure(a, 'vision-A'); await f.configure(b, 'vision-B')
  ok(await f.scoped(a, 'save-prompt', { prompt: 'ACCOUNT_A_PROMPT' }))
  ok(await f.scoped(b, 'save-prompt', { prompt: 'ACCOUNT_B_PROMPT' }))
  const lines = { ...rubric, question_type: 'line', grading_method: 'line_count', criteria: Array.from({ length: 8 }, (_, i) => ({ id: 'line-' + i, description: 'Line ' + i, max_score: 1 })) }
  ok(await f.scoped(b, 'save-config', { ...selection, config: lines }))
  const sa = await f.state(a), sb = await f.state(b)
  assert.equal(sa.model.model, 'vision-A'); assert.equal(sb.model.model, 'vision-B')
  assert.equal(sa.prompt, 'ACCOUNT_A_PROMPT'); assert.equal(sb.prompt, 'ACCOUNT_B_PROMPT')
  assert.equal(ok(await f.scoped(a, 'question-config', selection)).grading_method, 'rubric')
  assert.equal(ok(await f.scoped(b, 'question-config', selection)).grading_method, 'line_count')
})

test('different models run together and B submits while A remains slow, with session and claim ownership intact', async (t) => {
  let slow
  const f = fixture(t, { stream: async function* (request) {
    if (request.model === 'vision-A') await slow.promise
    yield { type: 'text-delta', text: JSON.stringify(prediction) }
  } })
  slow = f.gate()
  const a = await f.add('A'), b = await f.add('B')
  await f.configure(a, 'vision-A'); await f.configure(b, 'vision-B')
  await f.start(a); await f.start(b)
  await f.wait(b, (s) => s.autoMark?.status === 'completed', 'B completion while A is blocked')
  assert.equal(f.modelCalls.length, 2)
  assert.equal((await f.state(a)).autoMark.inFlight, true)
  assert.deepEqual(f.writes.map((w) => w.username), ['B'])
  slow.resolve()
  await f.wait(a, (s) => s.autoMark?.status === 'completed')
  assert.deepEqual(f.writes.map((w) => w.username), ['B', 'A'])
  for (const write of f.writes) {
    assert.deepEqual(write.args.slice(0, 4), [1, 2, 3, 'session-' + write.username])
    assert.equal(write.args[4].teaSN, write.username.charCodeAt(0))
    assert.equal(write.args[4].ansQueSN, 101)
    assert.equal(write.args[4].marQueMarkValue, 7)
    assert.equal(write.client, f.clients.get(write.username))
  }
})

test('pausing A retains its claim and blocks its submission while B continues; resume reuses A paper', async (t) => {
  let slow, first = true
  const f = fixture(t, { stream: async function* (request) {
    if (request.model === 'vision-A' && first) { first = false; yield { type: 'text-delta', text: '{' }; await slow.promise }
    yield { type: 'text-delta', text: JSON.stringify(prediction) }
  } })
  slow = f.gate()
  const a = await f.add('A'), b = await f.add('B')
  await f.configure(a, 'vision-A'); await f.configure(b, 'vision-B')
  const taskId = await f.start(a)
  await f.wait(a, (s) => s.autoMark?.stream?.text === '{')
  ok(await f.scoped(a, 'marking-auto-pause', { taskId }))
  await f.start(b)
  await f.wait(b, (s) => s.autoMark?.status === 'completed')
  assert.deepEqual(f.writes.map((w) => w.username), ['B'])
  slow.resolve()
  const paused = await f.wait(a, (s) => !s.autoMark.inFlight)
  assert.equal(paused.autoMark.status, 'paused'); assert.equal(paused.autoMark.current.ansQueSN, 101)
  assert.equal(f.counts.get('A'), 1); assert.equal(f.cancels.length, 0)
  ok(await f.scoped(a, 'marking-auto-resume', { taskId }))
  await f.wait(a, (s) => s.autoMark?.status === 'completed')
  assert.equal(f.writes.filter((w) => w.username === 'A').length, 1)
  assert.equal(f.counts.get('A'), 2, 'Only the post-submit exhaustion check may claim again')
})

test('uncertain A submission is never retried or cancelled and does not stop B', async (t) => {
  const f = fixture(t, { submit: async (username) => { if (username === 'A') throw new Error('offline response lost') } })
  const a = await f.add('A'), b = await f.add('B')
  await f.configure(a, 'vision-A'); await f.configure(b, 'vision-B')
  const taskId = await f.start(a); await f.start(b)
  await f.wait(a, (s) => s.autoMark?.submissionUncertain && !s.autoMark.inFlight)
  await f.wait(b, (s) => s.autoMark?.status === 'completed')
  rejected(await f.scoped(a, 'marking-auto-resume', { taskId }))
  rejected(await f.scoped(a, 'marking-submit', { ...selection, taskId, ansQueSN: 101, value: 7 }))
  rejected(await f.scoped(a, 'marking-cancel', { ...selection, taskId, ansQueSN: 101 }))
  for (let i = 0; i < 10; i++) await tick()
  assert.equal(f.writes.filter((w) => w.username === 'A').length, 1)
  assert.equal(f.writes.filter((w) => w.username === 'B').length, 1)
  assert.equal(f.counts.get('A'), 1); assert.equal(f.cancels.length, 0)
})

test('an active account rejects a second question without replacing its task or affecting another account', async (t) => {
  let slow
  const f = fixture(t, { stream: async function* () { await slow.promise; yield { type: 'text-delta', text: JSON.stringify(prediction) } } })
  slow = f.gate()
  const a = await f.add('A'), b = await f.add('B')
  await f.configure(a, 'vision-A'); await f.configure(b, 'vision-B')
  const taskId = await f.start(a)
  rejected(await f.scoped(a, 'marking-auto-start', { ...selection, question: 4 }))
  rejected(await f.scoped(a, 'marking-get', { ...selection, question: 4 }))
  assert.equal((await f.state(a)).taskId, taskId)
  assert.equal((await f.state(a)).autoMark.selection.question, 3)
  await f.start(b)
  slow.resolve()
  await f.wait(a, (s) => s.autoMark?.status === 'completed')
  await f.wait(b, (s) => s.autoMark?.status === 'completed')
})

test('scoped controls reject missing and stale task IDs; an old task cannot pause a new run', async (t) => {
  let slow, block = false
  const f = fixture(t, { stream: async function* () { if (block) await slow.promise; yield { type: 'text-delta', text: JSON.stringify(prediction) } },
    claim: async (_, count) => count === 2 || count === 4 ? null : { ansQueSN: 100 + count, ansQueMarkState: 'A' } })
  slow = f.gate()
  const a = await f.add('A'); await f.configure(a, 'vision-A')
  const oldId = await f.start(a)
  await f.wait(a, (s) => s.autoMark?.status === 'completed')
  block = true
  const newId = await f.start(a)
  assert.notEqual(newId, oldId)
  await f.wait(a, (s) => s.autoMark?.current?.ansQueSN === 103)
  for (const op of ['marking-auto-pause', 'marking-auto-stop', 'marking-auto-resume']) {
    rejected(await f.scoped(a, op))
    rejected(await f.scoped(a, op, { taskId: oldId }))
  }
  for (const op of ['marking-submit', 'marking-cancel']) {
    rejected(await f.scoped(a, op, { ...selection, ansQueSN: 103, value: 7 }))
    rejected(await f.scoped(a, op, { ...selection, taskId: oldId, ansQueSN: 103, value: 7 }))
  }
  assert.equal((await f.state(a)).taskId, newId)
  assert.equal((await f.state(a)).autoMark.status, 'running')
  ok(await f.scoped(a, 'marking-auto-pause', { taskId: newId }))
  slow.resolve()
  await f.wait(a, (s) => !s.autoMark.inFlight)
  assert.equal(f.writes.length, 1, 'The newer paused claim must not be submitted')
})

test('manual claims require their current task ID and cannot borrow another account with the same answer ID', async (t) => {
  const f = fixture(t)
  const a = await f.add('A'), b = await f.add('B')
  await f.configure(a, 'vision-A'); await f.configure(b, 'vision-B')
  ok(await f.scoped(a, 'marking-get', selection))
  ok(await f.scoped(b, 'marking-get', selection))
  const taskA = (await f.state(a)).taskId, taskB = (await f.state(b)).taskId
  assert.ok(taskA); assert.ok(taskB); assert.notEqual(taskA, taskB)
  assert.equal(ok(await f.scoped(a, 'marking-get', selection)).ansQueSN, 101)
  assert.equal((await f.state(a)).taskId, taskA)
  assert.equal(f.counts.get('A'), 1)
  for (const op of ['marking-submit', 'marking-cancel']) {
    rejected(await f.scoped(a, op, { ...selection, ansQueSN: 101, value: 7 }))
    rejected(await f.scoped(a, op, { ...selection, taskId: taskB, ansQueSN: 101, value: 7 }))
  }
  assert.equal(f.writes.length, 0); assert.equal(f.cancels.length, 0)
  ok(await f.scoped(a, 'marking-cancel', { ...selection, taskId: taskA, ansQueSN: 101 }))
  ok(await f.scoped(b, 'marking-submit', { ...selection, taskId: taskB, accountId: a, ansQueSN: 101, value: 7 }))
  assert.deepEqual(f.cancels.map((entry) => entry.username), ['A'])
  assert.deepEqual(f.writes.map((entry) => entry.username), ['B'])
  assert.equal(f.writes[0].args[3], 'session-B')
  assert.equal((await f.state(a)).manualMark, null)
  assert.equal((await f.state(b)).manualMark, null)
})

test('legacy endpoints always use the default account after reading and configuring another account', async (t) => {
  const f = fixture(t)
  const a = await f.loginDefault('A'), b = await f.add('B')
  await f.configure(a, 'vision-A'); await f.configure(b, 'vision-B')
  await f.state(b)
  ok(await f.scoped(b, 'save-prompt', { prompt: 'B_ONLY_PROMPT' }))
  assert.equal((await f.state()).accountId, a)
  assert.equal((await f.state()).model.model, 'vision-A')
  const started = ok(await f.call('marking-auto-start', selection))
  assert.equal(started.accountId, a)
  await f.wait(a, (s) => s.autoMark?.status === 'completed')
  assert.deepEqual(f.writes.map((w) => w.username), ['A'])
  assert.equal((await f.state(b)).autoMark, null)
  // Compatibility: legacy control does not require a taskId.
  ok(await f.call('marking-auto-pause'))
  assert.equal((await f.state()).accountId, a)
})

test('pause-all reaches every account, retains both claims and permits no later submission', async (t) => {
  let slow
  const f = fixture(t, { stream: async function* () { yield { type: 'text-delta', text: '{' }; await slow.promise; yield { type: 'text-delta', text: JSON.stringify(prediction) } } })
  slow = f.gate()
  const a = await f.add('A'), b = await f.add('B')
  await f.configure(a, 'vision-A'); await f.configure(b, 'vision-B')
  await f.start(a); await f.start(b)
  for (const id of [a, b]) await f.wait(id, (s) => s.autoMark?.stream?.text === '{')
  ok(await f.call('tasks/pause-all'))
  slow.resolve()
  for (const id of [a, b]) {
    const state = await f.wait(id, (s) => !s.autoMark.inFlight)
    assert.equal(state.autoMark.status, 'paused')
    assert.equal(state.autoMark.current.ansQueSN, 101)
  }
  assert.equal(f.writes.length, 0); assert.equal(f.cancels.length, 0)
  assert.equal(f.counts.get('A'), 1); assert.equal(f.counts.get('B'), 1)
})

for (const [name, config, providers, expected] of [
  ['default global and provider limit', {}, ['P', 'P', 'P'], 2],
  ['configured global limit', { maxConcurrentModels: 1 }, ['P', 'Q', 'R'], 1],
  ['default provider limit with a higher global limit', { maxConcurrentModels: 3 }, ['P', 'P', 'P'], 2],
  ['configured provider limit', { maxConcurrentModels: 3, providerConcurrency: { P: 1 } }, ['P', 'P', 'Q'], 2],
]) {
  test(`shared model queue obeys ${name} and releases queued accounts`, async (t) => {
    let slow, active = 0, maximum = 0
    const byProvider = new Map(), maximumByProvider = new Map()
    const f = fixture(t, { config, stream: async function* (request) {
      active++; maximum = Math.max(maximum, active)
      byProvider.set(request.provider, (byProvider.get(request.provider) || 0) + 1)
      maximumByProvider.set(request.provider, Math.max(maximumByProvider.get(request.provider) || 0, byProvider.get(request.provider)))
      try { await slow.promise; yield { type: 'text-delta', text: JSON.stringify(prediction) } }
      finally { active--; byProvider.set(request.provider, byProvider.get(request.provider) - 1) }
    } })
    slow = f.gate()
    const ids = []
    for (let i = 0; i < providers.length; i++) {
      const id = await f.add(String.fromCharCode(65 + i)); ids.push(id)
      await f.configure(id, 'vision-' + i, { provider: providers[i] })
      await f.start(id)
    }
    await f.wait(ids[0], () => f.modelCalls.length >= expected)
    for (let i = 0; i < 15; i++) await tick()
    assert.equal(f.modelCalls.length, expected)
    assert.equal(maximum, expected)
    if (name === 'configured provider limit') assert.equal(maximumByProvider.get('P'), 1)
    assert.equal(f.claims.length, 3, 'Queued tasks keep one claim each without prefetching')
    slow.resolve()
    for (const id of ids) await f.wait(id, (s) => s.autoMark?.status === 'completed')
    assert.equal(f.writes.length, 3)
    assert.ok(maximum <= (config.maxConcurrentModels || 2))
  })
}

test('pausing an account waiting in the shared queue preserves its claim without invoking its model', async (t) => {
  let slow
  const f = fixture(t, { config: { maxConcurrentModels: 1 }, stream: async function* () {
    await slow.promise; yield { type: 'text-delta', text: JSON.stringify(prediction) }
  } })
  slow = f.gate()
  const a = await f.add('A'), b = await f.add('B')
  await f.configure(a, 'blocker'); await f.configure(b, 'queued')
  await f.start(a)
  await f.wait(a, () => f.modelCalls.length === 1)
  const taskId = await f.start(b)
  await f.wait(b, (s) => s.autoMark?.current?.ansQueSN === 101)
  ok(await f.scoped(b, 'marking-auto-pause', { taskId }))
  slow.resolve()
  await f.wait(a, (s) => s.autoMark?.status === 'completed')
  const paused = await f.wait(b, (s) => !s.autoMark.inFlight)
  assert.equal(paused.autoMark.status, 'paused')
  assert.equal(paused.autoMark.current.ansQueSN, 101)
  assert.deepEqual(f.modelCalls.map((request) => request.model), ['blocker'])
  assert.deepEqual(f.writes.map((entry) => entry.username), ['A'])
  assert.equal(f.counts.get('B'), 1)
})

test('a queued task keeps its start-time provider, model, prompt and rubric snapshot', async (t) => {
  let slow
  const f = fixture(t, { config: { maxConcurrentModels: 1 }, stream: async function* (request) {
    if (request.model === 'blocker') await slow.promise
    yield { type: 'text-delta', text: JSON.stringify(prediction) }
  } })
  slow = f.gate()
  const a = await f.add('A'), b = await f.add('B')
  await f.configure(a, 'blocker'); await f.configure(b, 'frozen-model', { provider: 'frozen-provider' })
  ok(await f.scoped(b, 'save-prompt', { prompt: 'FROZEN_TASK_PROMPT' }))
  await f.start(a); await f.start(b)
  await f.wait(b, (s) => s.autoMark?.current?.ansQueSN === 101)
  // Implementations may reject edits while busy, or accept next-run settings.
  // Either policy must leave the queued run's complete snapshot unchanged.
  for (const [op, body] of [
    ['model', { mode: 'harness', provider: 'changed-provider', model: 'changed-model' }],
    ['save-prompt', { prompt: 'CHANGED_PROMPT' }],
    ['save-config', { ...selection, config: { ...rubric, question_prompt: 'CHANGED_RULE' } }],
  ]) {
    const reply = await f.scoped(b, op, body)
    assert.ok(reply.code === 200 || (reply.code >= 400 && reply.code !== 404))
  }
  slow.resolve()
  await f.wait(b, (s) => s.autoMark?.status === 'completed')
  const request = f.modelCalls.find((r) => r.model === 'frozen-model')
  assert.ok(request)
  assert.equal(request.provider, 'frozen-provider')
  assert.match(JSON.stringify(request), /FROZEN_TASK_PROMPT/)
  assert.match(JSON.stringify(request), /OFFLINE_RULE/)
  assert.ok(!JSON.stringify(request).includes('CHANGED_'))
})

test('default DSH model selection resolves at task start before a queued task can observe later changes', async (t) => {
  let slow
  const f = fixture(t, { config: { maxConcurrentModels: 1 }, stream: async function* (request) {
    if (request.model === 'blocker') await slow.promise
    yield { type: 'text-delta', text: JSON.stringify(prediction) }
  } })
  slow = f.gate()
  const a = await f.add('A'), b = await f.add('B')
  await f.configure(a, 'blocker'); await f.configure(b, '', { provider: '' })
  await f.start(a)
  await f.wait(a, () => f.modelCalls.length === 1)
  await f.start(b)
  f.services.agentDefaultModel.currentSelection = () => ({ provider: 'later-provider', model: 'later-model' })
  slow.resolve()
  await f.wait(b, (s) => s.autoMark?.status === 'completed')
  const request = f.modelCalls.find((r) => r.model !== 'blocker')
  assert.equal(request.provider, 'offline-provider')
  assert.equal(request.model, 'default-vision')
})

test('invalid scoring output pauses only the originating account and preserves its unsubmitted claim', async (t) => {
  const f = fixture(t, { stream: async function* (request) {
    yield { type: 'text-delta', text: request.model === 'bad-model' ? '{"criteria":[{"id":"sketch","score":"4"},{"id":"dimensions","score":3}]}' : JSON.stringify(prediction) }
  } })
  const a = await f.add('A'), b = await f.add('B')
  await f.configure(a, 'bad-model'); await f.configure(b, 'vision-B')
  await f.start(a); await f.start(b)
  const paused = await f.wait(a, (s) => s.autoMark?.status === 'paused' && !s.autoMark.inFlight)
  await f.wait(b, (s) => s.autoMark?.status === 'completed')
  assert.equal(paused.autoMark.current.ansQueSN, 101)
  assert.match(paused.autoMark.phase, /非法分项分数/)
  assert.deepEqual(f.writes.map((entry) => entry.username), ['B'])
  assert.equal(f.counts.get('A'), 1)
  assert.equal(f.cancels.length, 0)
})

test('session heartbeats use each owning client and stop work once its claim is resolved or Host is disposed', async (t) => {
  const timers = []
  t.mock.method(globalThis, 'setInterval', (callback, delay) => {
    const timer = { callback, delay, cleared: false, unref() {} }; timers.push(timer); return timer
  })
  t.mock.method(globalThis, 'clearInterval', (timer) => { if (timer) timer.cleared = true })
  const f = fixture(t)
  const a = await f.add('A'), b = await f.add('B')
  await f.configure(a, 'vision-A'); await f.configure(b, 'vision-B')
  assert.equal(timers.length, 0, 'An idle connection must not start session traffic')
  ok(await f.scoped(a, 'marking-get', selection))
  ok(await f.scoped(b, 'marking-get', selection))
  assert.equal(timers.length, 2)
  assert.ok(timers.every((timer) => timer.delay === 20_000), 'Timeout=30 sends the heartbeat ten seconds before expiry')
  for (const timer of timers) await timer.callback()
  assert.deepEqual(f.heartbeats.map((entry) => entry.username), ['A', 'B'])
  for (const entry of f.heartbeats) {
    assert.deepEqual(entry.args, [1, 2, 3, 'session-' + entry.username])
    assert.equal(entry.client, f.clients.get(entry.username))
  }
  ok(await f.scoped(a, 'marking-cancel', { ...selection, taskId: (await f.state(a)).taskId, ansQueSN: 101 }))
  for (const timer of timers) if (!timer.cleared) await timer.callback()
  assert.deepEqual(f.heartbeats.map((entry) => entry.username), ['A', 'B', 'B'])
  ok(await f.scoped(b, 'marking-submit', { ...selection, taskId: (await f.state(b)).taskId, ansQueSN: 101, value: 7 }))
  for (const timer of timers) if (!timer.cleared) await timer.callback()
  assert.equal(f.heartbeats.length, 3)
  f.dispose()
  assert.ok(timers.every((timer) => timer.cleared))
})

test('restart preserves offline default and nondefault account identities for explicit reconnection', async (t) => {
  const f = fixture(t)
  const a = await f.add('A', { name: 'Default teacher', base: 'https://EXAM.invalid:443/AMEQP' })
  const b = await f.add('B', { name: 'Second teacher', base: 'https://second.invalid/OtherSite/' })
  const identities = await Promise.all([a, b].map(async (id) => {
    const state = await f.state(id)
    return { accountId: id, username: state.username, base: state.base, name: state.name }
  }))
  const before = [f.logins.length, f.logouts.length, f.claims.length, f.writes.length, f.cancels.length]
  f.dispose()
  const restarted = f.createHost()
  for (const expected of identities) {
    const state = await restarted.state(expected.accountId)
    assert.equal(state.connected, false)
    for (const key of ['accountId', 'username', 'base', 'name']) assert.equal(state[key], expected[key], `Lost ${key} for ${expected.accountId}`)
    const listed = (await restarted.list()).accounts.find((entry) => entry.accountId === expected.accountId)
    for (const key of ['username', 'base', 'name']) assert.equal(listed[key], state[key])
  }
  assert.equal((await restarted.state()).username, 'A')
  assert.deepEqual([f.logins.length, f.logouts.length, f.claims.length, f.writes.length, f.cancels.length], before)
  // The manager must use the persisted identity when reconnect only supplies a password.
  const connected = ok(await restarted.scoped(b, 'login', { password: 'OFFLINE_RECONNECT_PASSWORD', name: 'Second teacher' }))
  assert.equal(connected.connected, true)
  assert.equal(connected.username, 'B')
  assert.equal(connected.base, 'https://second.invalid/OtherSite/')
  assert.equal(f.logins.at(-1).username, 'B')
  assert.equal(f.logins.at(-1).base, 'https://second.invalid/OtherSite/')
})

test('legacy rubric inheritance stays within the normalized original site and private cross-site rules survive restart', async (t) => {
  const f = fixture(t)
  const a = await f.add('teacher')
  await f.configure(a, 'vision-A')
  const other = await f.add('teacher', { base: 'https://other.invalid/AMEQP/' })
  const sameSite = await f.add('same-site-teacher', { base: 'https://EXAM.invalid:443/AMEQP' })
  const inherited = ok(await f.scoped(sameSite, 'question-config', selection))
  assert.equal(inherited.question_prompt, rubric.question_prompt)
  assert.deepEqual(inherited.criteria, rubric.criteria)
  const empty = ok(await f.scoped(other, 'question-config', selection))
  assert.equal(empty.question_prompt, '')
  assert.equal(empty.max_score, null)
  assert.ok(!JSON.stringify(empty).includes('OFFLINE_RULE'))
  const privateRubric = { ...rubric, question_prompt: 'OTHER_SITE_PRIVATE_RULE', question: 'Other-site private question' }
  ok(await f.scoped(other, 'save-config', { ...selection, config: privateRubric }))
  assert.equal(ok(await f.scoped(a, 'question-config', selection)).question_prompt, rubric.question_prompt)
  const restarted = f.createHost()
  assert.equal(ok(await restarted.scoped(other, 'question-config', selection)).question_prompt, 'OTHER_SITE_PRIVATE_RULE')
  assert.equal(ok(await restarted.scoped(a, 'question-config', selection)).question_prompt, rubric.question_prompt)
  const anotherSite = ok(await restarted.call('accounts', { base: 'https://third.invalid/AMEQP/', username: 'teacher', password: 'offline' })).accountId
  assert.equal(ok(await restarted.scoped(anotherSite, 'question-config', selection)).question_prompt, '')
})

test('restart exposes pending recovery without logging in, claiming, submitting or cancelling', async (t) => {
  const f = fixture(t, { submit: async () => { throw new Error('offline acknowledgement lost') } })
  const a = await f.add('A'); await f.configure(a, 'vision-A')
  await f.start(a)
  await f.wait(a, (s) => s.autoMark?.submissionUncertain && !s.autoMark.inFlight)
  const before = [f.logins.length, f.claims.length, f.writes.length, f.cancels.length, f.logouts.length]
  const restarted = f.createHost()
  const list = await restarted.list()
  const recovered = list.accounts.find((account) => account.accountId === a)
  assert.ok(recovered, 'Persisted pending account must remain visible after restart')
  assert.equal(recovered.connected, false)
  assert.ok(recovered.manualPending || recovered.autoMark || recovered.recovery, 'Pending claim/recovery must remain visible')
  const state = await restarted.state(a)
  assert.equal(state.connected, false)
  assert.ok(state.autoMark?.submissionUncertain || state.recovery || state.manualPending)
  for (let i = 0; i < 15; i++) await tick()
  assert.deepEqual([f.logins.length, f.claims.length, f.writes.length, f.cancels.length, f.logouts.length], before)
})
