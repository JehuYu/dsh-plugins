import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { apply, inject } from '../grading-host.js'
import { ReadonlyClient } from '../ameqp.js'
import { QUESTION_META, DEFAULT_CRITERIA, DEFAULT_METHOD } from '../seeds.js'
import { resolveMaxScore, gradingInput, scoringSystem, gradingControls, collectLlmText, validateCriteria,
  rubricWarnings, generationRequest, validateGenerated } from '../grading-policy.js'

const config = {
  question: '画草图并说明、标注尺寸，选择题不计分', question_prompt: '只评指定草图小题', grading_method: 'rubric', max_score: 8,
  criteria: [{ id: 'sketch', description: '草图表达，满分4分', max_score: 4 }, { id: 'dimensions', description: '尺寸标注，满分4分', max_score: 4 }],
}

test('zero online totals fall back to saved total or valid criteria, never undefined or invented 1', () => {
  assert.equal(resolveMaxScore({ online: 0, saved: 8 }), 8)
  assert.equal(resolveMaxScore({ online: 0, criteria: config.criteria }), 8)
  assert.equal(resolveMaxScore({ online: 10, saved: 8 }), 10)
  assert.equal(resolveMaxScore({ online: 0 }), null)
  assert.equal(resolveMaxScore({ criteria: [{ max_score: NaN }] }), null)
})

test('grading request excludes private metadata and image payloads', () => {
  const input = gradingInput({ ...config, stem_image: 'data:SECRET', ansStuSN: 123, reference_score: 7 })
  assert.equal(input.question, config.question)
  assert.equal(input.ansStuSN, undefined)
  assert.equal(input.reference_score, undefined)
  assert.equal(input.stem_image, undefined)
})

test('bundled prompt sends only the applicable scoring method without stripping custom prompts', () => {
  const prompt = '# AI 阅卷总提示词 v4（合成测试）\n同一缺陷不重复扣分。\n- rubric：按配置分项评分\n- line_count：按配置计线\n- holistic_band：按配置整体分档'
  const system = scoringSystem(prompt, config)
  assert.match(system, /- rubric：/)
  assert.ok(!system.includes('- line_count：'))
  assert.ok(!system.includes('- holistic_band：'))
  assert.match(system, /不重复扣分/)
  assert.match(system, /字段名必须保留英文原名/)
  assert.ok(system.includes(JSON.stringify(config.criteria.map((c) => c.id))))
  assert.match(scoringSystem('自定义提示词\n- line_count：保留', config), /- line_count：保留/)
})

test('low is requested only when exact model supports it; default opt-out works', async () => {
  let queries = 0
  const llm = { resolveModelInfo: async (provider, model) => {
    queries++
    assert.equal(provider, 'test'); assert.equal(model, 'vision')
    return { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }
  } }
  assert.deepEqual(await gradingControls(llm, { provider: 'test', model: 'vision' }), { reasoningEffort: 'low' })
  assert.deepEqual(await gradingControls(llm, { grading_effort: 'default' }), {})
  assert.equal(queries, 1)
  assert.deepEqual(await gradingControls({ resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'high' }] } }) }, {}), {})
  assert.deepEqual(await gradingControls({}, {}), {})
})

test('stream collector does not double JSON and supports complete-only blocks', async () => {
  async function* stream() {
    yield { type: 'text-delta', index: 0, text: '{"a":' }
    yield { type: 'text-delta', index: 0, text: '1}' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"a":1}' } }
    yield { type: 'block-end', index: 1, block: { type: 'text', text: '\n' } }
  }
  assert.equal(await collectLlmText(stream()), '{"a":1}\n')
  async function* errorStream() { yield { type: 'finish', reason: { kind: 'error', failure: { message: 'broken' } } } }
  await assert.rejects(collectLlmText(errorStream()), /broken/)
})

test('rubric validation rejects missing total, duplicate IDs, negative values and wrong methods', () => {
  assert.throws(() => validateCriteria(config.criteria, undefined), /满分/)
  assert.throws(() => validateCriteria([{ ...config.criteria[0], max_score: -1 }], 8), /正数/)
  assert.throws(() => validateCriteria([config.criteria[0], config.criteria[0]], 8), /重复/)
  assert.throws(() => validateCriteria(config.criteria, 7), /之和/)
  assert.throws(() => validateCriteria(config.criteria, 8, 'line_count'), /每项满分须为1/)
  assert.throws(() => validateCriteria(config.criteria, 8, 'holistic_band'), /整体/)
  assert.deepEqual(validateCriteria(config.criteria, 8), config.criteria)
})

test('known full-mark contradiction is surfaced', () => {
  assert.match(rubricWarnings([{ id: 'design', max_score: 2, description: '三项均体现得1.5分，缺一项酌情扣分' }])[0], /1.5.*2/)
  assert.deepEqual(rubricWarnings([{ id: 'design', max_score: 2, description: '三项均体现得2分，缺一项酌情扣分' }]), [])
})

test('optimization preserves IDs, order and weights even if changed weights still sum correctly', () => {
  const options = { mode: 'optimize', existing: config, maxScore: 8, method: 'rubric' }
  assert.equal(validateGenerated(config, options).criteria.length, 2)
  const changed = { ...config, criteria: config.criteria.map((c, i) => ({ ...c, max_score: i ? 5 : 3 })) }
  assert.throws(() => validateGenerated(changed, options), /优化不得/)
  assert.throws(() => validateGenerated({ ...config, criteria: [...config.criteria].reverse() }, options), /优化不得/)
  assert.ok(validateGenerated(config, { ...options, mode: 'generate' }).warnings.some((w) => w.includes('未提供教师')))
})

test('generation receives existing edits and teacher standard', () => {
  const request = generationRequest({ mode: 'optimize', typeLabel: '设计', method: 'rubric', maxScore: 8, existing: config, teacherStandard: '不得更改教师给分点' })
  assert.equal(JSON.parse(request.text).existing.question_prompt, config.question_prompt)
  assert.match(request.text, /不得更改教师给分点/)
  assert.match(request.system, /不调整分值/)
  assert.match(request.system, /按0.25分间隔细化完成度/)
  assert.match(request.system, /不放宽标准、不默认取高分/)
  assert.match(request.system, /不逐项取整/)
})

function fixture(t, generated = config, savedConfigs = null, fixtureOptions = {}) {
  // All model calls are stubbed and all official requests are forbidden.
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('External request forbidden in offline tests') })
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ameqp-test-'))
  let runtime
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  if (savedConfigs) {
    fs.mkdirSync(path.join(root, 'ameqp-grading'), { recursive: true })
    fs.writeFileSync(path.join(root, 'ameqp-grading', 'question-configs.json'), JSON.stringify(savedConfigs))
  }
  t.after(() => {
    runtime?.dispose()
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(root).startsWith('ameqp-test-'))
    fs.rmSync(root, { recursive: true, force: true })
  })
  let handler
  const calls = []
  const llm = { resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }), stream: async function* (options) {
    calls.push(options)
    if (fixtureOptions.stream) yield* fixtureOptions.stream(options)
    else {
      const text = JSON.stringify(generated)
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    }
  } }
  const services = { llm, attachments: { saveImage: async () => ({ id: 'mock' }) }, ...fixtureOptions.services }
  runtime = apply({ get: (name) => services[name],
    inject: (_, callback) => callback({ effect: (fn) => fn(), webServer: { register: (route) => { handler = route.handler; return () => {} } } }),
  }, fixtureOptions.runtimeConfig || {})
  async function call(route, body = {}, method = 'POST') {
    const req = new PassThrough(); req.method = method; req.url = '/ameqp-grading/api/' + route
    let text
    const res = { statusCode: 200, setHeader() {}, end: (value) => { text = value } }
    const pending = handler(req, res)
    req.end(JSON.stringify(body))
    await pending
    return Buffer.isBuffer(text) ? { code: res.statusCode, bytes: text } : { code: res.statusCode, body: JSON.parse(text) }
  }
  return { root, calls, call, llm, services }
}

test('generation endpoint keeps manual input, returns a draft, uses normal reasoning', async (t) => {
  const f = fixture(t)
  assert.equal((await f.call('model', { mode: 'harness', provider: 'test', model: 'vision', grading_effort: 'low' })).code, 200)
  const reply = await f.call('config-generate', { exam: 1, subject: 2, question: 3, max_score: 8, question_type: 'design', mode: 'optimize', existing: config, teacher_standard: '教师原标准' })
  assert.equal(reply.code, 200)
  assert.equal(reply.body.max_score, 8)
  assert.equal(f.calls[0].reasoningEffort, undefined)
  assert.match(f.calls[0].messages[0].content[0].text, /教师原标准/)
  assert.ok(!fs.existsSync(path.join(f.root, 'ameqp-grading', 'question-configs.json')))
})

test('save persists total and teacher rules, rejects contradictions and missing totals', async (t) => {
  const f = fixture(t)
  const selection = { exam: 1, subject: 2, question: 3 }
  assert.equal((await f.call('save-config', { ...selection, config: { ...config, teacher_standard: '教师标准' } })).code, 200)
  const saved = JSON.parse(fs.readFileSync(path.join(f.root, 'ameqp-grading', 'question-configs.json'), 'utf8'))['1:2:3']
  assert.equal(saved.max_score, 8); assert.equal(saved.teacher_standard, '教师标准')
  const bad = structuredClone(config); bad.criteria[0].description = '全部达成得3分'
  assert.match((await f.call('save-config', { ...selection, config: bad })).body.error, /不一致/)
  assert.equal((await f.call('save-config', { ...selection, config: { ...config, max_score: undefined } })).body.max_score, 8)
  assert.equal((await f.call('save-config', { ...selection, question: 4, config: { ...config, max_score: undefined } })).code, 500)
})

test('generation rejects model reweighting without saving any configuration', async (t) => {
  const bad = structuredClone(config); bad.criteria[0].max_score = 3; bad.criteria[1].max_score = 5
  const f = fixture(t, bad)
  await f.call('model', { mode: 'harness', provider: 'test', model: 'vision' })
  const reply = await f.call('config-generate', { exam: 1, subject: 2, question: 3, max_score: 8, question_type: 'design', mode: 'optimize', existing: config })
  assert.match(reply.body.error, /优化不得/)
  assert.ok(!fs.existsSync(path.join(f.root, 'ameqp-grading', 'question-configs.json')))
})

test('isolated paper pipeline sends low, scores once, and never calls official write operations', async (t) => {
  const prediction = { criteria: [{ id: 'sketch', score: 4, image_evidence: '草图完整' }, { id: 'dimensions', score: 2.5, image_evidence: '尺寸部分缺失' }] }
  const f = fixture(t, prediction)
  t.mock.method(ReadonlyClient.prototype, 'login', async () => {})
  t.mock.method(ReadonlyClient.prototype, 'listExams', async () => [])
  t.mock.method(ReadonlyClient.prototype, 'getSessionId', async () => ({ SessionId: 'offline' }))
  t.mock.method(ReadonlyClient.prototype, 'listStudents', async () => [{ ansStuSN: 123 }])
  t.mock.method(ReadonlyClient.prototype, 'studentMeta', async () => ({ stuSN: 456, stuName: 'PRIVATE_STUDENT' }))
  t.mock.method(ReadonlyClient.prototype, 'questionCropImages', async () => [{ bytes: Buffer.from('mock-image'), mediaType: 'image/png' }])
  for (const method of ['getQuestion', 'submitScore', 'cancelQuestion']) {
    t.mock.method(ReadonlyClient.prototype, method, async () => { assert.fail('Official marking writes forbidden') })
  }
  await f.call('login', { username: 'offline' })
  await f.call('model', { mode: 'harness', provider: 'test', model: 'vision' })
  await f.call('save-config', { exam: 1, subject: 2, question: 3, config })
  const start = await f.call('start', { exam: 1, subject: 2, question: 3, limit: 1 })
  assert.equal(start.code, 200)
  let state
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setImmediate(resolve))
    state = (await f.call('state', {}, 'GET')).body
    if (state.job.status !== 'running') break
  }
  assert.equal(state.job.status, 'completed')
  assert.equal(state.job.scored, 1)
  assert.equal(state.job.results[0].score, 7)
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].reasoningEffort, 'low')
  assert.match(f.calls[0].system, /总提示词 v4/)
  assert.ok(!JSON.stringify(f.calls[0]).includes('PRIVATE_STUDENT'))
  assert.equal(typeof state.job.results[0].timings.modelMs, 'number')
})

test('legacy missing total survives zero metadata; unknown question returns explicit null', async (t) => {
  const legacy = { ...config }; delete legacy.max_score
  const f = fixture(t, config, { '1:2:3': legacy })
  assert.equal((await f.call('question-config', { exam: 1, subject: 2, question: 3 })).body.max_score, 8)
  const unknown = (await f.call('question-config', { exam: 1, subject: 2, question: 4 })).body
  assert.equal(unknown.max_score, null)
})

test('relogin creates a new marking metadata session and keeps saved total when metadata reports zero', async (t) => {
  const f = fixture(t, config, { '1:2:3': config })
  let sessions = 0
  t.mock.method(ReadonlyClient.prototype, 'login', async () => {})
  t.mock.method(ReadonlyClient.prototype, 'logout', async () => {})
  t.mock.method(ReadonlyClient.prototype, 'listExams', async () => [])
  t.mock.method(ReadonlyClient.prototype, 'listSubjects', async () => [{ id: 2 }])
  t.mock.method(ReadonlyClient.prototype, 'getSessionId', async () => ({ SessionId: 'session-' + ++sessions }))
  t.mock.method(ReadonlyClient.prototype, 'defQuestions', async () => [{ id: 3, name: '草图' }])
  t.mock.method(ReadonlyClient.prototype, 'defQuestionInfo', async () => ({ queScore: 0 }))
  for (const username of ['first', 'second']) {
    await f.call('login', { username })
    await f.call('subjects', { exam: 1 })
    assert.equal((await f.call('questions', { exam: 1, subject: 2 })).body[0].max_score, 8)
    await f.call('disconnect')
  }
  assert.equal(sessions, 2)
})

const prediction = { criteria: [{ id: 'sketch', score: 4, image_evidence: '草图完整' }, { id: 'dimensions', score: 3, image_evidence: '尺寸部分缺失' }] }
const selection = { exam: 1, subject: 2, question: 3 }
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
async function waitState(f, predicate) {
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setImmediate(resolve))
    const state = (await f.call('state', {}, 'GET')).body
    if (predicate(state)) return state
  }
  assert.fail('Mock pipeline did not reach expected state')
}
async function markingFixture(t, options = {}) {
  const f = fixture(t, options.prediction || prediction, { '1:2:3': config }, { runtimeConfig: { productionMarking: true, ...options.runtimeConfig }, stream: options.stream, services: options.services })
  const writes = [], claims = [], cancels = []
  t.mock.method(ReadonlyClient.prototype, 'login', async () => {})
  t.mock.method(ReadonlyClient.prototype, 'logout', async () => {})
  t.mock.method(ReadonlyClient.prototype, 'listExams', async () => [])
  t.mock.method(ReadonlyClient.prototype, 'getSessionId', async () => ({ SessionId: 'mock-session', teaSN: 9 }))
  t.mock.method(ReadonlyClient.prototype, 'getQuestion', async (...args) => {
    claims.push(args)
    if (options.claim) return options.claim(claims.length)
    return claims.length === 1 ? { ansQueSN: 101, ansStuSN: 202, ansQueMarkState: 'A', AnsImagePageRec: [] } : null
  })
  t.mock.method(ReadonlyClient.prototype, 'claimCropImages', async () => [{ bytes: Buffer.from('mock-image'), mediaType: 'image/png' }])
  t.mock.method(ReadonlyClient.prototype, 'submitScore', async (...args) => { writes.push(args); if (options.submit) return options.submit(...args); return {} })
  t.mock.method(ReadonlyClient.prototype, 'cancelQuestion', async (...args) => { cancels.push(args); if (options.cancel) return options.cancel(...args); return {} })
  await f.call('login', { username: 'offline' })
  await f.call('model', { mode: 'harness', provider: 'test', model: 'vision' })
  return { ...f, writes, claims, cancels }
}

test('live text arrives before completion; pause blocks overlap and resume scores the same claimed paper', async (t) => {
  const gate = deferred(); t.after(() => gate.resolve())
  let streams = 0
  const f = await markingFixture(t, { stream: async function* () {
    streams++
    if (streams === 1) { yield { type: 'text-delta', text: '{"criteria":[' }; await gate.promise }
    yield { type: 'text-delta', text: JSON.stringify(prediction) }
  } })
  await f.call('marking-auto-start', selection)
  const live = await waitState(f, (s) => s.autoMark.stream.text.length > 0)
  assert.equal(live.autoMark.stream.text, '{"criteria":[')
  assert.equal(live.autoMark.current.score, undefined)
  await f.call('marking-auto-pause')
  assert.equal((await f.call('marking-auto-resume')).code, 500)
  assert.equal((await f.call('disconnect')).code, 500)
  assert.equal((await f.call('marking-cancel', { ...selection, ansQueSN: 101 })).code, 500)
  assert.equal(f.writes.length, 0)
  gate.resolve()
  const paused = await waitState(f, (s) => !s.autoMark.inFlight)
  assert.equal(paused.autoMark.status, 'paused')
  assert.equal(paused.autoMark.stream.status, 'cancelled')
  assert.equal(paused.autoMark.stream.text, '{"criteria":[')
  assert.equal(f.claims.length, 1)
  assert.equal((await f.call('marking-auto-resume')).code, 200)
  const done = await waitState(f, (s) => s.autoMark.status === 'completed')
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0][4].ansQueSN, 101)
  assert.equal(f.claims.length, 2) // second call only checks for exhaustion after submission
  assert.equal(done.autoMark.stream.text, JSON.stringify(prediction))
  assert.equal(done.autoMark.stream.status, 'completed')
})

test('stop during claim waits for response, retains paper identity, and prevents a fresh start until cancellation', async (t) => {
  const gate = deferred(); t.after(() => gate.resolve())
  const f = await markingFixture(t, { claim: async () => { await gate.promise; return { ansQueSN: 101, ansQueMarkState: 'A' } } })
  await f.call('marking-auto-start', selection)
  const stopping = await f.call('marking-auto-stop')
  assert.equal(stopping.body.autoMark.status, 'stopping')
  assert.equal((await f.call('disconnect')).code, 500)
  gate.resolve()
  const stopped = await waitState(f, (s) => !s.autoMark.inFlight)
  assert.equal(stopped.autoMark.status, 'stopped')
  assert.equal(stopped.autoMark.current.ansQueSN, 101)
  assert.equal(f.calls.length, 0)
  assert.equal((await f.call('marking-auto-start', selection)).code, 500)
  assert.equal((await f.call('marking-cancel', { ...selection, ansQueSN: 101 })).code, 200)
  assert.equal((await f.call('state', {}, 'GET')).body.autoMark.current, null)
  assert.equal(f.cancels.length, 1)
})

test('claim failures pause with original error instead of reporting no papers', async (t) => {
  const f = await markingFixture(t, { claim: async () => { throw new Error('阅卷会话失效') } })
  await f.call('marking-auto-start', selection)
  const state = await waitState(f, (s) => !s.autoMark.inFlight)
  assert.equal(state.autoMark.status, 'paused')
  assert.match(state.autoMark.phase, /阅卷会话失效/)
  assert.equal(f.writes.length, 0)
})

test('uncertain submission cannot be retried, resumed or cancelled automatically', async (t) => {
  const f = await markingFixture(t, { submit: async () => { throw new Error('response lost') } })
  await f.call('marking-auto-start', selection)
  const state = await waitState(f, (s) => !s.autoMark.inFlight)
  assert.equal(state.autoMark.submissionUncertain, true)
  assert.equal((await f.call('marking-auto-resume')).code, 500)
  assert.equal((await f.call('marking-submit', { ...selection, ansQueSN: 101, value: 7 })).code, 500)
  assert.equal((await f.call('marking-cancel', { ...selection, ansQueSN: 101 })).code, 500)
  assert.equal(f.writes.length, 1)
})

test('invalid numeric model values preserve live output and never reach submission', async (t) => {
  const bad = structuredClone(prediction); bad.criteria[0].score = ''
  const f = await markingFixture(t, { prediction: bad })
  await f.call('marking-auto-start', selection)
  const state = await waitState(f, (s) => !s.autoMark.inFlight)
  assert.match(state.autoMark.phase, /非法分项分数/)
  assert.equal(state.autoMark.stream.status, 'error')
  assert.equal(state.autoMark.stream.text, JSON.stringify(bad))
  assert.equal(f.writes.length, 0)
})

test('manual claim exposes only the real secret number for visual verification', async (t) => {
  const f = await markingFixture(t, { claim: async () => ({ ansQueSN: 101, ansStuSN: 202, ansQueMarkState: 'A', stuInfo: { stuSecNo: '00123456', stuName: 'PRIVATE_NAME', stuNo: 'PRIVATE_NO' } }) })
  const claim = (await f.call('marking-get', selection)).body
  assert.equal(claim.stuSecNo, '00123456')
  assert.equal(claim.ansQueSN, 101)
  assert.equal(claim.stuInfo, undefined)
  assert.equal(claim.stuName, undefined)
  assert.equal(claim.stuNo, undefined)
  assert.equal(f.writes.length, 0)
})

test('automatic claim preserves the real secret number through scoring and submission', async (t) => {
  const f = await markingFixture(t, { claim: async (n) => n === 1 ? { ansQueSN: 101, ansStuSN: 202, ansQueMarkState: 'A', stuInfo: { stuSecNo: '00123456' } } : null })
  await f.call('marking-auto-start', selection)
  const state = await waitState(f, (s) => s.autoMark?.status === 'completed')
  assert.equal(state.autoMark.current.stuSecNo, '00123456')
  assert.equal(f.writes.length, 1)
})

test('manual claim returns the same paper until resolved; scores above saved maximum are rejected', async (t) => {
  const f = await markingFixture(t)
  const first = await f.call('marking-get', selection)
  assert.equal(first.body.ansQueSN, 101)
  assert.equal((await f.call('marking-get', selection)).body.ansQueSN, 101)
  assert.equal(f.claims.length, 1)
  assert.equal((await f.call('marking-auto-start', selection)).code, 500)
  assert.equal((await f.call('marking-submit', { ...selection, ansQueSN: 101, value: 9 })).code, 500)
  assert.equal((await f.call('marking-submit', { ...selection, ansQueSN: 102, value: 7 })).code, 500)
  assert.equal((await f.call('marking-submit', { ...selection, ansQueSN: 101, value: 7 })).code, 200)
  assert.equal(f.writes.length, 1)
  assert.equal((await f.call('state', {}, 'GET')).body.manualMark, null)
})

test('failed cancellation is not shown as success by the AMEQP client', async (t) => {
  const client = new ReadonlyClient(); client.productionMarking = true
  t.mock.method(client, 'ansOp', async () => ({ State: 'ERR', Msg: '不能取消' }))
  await assert.rejects(client.cancelQuestion(1, 2, 3, 'mock', 101, 'A', false, 'A'), /不能取消/)
})

test('API mode requests SSE and projects partial output before parsing the score', async (t) => {
  const f = await markingFixture(t)
  await f.call('model', { mode: 'api', base_url: 'https://models.invalid/v1', model: 'vision' })
  const gate = deferred(); t.after(() => gate.resolve())
  const raw = JSON.stringify(prediction), prefix = raw.slice(0, 40)
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://models.invalid/v1/chat/completions')
    assert.equal(JSON.parse(init.body).stream, true)
    assert.ok(init.signal instanceof AbortSignal)
    const encoder = new TextEncoder()
    const event = (text) => encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n')
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(event(prefix))
      gate.promise.then(() => { controller.enqueue(event(raw.slice(40))); controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close() })
    } }), { headers: { 'content-type': 'text/event-stream' } })
  })
  await f.call('marking-auto-start', selection)
  const live = await waitState(f, (s) => s.autoMark.stream.text === prefix)
  assert.equal(live.autoMark.current.score, undefined)
  assert.equal(f.writes.length, 0)
  gate.resolve()
  const done = await waitState(f, (s) => s.autoMark.status === 'completed')
  assert.equal(done.autoMark.stream.text, raw)
  assert.equal(f.writes[0][4].marQueMarkValue, 7)
})

test('editing a paused rubric invalidates previous AI result and regrades the same paper', async (t) => {
  const review = { ...prediction, needs_human_review: true }
  const f = await markingFixture(t, { prediction: review })
  await f.call('marking-auto-start', selection)
  await waitState(f, (s) => !s.autoMark.inFlight)
  assert.equal((await f.call('marking-auto-resume')).code, 500)
  await f.call('save-config', { ...selection, config: { ...config, question_prompt: '已补充核对后的题目标准' } })
  f.llm.stream = async function* () { yield { type: 'text-delta', text: JSON.stringify(prediction) } }
  assert.equal((await f.call('marking-auto-resume')).code, 200)
  await waitState(f, (s) => s.autoMark.status === 'completed')
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0][4].ansQueSN, 101)
})

test('relogin cannot discard a held paper or replace an active account identity', async (t) => {
  const f = await markingFixture(t)
  await f.call('marking-get', selection)
  let attempted = 0
  t.mock.method(ReadonlyClient.prototype, 'login', async () => { attempted++; throw new Error('密码错误') })
  assert.equal((await f.call('login', { username: 'second' })).code, 400)
  const state = (await f.call('state', {}, 'GET')).body
  assert.equal(attempted, 0)
  assert.equal(state.connected, true)
  assert.equal(state.manualMark.ansQueSN, 101)
})

test('readonly batch streams text and cancellation does not record an incomplete paper as failed', async (t) => {
  const gate = deferred(); t.after(() => gate.resolve())
  const f = fixture(t, prediction, { '1:2:3': config }, { stream: async function* () { yield { type: 'text-delta', text: '{"criteria":[' }; await gate.promise; yield { type: 'text-delta', text: 'broken' } } })
  t.mock.method(ReadonlyClient.prototype, 'login', async () => {})
  t.mock.method(ReadonlyClient.prototype, 'listExams', async () => [])
  t.mock.method(ReadonlyClient.prototype, 'getSessionId', async () => ({ SessionId: 'offline' }))
  t.mock.method(ReadonlyClient.prototype, 'listStudents', async () => [{ ansStuSN: 1 }])
  t.mock.method(ReadonlyClient.prototype, 'studentMeta', async () => ({ stuSN: 2 }))
  t.mock.method(ReadonlyClient.prototype, 'questionCropImages', async () => [{ bytes: Buffer.from('mock'), mediaType: 'image/png' }])
  await f.call('login', { username: 'offline' })
  await f.call('model', { mode: 'harness', provider: 'mock', model: 'vision' })
  await f.call('start', { ...selection, limit: 1 })
  await waitState(f, (s) => s.job?.stream?.text.length > 0)
  await f.call('stop')
  assert.equal((await f.call('model', { mode: 'harness', provider: 'mock', model: 'vision' })).code, 500)
  gate.resolve()
  const stopped = await waitState(f, (s) => s.job.status === 'stopped')
  assert.equal(stopped.job.processed, 0)
  assert.equal(stopped.job.failed, 0)
  assert.equal(stopped.job.stream.text, '{"criteria":[')
  assert.equal(stopped.job.stream.status, 'cancelled')
})

test('failed manual cancellation retains the same claim and does not claim another paper', async (t) => {
  const f = await markingFixture(t, { cancel: async () => { throw new Error('取消失败') } })
  await f.call('marking-get', selection)
  assert.equal((await f.call('marking-cancel', { ...selection, ansQueSN: 101 })).code, 500)
  assert.equal((await f.call('marking-get', selection)).body.ansQueSN, 101)
  assert.equal(f.claims.length, 1)
})

test('image HTTP errors and HTML login pages are rejected before model input', async (t) => {
  const client = new ReadonlyClient('https://exam.invalid/')
  const area = { imgAreX1: 0, imgAreX2: 10, imgAreY1: 0, imgAreY2: 10 }
  t.mock.method(globalThis, 'fetch', async () => new Response('missing', { status: 404 }))
  await assert.rejects(client.fetchImageBytes('mock.png', area), /HTTP 404/)
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>login</html>'))
  await assert.rejects(client.fetchImageBytes('mock.png', area), /登录页/)
})

test('automatic marking preserves authenticated server-side teacher fallback', async (t) => {
  const f = await markingFixture(t)
  t.mock.method(ReadonlyClient.prototype, 'getSessionId', async () => ({ SessionId: 'mock-session' }))
  await f.call('marking-auto-start', selection)
  await waitState(f, (s) => s.autoMark.status === 'completed')
  assert.equal(f.writes[0][4].teaSN, 0)
})

test('a string review flag cannot bypass human review and reach submission', async (t) => {
  const f = await markingFixture(t, { prediction: { ...prediction, needs_human_review: 'true' } })
  await f.call('marking-auto-start', selection)
  const state = await waitState(f, (s) => !s.autoMark.inFlight)
  assert.match(state.autoMark.phase, /复核标记必须/)
  assert.equal(f.writes.length, 0)
})

test('stop during submission waits for acknowledgement, counts it once and never claims another paper', async (t) => {
  const gate = deferred(); t.after(() => gate.resolve())
  const f = await markingFixture(t, { submit: async () => { await gate.promise; return {} } })
  await f.call('marking-auto-start', selection)
  await waitState(f, (s) => s.autoMark.phase === '提交评分')
  await f.call('marking-auto-stop')
  assert.equal((await f.call('disconnect')).code, 500)
  gate.resolve()
  const stopped = await waitState(f, (s) => !s.autoMark.inFlight)
  assert.equal(stopped.autoMark.status, 'stopped')
  assert.equal(stopped.autoMark.submitted, 1)
  assert.equal(stopped.autoMark.current.submitted, true)
  assert.equal(f.writes.length, 1)
  assert.equal(f.claims.length, 1)
})

// Exercise the real request/parse/scoring pipeline for every supported method.
// Only the paper source and model are mocked; official marking calls are forbidden.
async function runQuestionType(t, cfg, output) {
  const f = fixture(t, output, { '1:2:3': cfg })
  t.mock.method(ReadonlyClient.prototype, 'login', async () => {})
  t.mock.method(ReadonlyClient.prototype, 'listExams', async () => [])
  t.mock.method(ReadonlyClient.prototype, 'getSessionId', async () => ({ SessionId: 'offline' }))
  t.mock.method(ReadonlyClient.prototype, 'listStudents', async () => [{ ansStuSN: 1 }])
  t.mock.method(ReadonlyClient.prototype, 'studentMeta', async () => ({ stuSN: 2 }))
  t.mock.method(ReadonlyClient.prototype, 'questionCropImages', async () => [{ bytes: Buffer.from('mock'), mediaType: 'image/png' }])
  for (const name of ['getQuestion', 'submitScore', 'cancelQuestion']) {
    t.mock.method(ReadonlyClient.prototype, name, async () => assert.fail('Official marking forbidden'))
  }
  await f.call('login', { username: 'offline' })
  await f.call('model', { mode: 'harness', provider: 'test', model: 'vision' })
  assert.equal((await f.call('start', { ...selection, limit: 1 })).code, 200)
  const state = await waitState(f, (s) => s.job.status !== 'running')
  return { job: state.job, calls: f.calls }
}

test('public release has no bundled examination metadata or rubric', () => {
  assert.deepEqual(QUESTION_META, [])
  assert.deepEqual(DEFAULT_CRITERIA, {})
  assert.deepEqual(DEFAULT_METHOD, {})
})

const lineConfig = { question: '补三条线', question_prompt: '每条1分，多补每条扣1分', grading_method: 'line_count',
  max_score: 3, extra_line_penalty: 1, criteria: ['a', 'b', 'c'].map((id) => ({ id, description: `线${id}`, max_score: 1 })) }
const bandConfig = { question: '画轴测图', question_prompt: '整体按0至3分档评价', grading_method: 'holistic_band',
  max_score: 3, criteria: [{ id: 'overall_shape', description: '按整体形体给整数档位', max_score: 3 }] }

for (const [extra, expected] of [[0, 3], [1, 2], [5, 0]]) {
  test(`line scoring counts correct lines and clamps ${extra} extra-line deductions to ${expected}`, async (t) => {
    const { job, calls } = await runQuestionType(t, lineConfig, { criteria: lineConfig.criteria.map((c) => ({ id: c.id, score: 1 })), extra_lines: extra })
    assert.equal(job.scored, 1)
    assert.equal(job.results[0].score, expected)
    assert.match(calls[0].system, /- line_count：/)
    assert.ok(!calls[0].system.includes('- holistic_band：'))
    assert.ok(!calls[0].system.includes('- rubric：'))
    assert.equal(job.stream.status, 'completed')
  })
}

for (const score of [0, 1, 2, 3]) {
  test(`isometric holistic band ${score} remains the same integer score`, async (t) => {
    const { job, calls } = await runQuestionType(t, bandConfig, { criteria: [{ id: 'overall_shape', score }] })
    assert.equal(job.scored, 1)
    assert.equal(job.results[0].score, score)
    assert.match(calls[0].system, /- holistic_band：/)
    assert.ok(!calls[0].system.includes('- line_count：'))
    assert.ok(!calls[0].system.includes('- rubric：'))
  })
}

for (const [label, cfg, output] of [
  ['fractional line score', lineConfig, { criteria: lineConfig.criteria.map((c) => ({ id: c.id, score: 0.5 })) }],
  ['fractional holistic band', bandConfig, { criteria: [{ id: 'overall_shape', score: 1.5 }] }],
]) {
  test(`${label} is rejected rather than rounded into a valid result`, async (t) => {
    const { job } = await runQuestionType(t, cfg, output)
    assert.equal(job.scored, 0)
    assert.equal(job.failed, 1)
  })
}

test('other rubric questions sum fractional criterion scores before rounding once', async (t) => {
  const cfg = { ...config, question_type: 'other', max_score: 3,
    criteria: [{ id: 'step', description: '步骤', max_score: 1.5 }, { id: 'answer', description: '结果', max_score: 1.5 }] }
  const { job } = await runQuestionType(t, cfg, { criteria: [{ id: 'step', score: 0.5 }, { id: 'answer', score: 0.5 }] })
  assert.equal(job.scored, 1)
  assert.equal(job.results[0].raw_score, 1)
  assert.equal(job.results[0].score, 1)
})

for (const [type, cfg] of [['line', lineConfig], ['isometric', bandConfig], ['other', { ...config, question_type: 'other' }]]) {
  test(`${type} prompt generation returns a valid draft without saving or changing weights`, async (t) => {
    const f = fixture(t, cfg)
    await f.call('model', { mode: 'harness', provider: 'test', model: 'vision' })
    const reply = await f.call('config-generate', { ...selection, question_type: type, max_score: cfg.max_score, mode: 'optimize', existing: cfg })
    assert.equal(reply.code, 200)
    assert.equal(reply.body.grading_method, cfg.grading_method)
    assert.deepEqual(reply.body.criteria, cfg.criteria)
    assert.equal(f.calls[0].reasoningEffort, undefined)
    assert.ok(!fs.existsSync(path.join(f.root, 'ameqp-grading', 'question-configs.json')))
  })
}

test('plugin declares required DSH services so startup waits for attachments and llm', () => {
  assert.ok(inject.includes('attachments'))
  assert.ok(inject.includes('llm'))
})

test('late attachment service blocks claiming until ready, then grades without reapplying the plugin', async (t) => {
  const f = await markingFixture(t, { services: { attachments: undefined } })
  const blocked = await f.call('marking-auto-start', selection)
  assert.equal(blocked.code, 500)
  assert.match(blocked.body.error, /图像附件服务尚未就绪/)
  assert.equal(f.claims.length, 0)
  assert.equal(f.calls.length, 0)
  assert.equal((await f.call('state', {}, 'GET')).body.services.attachments, false)
  let savedImages = 0
  f.services.attachments = { saveImage: async () => { savedImages++; return { id: 'late-image' } } }
  assert.equal((await f.call('state', {}, 'GET')).body.services.attachments, true)
  assert.equal((await f.call('marking-auto-start', selection)).code, 200)
  await waitState(f, (s) => s.autoMark.status === 'completed')
  assert.equal(savedImages, 1)
  assert.equal(f.writes.length, 1)
})

test('missing attachment method blocks readonly batch before reading papers', async (t) => {
  const f = await markingFixture(t, { services: { attachments: {} } })
  t.mock.method(ReadonlyClient.prototype, 'listStudents', async () => assert.fail('No paper reads before readiness'))
  assert.equal((await f.call('start', { ...selection, limit: 1 })).code, 500)
  assert.equal(f.claims.length, 0)
  assert.equal((await f.call('state', {}, 'GET')).body.job, null)
})

test('prompt generation resolves late model and attachment services at request time', async (t) => {
  const f = fixture(t, config, null, { services: { llm: undefined, attachments: undefined } })
  await f.call('model', { mode: 'harness', provider: 'test', model: 'vision' })
  const body = { ...selection, question_type: 'design', max_score: 8, mode: 'optimize', existing: config,
    stem_image: 'data:image/png;base64,aW1hZ2U=' }
  assert.equal((await f.call('config-generate', body)).code, 500)
  f.services.llm = f.llm
  let savedImages = 0
  f.services.attachments = { saveImage: async () => { savedImages++; return { id: 'late-stem' } } }
  assert.equal((await f.call('config-generate', body)).code, 200)
  assert.equal(savedImages, 1)
  assert.equal(f.calls.length, 1)
})

test('AI marking reads ready-cropped answer records when the server omits full page images', async (t) => {
  const data = { ansQueSN: 101, ansStuSN: 202, ansQueMarkState: 'A', AnsImageQuestionAreaRec: [{ FileName: 'cut-1.png' }, { FileName: 'cut-2.png' }] }
  const f = await markingFixture(t, { claim: async (count) => count === 1 ? data : null })
  t.mock.method(ReadonlyClient.prototype, 'claimCropImages', async () => { throw new Error('领卷未返回整页图像') })
  const files = []
  t.mock.method(ReadonlyClient.prototype, 'fetchByFileName', async (file) => { files.push(file); return { bytes: Buffer.from(file), mediaType: 'image/png' } })
  await f.call('marking-auto-start', selection)
  const state = await waitState(f, (s) => s.autoMark.status === 'completed')
  assert.deepEqual(files, ['cut-1.png', 'cut-2.png'])
  assert.equal(state.autoMark.current.images.length, 2)
  const image = await f.call('marking-image?exam=1&subject=2&question=3&ans=101&page=1', {}, 'GET')
  assert.equal(image.code, 200)
  assert.equal(image.bytes.toString(), 'cut-2.png')
  assert.equal(f.writes.length, 1)
})

test('a failed cropped answer download pauses and resumes the same claim without a fresh claim', async (t) => {
  const data = { ansQueSN: 101, ansStuSN: 202, ansQueMarkState: 'A', AnsImageQuestionAreaRec: [{ FileName: 'cut.png' }] }
  const f = await markingFixture(t, { claim: async (count) => count === 1 ? data : null })
  t.mock.method(ReadonlyClient.prototype, 'claimCropImages', async () => { throw new Error('没有整页图像') })
  let failing = true
  t.mock.method(ReadonlyClient.prototype, 'fetchByFileName', async () => {
    if (failing) throw new Error('HTTP 404')
    return { bytes: Buffer.from('answer'), mediaType: 'image/png' }
  })
  await f.call('marking-auto-start', selection)
  const paused = await waitState(f, (s) => s.autoMark.status === 'paused' && !s.autoMark.inFlight)
  assert.match(paused.autoMark.phase, /题目区域图.*HTTP 404/)
  assert.equal(paused.autoMark.current.ansQueSN, 101)
  assert.equal(f.claims.length, 1)
  assert.equal(f.calls.length, 0)
  assert.equal(f.writes.length, 0)
  failing = false
  await f.call('marking-auto-resume')
  await waitState(f, (s) => s.autoMark.status === 'completed')
  assert.equal(f.writes[0][4].ansQueSN, 101)
  assert.equal(f.claims.length, 2) // The second call checks for the next paper only after submitting 101.
})

test('answer crops match page identifiers supplied as numbers or strings', async (t) => {
  const client = new ReadonlyClient('https://exam.invalid/')
  t.mock.method(client, 'defQuestionInfo', async () => ({ ImageArea: [{ imgSN: '11', imgAreX1: 0, imgAreY1: 0, imgAreX2: 10, imgAreY2: 10 }] }))
  t.mock.method(client, 'fetchImageBytes', async (file) => { assert.equal(file, 'page.png'); return { bytes: Buffer.from('image'), mediaType: 'image/png' } })
  const images = await client.claimCropImages(1, 2, 3, 'mock', { AnsImagePageRec: [{ imgSN: 11, ansImgPath: 'page.png' }] })
  assert.equal(images.length, 1)
})

test('manual resolution of an AI review submits the same paper and unlocks continuation', async (t) => {
  const f = await markingFixture(t, { prediction: { ...prediction, needs_human_review: true, reason: '需确认图像细节' } })
  await f.call('marking-auto-start', selection)
  const paused = await waitState(f, (s) => s.autoMark.status === 'paused' && !s.autoMark.inFlight)
  assert.equal(paused.autoMark.current.review_reason, '需确认图像细节')
  assert.equal(paused.autoMark.current.max_score, 8)
  assert.equal(paused.autoMark.review, 1)
  assert.equal((await f.call('marking-submit', { ...selection, ansQueSN: 101, value: 7.5 })).code, 500)
  assert.equal(f.writes.length, 0)
  const submitted = await f.call('marking-submit', { ...selection, ansQueSN: 101, value: 7 })
  assert.equal(submitted.code, 200)
  const resolved = (await f.call('state', {}, 'GET')).body
  assert.equal(resolved.autoMark.current.submitted, true)
  assert.equal(resolved.autoMark.current.needs_human_review, false)
  assert.equal(resolved.autoMark.review, 0)
  assert.equal(resolved.autoMark.submitted, 1)
  assert.equal(f.claims.length, 1)
  assert.equal((await f.call('marking-submit', { ...selection, ansQueSN: 101, value: 7 })).code, 500)
  assert.equal(f.writes.length, 1)
  assert.equal((await f.call('marking-auto-resume')).code, 200)
  await waitState(f, (s) => s.autoMark.status === 'completed')
  assert.equal(f.claims.length, 2)
  assert.equal(f.writes.length, 1)
})

test('cancelling an AI review releases its pending review count without submitting a score', async (t) => {
  const f = await markingFixture(t, { prediction: { ...prediction, needs_human_review: true } })
  await f.call('marking-auto-start', selection)
  await waitState(f, (s) => s.autoMark.status === 'paused' && !s.autoMark.inFlight)
  assert.equal((await f.call('marking-cancel', { ...selection, ansQueSN: 101 })).code, 200)
  const state = (await f.call('state', {}, 'GET')).body
  assert.equal(state.autoMark.current, null)
  assert.equal(state.autoMark.review, 0)
  assert.equal(f.writes.length, 0)
  assert.equal(f.cancels.length, 1)
})

test('complete blocks repair missing stream deltas before scoring the held paper', async (t) => {
  const raw = JSON.stringify(prediction)
  const f = await markingFixture(t, { stream: async function* () {
    yield { type: 'text-delta', text: raw.slice(0, 20) }
    yield { type: 'block-end', block: { type: 'text', text: raw } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } })
  await f.call('marking-auto-start', selection)
  const state = await waitState(f, (s) => s.autoMark.status === 'completed')
  assert.equal(state.autoMark.stream.text, raw)
  assert.equal(state.autoMark.stream.chars, raw.length)
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0][4].marQueMarkValue, 7)
})

test('the observed translated container preserves exact item scores and IDs', async (t) => {
  const output = { 标准: prediction.criteria, needs_human_review: false, extra_lines: 0 }
  const f = await markingFixture(t, { prediction: output })
  await f.call('marking-auto-start', selection)
  const done = await waitState(f, (s) => s.autoMark.status === 'completed')
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0][4].marQueMarkValue, 7)
  assert.deepEqual(done.autoMark.current.criteria.map(({ id, score }) => ({ id, score })), prediction.criteria.map(({ id, score }) => ({ id, score })))
})

for (const [name, output, message] of [
  ['missing item', { 标准: prediction.criteria.slice(0, 1) }, /评分项与本题配置不一致/],
  ['renamed item ID', { 标准: prediction.criteria.map((c) => ({ ...c, id: c.id + '_translated' })) }, /评分项与本题配置不一致/],
  ['invalid score', { 标准: prediction.criteria.map((c) => ({ ...c, score: '4' })) }, /非法分项分数/],
  ['two competing containers', { criteria: prediction.criteria, 标准: prediction.criteria }, /多个评分项字段/],
]) {
  test(`translated container rejects ${name} without submitting the held paper`, async (t) => {
    const f = await markingFixture(t, { prediction: output })
    await f.call('marking-auto-start', selection)
    const paused = await waitState(f, (s) => s.autoMark.status === 'paused' && !s.autoMark.inFlight)
    assert.match(paused.autoMark.phase, message)
    assert.equal(f.writes.length, 0)
    assert.equal(f.claims.length, 1)
    assert.equal(paused.autoMark.current.ansQueSN, 101)
  })
}

test('conflicting model JSON pauses the same paper, records diagnostics and never submits a guessed score', async (t) => {
  const conflict = { criteria: [{ id: 'sketch', score: 1 }, { id: 'dimensions', score: 1 }] }
  const raw = JSON.stringify(prediction) + '\n' + JSON.stringify(conflict)
  const f = await markingFixture(t, { stream: async function* () { yield { type: 'text-delta', text: raw } } })
  await f.call('marking-auto-start', selection)
  const paused = await waitState(f, (s) => s.autoMark.status === 'paused' && !s.autoMark.inFlight)
  assert.match(paused.autoMark.phase, /相互冲突/)
  assert.equal(f.writes.length, 0)
  assert.equal(f.claims.length, 1)
  const diagnostic = JSON.parse(fs.readFileSync(path.join(f.root, 'ameqp-grading', 'last-model-error.json'), 'utf8'))
  assert.equal(diagnostic.text, raw)
  f.llm.stream = async function* () { yield { type: 'text-delta', text: JSON.stringify(prediction) } }
  await f.call('marking-auto-resume')
  await waitState(f, (s) => s.autoMark.status === 'completed')
  assert.equal(f.writes[0][4].ansQueSN, 101)
  assert.equal(f.writes.length, 1)
})

test('the default 200-paper limit continues across successive batches without losing cumulative counts', async (t) => {
  const f = await markingFixture(t, { claim: async (count) => count <= 401 ? { ansQueSN: 1000 + count, ansStuSN: 2000 + count, ansQueMarkState: 'A' } : null })
  await f.call('marking-auto-start', selection)
  const capped = await waitState(f, (s) => s.autoMark.pauseReason === 'batch_limit' && !s.autoMark.inFlight)
  assert.equal(capped.autoMark.status, 'paused')
  assert.equal(capped.autoMark.submitted, 200)
  assert.equal(capped.autoMark.batchSubmitted, 200)
  assert.equal(capped.autoMark.batchNumber, 1)
  assert.match(capped.autoMark.phase, /可继续下一批/)
  assert.equal(f.claims.length, 200)
  assert.equal(f.writes.length, 200)
  assert.equal((await f.call('marking-auto-resume')).code, 200)
  const second = await waitState(f, (s) => s.autoMark.pauseReason === 'batch_limit' && !s.autoMark.inFlight)
  assert.equal(second.autoMark.submitted, 400)
  assert.equal(second.autoMark.batchSubmitted, 200)
  assert.equal(second.autoMark.batchNumber, 2)
  assert.equal(f.claims.length, 400)
  assert.equal((await f.call('marking-auto-resume')).code, 200)
  const finished = await waitState(f, (s) => s.autoMark.status === 'completed')
  assert.equal(finished.autoMark.submitted, 401)
  assert.equal(finished.autoMark.batchSubmitted, 1)
  assert.equal(finished.autoMark.batchNumber, 3)
  assert.equal(f.writes.length, 401)
  assert.equal(f.writes.at(-1)[4].ansQueSN, 1401)
})

test('pausing within a batch preserves its budget and resumes the already held paper', async (t) => {
  const gate = deferred(); t.after(() => gate.resolve())
  const f = await markingFixture(t, { runtimeConfig: { autoMaxPapers: 2 }, claim: async (count) => {
    if (count === 2) await gate.promise
    return count <= 2 ? { ansQueSN: 100 + count, ansStuSN: 200 + count, ansQueMarkState: 'A' } : null
  } })
  await f.call('marking-auto-start', selection)
  await waitState(f, () => f.claims.length === 2)
  await f.call('marking-auto-pause')
  gate.resolve()
  const paused = await waitState(f, (s) => !s.autoMark.inFlight)
  assert.equal(paused.autoMark.batchSubmitted, 1)
  assert.equal(paused.autoMark.batchNumber, 1)
  await f.call('marking-auto-resume')
  const capped = await waitState(f, (s) => s.autoMark.pauseReason === 'batch_limit' && !s.autoMark.inFlight)
  assert.equal(capped.autoMark.batchSubmitted, 2)
  assert.equal(capped.autoMark.submitted, 2)
  assert.equal(f.claims.length, 2)
  assert.equal(f.writes.at(-1)[4].ansQueSN, 102)
})

test('manual resolution at a batch boundary counts once and can explicitly continue the next batch', async (t) => {
  const f = await markingFixture(t, { runtimeConfig: { autoMaxPapers: 1 }, prediction: { ...prediction, needs_human_review: true } })
  await f.call('marking-auto-start', selection)
  await waitState(f, (s) => s.autoMark.status === 'paused' && !s.autoMark.inFlight)
  await f.call('marking-submit', { ...selection, ansQueSN: 101, value: 7 })
  const handled = (await f.call('state', {}, 'GET')).body.autoMark
  assert.equal(handled.submitted, 1)
  assert.equal(handled.batchSubmitted, 1)
  assert.equal(handled.batchNumber, 1)
  await f.call('marking-auto-resume')
  const completed = await waitState(f, (s) => s.autoMark.status === 'completed')
  assert.equal(completed.autoMark.submitted, 1)
  assert.equal(completed.autoMark.batchSubmitted, 0)
  assert.equal(completed.autoMark.batchNumber, 2)
  assert.equal(f.writes.length, 1)
})

for (const [scores, raw, expected] of [
  [[0.25, 0.25], 0.5, 1],
  [[3.25, 3], 6.25, 6],
  [[3.25, 3.5], 6.75, 7],
]) {
  test(`quarter-point items ${scores.join('+')} keep the original scale and round only the final sum`, async (t) => {
    const { job } = await runQuestionType(t, config, { criteria: config.criteria.map((c, i) => ({ id: c.id, score: scores[i] })) })
    assert.equal(job.scored, 1)
    assert.deepEqual(job.results[0].criteria.map((c) => c.score), scores)
    assert.equal(job.results[0].raw_score, raw)
    assert.equal(job.results[0].score, expected)
    assert.ok(Number.isInteger(job.results[0].score))
  })
}
