import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { apply } from '../grading-host.js'
import { ReadonlyClient } from '../ameqp.js'
import { DECISIONS_ENDPOINT, DECISIONS_MODEL, buildDecisionRequest, parseDecisionResponse, testDecisions, decodeDecisionImage } from '../decisions.js'

// These tests never use a real account credential or transport. Every fetch is
// injected below; the global guard catches accidental fallback network calls.
const forbiddenFetch = async () => { assert.fail('External network access is forbidden in Decisions offline tests') }
const savedFetch = globalThis.fetch
globalThis.fetch = forbiddenFetch
test.after(() => { globalThis.fetch = savedFetch })
// Synthetic one-pixel PNG: no student work or examination asset.
const image = { bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB3sAAAAASUVORK5CYII=', 'base64'), mediaType: 'image/png' }
const dataUrl = (value = image) => `data:${value.mediaType};base64,${value.bytes.toString('base64')}`
const config = {
  question: 'OFFLINE_QUESTION', question_prompt: 'OFFLINE_RULES', grading_method: 'rubric', max_score: 8,
  criteria: [{ id: 'sketch', description: 'Sketch visible features', max_score: 4 }, { id: 'dimensions', description: 'Visible dimensions', max_score: 4 }],
}
function input(overrides = {}) { return { config: structuredClone(config), prompt: 'OFFLINE_GLOBAL_PROMPT', images: { answers: [image] }, ...overrides } }
function request(overrides) { return buildDecisionRequest(input(overrides)) }
function response(req, choices = {}, confidence = 1) {
  return { code: 0, data: { requestId: 'offline-request', creditsUsed: 3, result: {
    model: DECISIONS_MODEL + '-2026-11-10', elapsedMs: 123,
    usage: { input_tokens: 100, output_tokens: 20 },
    answers: Object.fromEntries(Object.entries(req.payload.questions).map(([name, question]) => {
      const choice = choices[name] || (name === 'image_quality' ? 'readable' : name === 'extra_lines' ? 'n_0' : 's_0')
      return [name, { type: 'choice', choice, confidence,
        probabilities: Object.fromEntries(Object.keys(question.criteria).map((option) => [option, option === choice ? 1 : 0])) }]
    })),
  } } }
}
function output(req, choices, confidence) { return parseDecisionResponse(response(req, choices, confidence), req, 456) }
function spread(answer, first, second) {
  for (const key of Object.keys(answer.probabilities)) answer.probabilities[key] = 0
  answer.probabilities[first] = 0.55; answer.probabilities[second] = 0.45
}
const nextTick = () => new Promise((resolve) => setImmediate(resolve))
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
function hostOk(reply) { assert.equal(reply.code, 200, JSON.stringify(reply.body)); return reply.body }
function hostRejected(reply) { assert.ok(reply.code >= 400 && reply.code !== 404, JSON.stringify(reply)); assert.equal(typeof reply.body.error, 'string') }
function filesUnder(root) {
  const files = {}
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(target)
      else if (entry.isFile()) files[path.relative(root, target)] = fs.readFileSync(target).toString('base64')
    }
  }
  visit(root)
  return files
}
function hostFixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ameqp-decisions-test-'))
  const previousHome = process.env.DSH_HOME, previousKey = process.env.DECISIONS_API_KEY
  process.env.DSH_HOME = root
  process.env.DECISIONS_API_KEY = 'OFFLINE_ENV_KEY'
  const calls = [], operations = [], gates = [], externalRequests = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url !== DECISIONS_ENDPOINT) externalRequests.push(String(url))
    assert.equal(url, DECISIONS_ENDPOINT, 'Every unexpected network destination must fail locally')
    assert.equal(init.method, 'POST')
    const payload = JSON.parse(init.body)
    calls.push({ url, init, payload })
    if (options.fetch) return options.fetch(url, init, payload)
    return { ok: true, status: 200, json: async () => response({ payload }) }
  })
  for (const name of ['login', 'logout', 'listExams', 'getSessionId', 'getQuestion', 'claimCropImages', 'submitScore', 'cancelQuestion', 'keepAlive']) {
    t.mock.method(ReadonlyClient.prototype, name, async function (...args) {
      operations.push({ name, args })
      if (name === 'getSessionId') return { SessionId: 'offline-session', teaSN: 99 }
      if (name === 'getQuestion') return { ansQueSN: 101, ansQueMarkState: 'A' }
      if (name === 'claimCropImages') return [image]
      if (name === 'listExams') return []
      return {}
    })
  }
  let handler
  const llm = { resolveModelInfo: async () => ({}), stream: async function* (request) {
    if (options.stream) yield* options.stream(request)
    else yield { type: 'text-delta', text: JSON.stringify({ criteria: [{ id: 'sketch', score: 4 }, { id: 'dimensions', score: 3 }] }) }
  } }
  const services = { llm, attachments: { saveImage: async () => ({ id: 'offline-image' }) } }
  const runtime = apply({ get: (name) => services[name], inject: (_, callback) => callback({ effect: (fn) => fn(),
    webServer: { register: (route) => { assert.equal(route.path, '/ameqp-grading'); handler = route.handler; return () => {} } },
  }) }, { ameqpBase: 'https://exam.invalid/AMEQP/', productionMarking: true, ...options.config })
  async function call(route, body = {}, method = 'POST') {
    const req = new PassThrough(); req.method = method; req.url = '/ameqp-grading/api/' + route
    let output
    const res = { statusCode: 200, setHeader() {}, end(value) { output = value } }
    const pending = handler(req, res)
    req.end(JSON.stringify(body)); await pending
    assert.notEqual(output, undefined)
    return { code: res.statusCode, body: JSON.parse(String(output)) }
  }
  async function wait(predicate) {
    for (let i = 0; i < 100; i++) {
      await nextTick()
      if (await predicate()) return
    }
    assert.fail('Offline Decisions Host did not reach expected state')
  }
  t.after(async () => {
    runtime.dispose()
    for (const g of gates) g.resolve()
    for (let i = 0; i < 20; i++) await nextTick()
    for (const [name, value] of [['DSH_HOME', previousHome], ['DECISIONS_API_KEY', previousKey]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('ameqp-decisions-test-'))
    fs.rmSync(root, { recursive: true, force: true })
    assert.deepEqual(externalRequests, [], 'Unexpected network requests must never be attempted')
  })
  return { root, calls, operations, call, wait, dispose: () => runtime.dispose(),
    gate() { const g = deferred(); gates.push(g); return g },
    state: async (id) => hostOk(await call(id ? `accounts/${id}/state` : 'state', {}, 'GET')) }
}

function sizedPng(size) {
  assert.ok(image.bytes.length < size)
  // Keep a real PNG carrier, padded only for explicit rejection-budget cases.
  return { bytes: Buffer.concat([image.bytes, Buffer.alloc(size - image.bytes.length)]), mediaType: 'image/png' }
}

test('request uses the fixed Decisions choice protocol, complete role-labelled images and independent quarter-point mappings', () => {
  const original = input({ images: { stem: image, standard: image, answers: [image, image] } })
  const before = structuredClone(original.config)
  const req = buildDecisionRequest(original)
  assert.equal(DECISIONS_ENDPOINT, 'https://decisions-api.dev/v1/systemone')
  assert.equal(DECISIONS_MODEL, 'openai/gpt-6-luna-decisions')
  assert.deepEqual(Object.keys(req.payload).sort(), ['images', 'model', 'questions', 'state'])
  assert.equal(req.payload.model, DECISIONS_MODEL)
  assert.equal(req.protocol, 'systemone-choice-v1')
  assert.equal(Array.isArray(req.payload.state), false)
  assert.equal(typeof req.payload.state, 'object')
  assert.match(req.payload.state.instructions, /OFFLINE_GLOBAL_PROMPT/)
  assert.equal(req.payload.state.question.question_prompt, config.question_prompt)
  assert.deepEqual(Object.keys(req.payload.questions), ['image_quality', 'criterion_0', 'criterion_1'])
  assert.ok(Object.values(req.payload.questions).every((q) => q.type === 'choice'))
  assert.equal(req.payload.images.length, 4)
  assert.deepEqual(req.payload.images, Array.from({ length: 4 }, () => ({ url: dataUrl() })))
  assert.deepEqual(req.payload.state.image_roles.map((r) => r.image), [1, 2, 3, 4])
  assert.match(req.payload.state.image_roles[0].role, /题干/)
  assert.match(req.payload.state.image_roles[1].role, /参考/)
  assert.match(req.payload.state.image_roles[2].role, /学生作答图1/)
  assert.match(req.payload.state.image_roles[3].role, /学生作答图2/)
  assert.deepEqual(req.mapping[0].values, Array.from({ length: 17 }, (_, i) => i / 4))
  assert.equal(req.mapping[0].id, 'sketch')
  assert.ok(Object.hasOwn(req.payload.questions.criterion_0.criteria, 'unresolved'))
  assert.deepEqual(original.config, before)
  original.config.criteria[0].max_score = 99
  assert.equal(req.config.criteria[0].max_score, 4)
})

test('image decoder preserves real PNG bytes and rejects external URLs, wrong media and noncanonical base64', () => {
  assert.deepEqual(decodeDecisionImage(dataUrl()), image)
  for (const value of ['https://example.invalid/paper.png', 'data:image/gif;base64,AAAA', 'data:image/png;base64,%%%', 'data:image/png;base64,AAAA=', 'data:image/png;base64,']) {
    assert.throws(() => decodeDecisionImage(value), /图片|Base64|data URL/)
  }
  assert.throws(() => request({ images: { answers: [{ bytes: Buffer.from('not an image'), mediaType: 'image/png' }] } }), /格式|尺寸/)
})

test('request rejects missing or invalid student images without silently dropping any answer', () => {
  for (const answers of [undefined, [], [null], [image, null], [undefined], [{ bytes: Buffer.alloc(0), mediaType: 'image/png' }]]) {
    assert.throws(() => request({ images: { stem: image, answers } }), /图片|作答图|图像/)
  }
})

test('image count, per-image bytes, total bytes and pixel ceilings reject oversized requests locally', () => {
  assert.throws(() => request({ images: { stem: image, standard: image, answers: [image, image, image] } }), /4张|丢图/)
  assert.throws(() => request({ images: { answers: [sizedPng(4 * 1024 * 1024 + 1)] } }), /4MiB/)
  assert.throws(() => request({ images: { answers: Array.from({ length: 3 }, () => sizedPng(3 * 1024 * 1024)) } }), /合计.*8MiB/)
  const giantHeader = { ...image, bytes: Buffer.from(image.bytes) }
  giantHeader.bytes.writeUInt32BE(4001, 16); giantHeader.bytes.writeUInt32BE(4000, 20)
  assert.throws(() => request({ images: { answers: [giantHeader] } }), /1600万像素/)
  const zeroHeader = { ...image, bytes: Buffer.from(image.bytes) }
  zeroHeader.bytes.writeUInt32BE(0, 16)
  assert.throws(() => request({ images: { answers: [zeroHeader] } }), /像素/)
})

test('question and text budgets reject rather than truncating or creating multiple billable requests', async () => {
  const eight = { ...config, max_score: 8, criteria: Array.from({ length: 8 }, (_, i) => ({ id: 'item-' + i, description: 'Item', max_score: 1 })) }
  assert.throws(() => request({ config: eight }), /8个问题/)
  const seven = { ...eight, max_score: 7, criteria: eight.criteria.slice(0, 7) }
  assert.equal(Object.keys(request({ config: seven }).payload.questions).length, 8)
  assert.throws(() => request({ prompt: '长'.repeat(32 * 1024) }), /32KiB|截断/)
  let calls = 0
  await assert.rejects(testDecisions(input({ config: eight }), { apiKey: 'OFFLINE_TEST_KEY', fetchImpl: async () => { calls++; assert.fail('Invalid budget must not be sent') } }), /8个问题/)
  assert.equal(calls, 0)
})

test('line counting uses binary items plus explicit extra-line counts while holistic bands remain integer choices', () => {
  const lines = { ...config, grading_method: 'line_count', max_score: 2, extra_line_penalty: 0.5,
    criteria: [{ id: 'line1', description: 'Required line 1', max_score: 1 }, { id: 'line2', description: 'Required line 2', max_score: 1 }] }
  const req = request({ config: lines })
  assert.deepEqual(req.mapping.map((m) => m.values), [[0, 1], [0, 1]])
  assert.ok(Object.hasOwn(req.payload.questions, 'extra_lines'))
  assert.equal(req.payload.questions.extra_lines.type, 'choice')
  assert.ok(Object.hasOwn(req.payload.questions.extra_lines.criteria, 'n_100'))
  const holistic = { ...config, grading_method: 'holistic_band', max_score: 3, criteria: [{ id: 'shape', description: 'Whole shape band', max_score: 3 }] }
  assert.deepEqual(request({ config: holistic }).mapping[0].values, [0, 1, 2, 3])
})

for (const step of [0.25, 0.5, 1]) {
  test(`score step ${step} maps named choices to local values instead of a soft score index`, () => {
    const req = request({ scoreStep: step })
    const result = output(req, { criterion_0: 's_1', criterion_1: 's_1' })
    assert.deepEqual(result.criteria.map((c) => c.score), [step, step])
    assert.equal(result.raw_score, step * 2)
    assert.equal(result.score, Math.round(step * 2))
  })
}

test('invalid criteria, duplicate IDs, unsupported steps and excessive options reject before transport', () => {
  assert.throws(() => request({ scoreStep: 0.1 }), /步长/)
  assert.throws(() => request({ config: { ...config, criteria: [config.criteria[0], config.criteria[0]] } }), /重复/)
  assert.throws(() => request({ config: { ...config, max_score: 9 } }), /之和/)
  assert.throws(() => request({ config: { ...config, question_prompt: '' } }), /规则/)
  assert.throws(() => request({ config: { ...config, max_score: 100, criteria: [{ id: 'huge', description: 'Too many choices', max_score: 100 }] } }), /档位过多/)
})

for (const [choices, raw, rounded] of [
  [{ criterion_0: 's_1', criterion_1: 's_1' }, 0.5, 1],
  [{ criterion_0: 's_13', criterion_1: 's_12' }, 6.25, 6],
  [{ criterion_0: 's_13', criterion_1: 's_14' }, 6.75, 7],
]) {
  test(`quarter-point subtotal ${raw} rounds exactly once to ${rounded}`, () => {
    const req = request(), result = output(req, choices)
    assert.equal(result.raw_score, raw); assert.equal(result.score, rounded)
    assert.equal(result.criteria.reduce((sum, item) => sum + item.score, 0), raw)
  })
}

test('extra-line penalties apply after summing binary scores and floor at zero before final rounding', () => {
  const lines = { ...config, grading_method: 'line_count', max_score: 2, extra_line_penalty: 0.5,
    criteria: [{ id: 'l1', description: 'Line', max_score: 1 }, { id: 'l2', description: 'Line', max_score: 1 }] }
  const req = request({ config: lines })
  const result = output(req, { criterion_0: 's_1', criterion_1: 's_1', extra_lines: 'n_1' })
  assert.equal(result.extra_lines, 1); assert.equal(result.penalty, 0.5)
  assert.equal(result.raw_score, 1.5); assert.equal(result.score, 2)
  assert.equal(output(req, { extra_lines: 'n_100' }).score, 0)
})

for (const choice of ['unreadable', 'unresolved']) {
  test(`${choice} never turns an unreadable or unresolved decision into a numeric total`, () => {
    const req = request()
    const choices = choice === 'unreadable' ? { image_quality: choice } : { criterion_0: choice }
    const result = output(req, choices)
    assert.equal(result.score, null); assert.equal(result.raw_score, null)
    assert.equal(result.needs_human_review, true)
    assert.equal(result.test_only, true); assert.equal(result.submitted, false)
  })
}

test('unresolved extra-line count also withholds a total', () => {
  const cfg = { ...config, grading_method: 'line_count', max_score: 1, extra_line_penalty: 1, criteria: [{ id: 'line', description: 'Line', max_score: 1 }] }
  const req = request({ config: cfg })
  assert.equal(output(req, { criterion_0: 's_1', extra_lines: 'unresolved' }).score, null)
})

test('low confidence and near-tied criterion probabilities mark an experimental score for review', () => {
  const req = request(), body = response(req)
  spread(body.data.result.answers.criterion_0, 's_0', 's_1')
  assert.equal(parseDecisionResponse(body, req, 1).needs_human_review, true)
  assert.equal(output(req, {}, 0.5).needs_human_review, true)
  const result = output(req)
  assert.equal(result.needs_human_review, false)
  assert.equal(result.elapsedMs, 456); assert.equal(result.upstreamElapsedMs, 123)
  assert.equal(result.creditsUsed, 3)
  assert.deepEqual(result.usage, { input_tokens: 100, output_tokens: 20 })
  assert.equal(result.requestId, 'offline-request')
  assert.match(result.model, /-2026-11-10$/)
  assert.ok(result.warnings.some((w) => /概率|confidence/.test(w)))
})

for (const name of ['image_quality', 'extra_lines']) {
  test(`low-confidence ${name} cannot bypass the manual-review diagnostic`, () => {
    const cfg = name === 'extra_lines'
      ? { ...config, grading_method: 'line_count', max_score: 1, extra_line_penalty: 1, criteria: [{ id: 'line', description: 'Line', max_score: 1 }] }
      : config
    const req = request({ config: cfg }), body = response(req)
    body.data.result.answers[name].confidence = 0.5
    assert.equal(parseDecisionResponse(body, req, 1).needs_human_review, true)
    const spreadBody = response(req)
    spread(spreadBody.data.result.answers[name], name === 'image_quality' ? 'readable' : 'n_0', name === 'image_quality' ? 'unreadable' : 'n_1')
    assert.equal(parseDecisionResponse(spreadBody, req, 1).needs_human_review, true)
  })
}

test('transport exceptions redact the trimmed credential actually sent in Authorization', async () => {
  await assert.rejects(testDecisions(input(), { apiKey: '  OFFLINE_TEST_KEY  ', fetchImpl: async () => { throw new Error('authorization failed OFFLINE_TEST_KEY') } }), (error) => {
    assert.ok(!error.message.includes('OFFLINE_TEST_KEY'))
    assert.match(error.message, /可能已计费/)
    return true
  })
})

for (const [name, mutate] of [
  ['missing answer', (b) => { delete b.data.result.answers.criterion_0 }],
  ['extra answer', (b) => { b.data.result.answers.unknown = b.data.result.answers.criterion_0 }],
  ['renamed answer', (b) => { b.data.result.answers.unknown = b.data.result.answers.criterion_0; delete b.data.result.answers.criterion_0 }],
  ['non-choice answer', (b) => { b.data.result.answers.criterion_0.type = 'score' }],
  ['unknown choice', (b) => { b.data.result.answers.criterion_0.choice = 's_999' }],
  ['missing probabilities', (b) => { delete b.data.result.answers.criterion_0.probabilities }],
  ['incomplete options', (b) => { delete b.data.result.answers.criterion_0.probabilities.unresolved }],
  ['unknown probability option', (b) => { b.data.result.answers.criterion_0.probabilities.unknown = 0 }],
  ['negative probability', (b) => { b.data.result.answers.criterion_0.probabilities.s_0 = -1 }],
  ['oversized probability', (b) => { b.data.result.answers.criterion_0.probabilities.s_0 = 2 }],
  ['string probability', (b) => { b.data.result.answers.criterion_0.probabilities.s_0 = '1' }],
  ['nonfinite probability', (b) => { b.data.result.answers.criterion_0.probabilities.s_0 = NaN }],
  ['probability mass', (b) => { b.data.result.answers.criterion_0.probabilities.s_0 = 0.2 }],
  ['missing confidence', (b) => { delete b.data.result.answers.criterion_0.confidence }],
  ['invalid confidence', (b) => { b.data.result.answers.criterion_0.confidence = 1.1 }],
  ['wrong model', (b) => { b.data.result.model = 'other/model' }],
  ['invalid credits', (b) => { b.data.creditsUsed = -1 }],
  ['error envelope', (b) => { b.code = 1 }],
]) {
  test(`response rejects ${name} without inventing a score`, () => {
    const req = request(), body = response(req)
    mutate(body)
    assert.throws(() => parseDecisionResponse(body, req, 1), /Decisions/)
  })
}

test('test transport sends one fixed request with temporary credentials and returns test-only scoring metadata', async () => {
  const calls = [], controller = new AbortController()
  const result = await testDecisions(input(), { apiKey: '  OFFLINE_TEST_KEY  ', signal: controller.signal, fetchImpl: async (url, init) => {
    calls.push({ url, init })
    assert.equal(url, DECISIONS_ENDPOINT); assert.equal(init.method, 'POST')
    assert.equal(init.redirect, 'error')
    assert.equal(init.headers.Authorization, 'Bearer OFFLINE_TEST_KEY')
    assert.equal(init.headers['Content-Type'], 'application/json')
    assert.match(init.headers['Idempotency-Key'], /^ameqp-/)
    assert.ok(init.signal instanceof AbortSignal)
    const payload = JSON.parse(init.body)
    assert.equal(payload.model, DECISIONS_MODEL)
    assert.equal(payload.messages, undefined)
    assert.ok(!init.body.includes('OFFLINE_TEST_KEY'))
    return { ok: true, status: 200, json: async () => response(request(), { criterion_0: 's_16', criterion_1: 's_12' }) }
  } })
  assert.equal(calls.length, 1)
  assert.equal(result.score, 7)
  assert.equal(result.test_only, true); assert.equal(result.submitted, false)
  assert.ok(!JSON.stringify(result).includes('OFFLINE_TEST_KEY'))
})

test('request context excludes student identifiers and private reference scores', () => {
  const req = request({ config: { ...config, ansStuSN: 'PRIVATE_STUDENT_ID', reference_score: 'PRIVATE_REFERENCE_SCORE', student_name: 'PRIVATE_STUDENT_NAME' } })
  const transmitted = JSON.stringify(req.payload)
  assert.ok(!transmitted.includes('PRIVATE_STUDENT'))
  assert.ok(!transmitted.includes('PRIVATE_REFERENCE'))
})

test('cancellation propagates to the single request without retries or a fallback model', async () => {
  const controller = new AbortController()
  let calls = 0
  const pending = testDecisions(input(), { apiKey: 'OFFLINE_TEST_KEY', signal: controller.signal, fetchImpl: async (url, init) => {
    calls++
    assert.equal(url, DECISIONS_ENDPOINT)
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('offline abort')), { once: true }))
  } })
  controller.abort()
  await assert.rejects(pending, /不会自动重试/)
  assert.equal(calls, 1)
})

test('separate explicit trials create separate idempotency keys and never silently batch requests', async () => {
  const keys = []
  const fetchImpl = async (url, init) => {
    assert.equal(url, DECISIONS_ENDPOINT)
    keys.push(init.headers['Idempotency-Key'])
    return { ok: true, status: 200, json: async () => response(request()) }
  }
  await testDecisions(input(), { apiKey: 'OFFLINE_TEST_KEY', fetchImpl })
  await testDecisions(input(), { apiKey: 'OFFLINE_TEST_KEY', fetchImpl })
  assert.equal(keys.length, 2)
  assert.notEqual(keys[0], keys[1])
})

test('missing credentials reject locally and transport failures never automatically retry', async () => {
  let calls = 0
  await assert.rejects(testDecisions(input(), { apiKey: '', fetchImpl: async () => { calls++; assert.fail('Missing key must not dispatch') } }), /API Key/)
  assert.equal(calls, 0)
  await assert.rejects(testDecisions(input(), { apiKey: 'OFFLINE_TEST_KEY', fetchImpl: async () => { calls++; throw new Error('lost response OFFLINE_TEST_KEY') } }), (error) => {
    assert.match(error.message, /可能已计费/)
    assert.ok(!error.message.includes('OFFLINE_TEST_KEY'))
    return true
  })
  assert.equal(calls, 1)
})

test('Public Host rejects removed private samples before transport or persistent changes', async (t) => {
  const f = hostFixture(t)
  const beforeState = await f.state(), beforeFiles = filesUnder(f.root)
  const result = await f.call('decisions-test', { sample: { id: 'sample001', question_key: 'q13' }, api_key: 'OFFLINE_SAMPLE_KEY' })
  assert.equal(result.code, 500)
  assert.match(result.body.error, /公开版不附带考试样本/)
  assert.deepEqual(await f.state(), beforeState)
  assert.deepEqual(filesUnder(f.root), beforeFiles)
  assert.equal(f.calls.length, 0)
  assert.deepEqual(f.operations, [])
})

test('Host custom trials use every explicit image and the temporary or environment key without saving settings', async (t) => {
  const f = hostFixture(t)
  const beforeState = await f.state(), beforeFiles = filesUnder(f.root)
  const body = { config: { ...config, stem_image: dataUrl(), reference_image: dataUrl() }, prompt: 'CUSTOM_OFFLINE_PROMPT', answer_images: [dataUrl(), dataUrl()], score_step: 0.5 }
  const result = hostOk(await f.call('accounts/default/decisions-test', body))
  assert.equal(result.test_only, true); assert.equal(result.submitted, false)
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer OFFLINE_ENV_KEY')
  assert.equal(f.calls[0].payload.images.length, 4)
  assert.match(f.calls[0].payload.state.instructions, /CUSTOM_OFFLINE_PROMPT/)
  assert.equal(Object.keys(f.calls[0].payload.questions.criterion_0.criteria).filter((key) => key.startsWith('s_')).length, 9)
  assert.deepEqual(await f.state(), beforeState)
  assert.deepEqual(filesUnder(f.root), beforeFiles)
  assert.deepEqual(f.operations, [])
  assert.ok(!JSON.stringify(result).includes('OFFLINE_ENV_KEY'))
})

test('Host rejects mixed sample/custom input and invalid samples before any billable request', async (t) => {
  const f = hostFixture(t)
  for (const body of [
    { sample: { id: 'sample001', question_key: 'q13' }, config },
    { sample: { id: 'sample001', question_key: 'q13' }, answer_images: [dataUrl()] },
    { sample: { id: '../sample001', question_key: 'q13' } },
    { sample: { id: 'sample999', question_key: 'q13' } },
    { sample: { id: 'sample001', question_key: '../q13' } },
    { config, answer_images: [] },
  ]) hostRejected(await f.call('decisions-test', body))
  assert.equal(f.calls.length, 0)
  assert.deepEqual(f.operations, [])
})

test('Host blocks concurrent duplicate trials for one account and releases the guard after completion', async (t) => {
  let slow
  const f = hostFixture(t, { fetch: async (_, init, payload) => {
    await slow.promise
    return { ok: true, status: 200, json: async () => response({ payload }) }
  } })
  slow = f.gate()
  const body = { config, answer_images: [dataUrl()], api_key: 'OFFLINE_DUPLICATE_KEY' }
  const first = f.call('decisions-test', body)
  try {
    await f.wait(() => f.calls.length === 1)
    hostRejected(await f.call('accounts/default/decisions-test', body))
    assert.equal(f.calls.length, 1)
    slow.resolve(); hostOk(await first)
    hostOk(await f.call('decisions-test', body))
    assert.equal(f.calls.length, 2)
  } finally { slow.resolve(); await first }
})

test('Host trial during automatic model scoring does not claim, submit or mutate the live task', async (t) => {
  let slow
  const f = hostFixture(t, { stream: async function* () {
    yield { type: 'text-delta', text: '{' }; await slow.promise
    yield { type: 'text-delta', text: '"criteria":[]}' }
  } })
  slow = f.gate()
  const selection = { exam: 1, subject: 2, question: 3 }
  hostOk(await f.call('login', { username: 'offline', password: 'OFFLINE_PASSWORD' }))
  hostOk(await f.call('model', { mode: 'harness', provider: 'offline-provider', model: 'active-vision' }))
  hostOk(await f.call('save-config', { ...selection, config }))
  const started = hostOk(await f.call('marking-auto-start', selection))
  await f.wait(async () => (await f.state()).autoMark?.stream?.text === '{')
  const beforeState = await f.state(), beforeFiles = filesUnder(f.root), beforeOperations = structuredClone(f.operations)
  assert.equal(beforeState.autoMark.inFlight, true)
  hostOk(await f.call('accounts/default/decisions-test', { config, answer_images: [dataUrl()], api_key: 'OFFLINE_ACTIVE_TEST_KEY' }))
  assert.deepEqual(await f.state(), beforeState)
  assert.deepEqual(f.operations, beforeOperations)
  assert.deepEqual(filesUnder(f.root), beforeFiles)
  assert.equal(f.calls.length, 1)
  assert.equal(f.operations.filter((operation) => operation.name === 'getQuestion').length, 1)
  assert.equal(f.operations.filter((operation) => operation.name === 'submitScore').length, 0)
  hostOk(await f.call('marking-auto-pause', { taskId: started.taskId }))
  slow.resolve()
  await f.wait(async () => !(await f.state()).autoMark.inFlight)
})

test('Host experiments share the model queue with live grading rather than bypassing its global limit', async (t) => {
  let slow, modelStarted = false
  const f = hostFixture(t, { config: { maxConcurrentModels: 1 }, stream: async function* () {
    modelStarted = true
    await slow.promise
    yield { type: 'text-delta', text: '{}' }
  } })
  slow = f.gate()
  const selection = { exam: 1, subject: 2, question: 3 }
  hostOk(await f.call('login', { username: 'offline', password: 'OFFLINE_PASSWORD' }))
  hostOk(await f.call('model', { mode: 'harness', provider: 'offline-provider', model: 'active-vision' }))
  hostOk(await f.call('save-config', { ...selection, config }))
  hostOk(await f.call('marking-auto-start', selection))
  await f.wait(() => modelStarted)
  const pending = f.call('decisions-test', { config, answer_images: [dataUrl()], api_key: 'OFFLINE_QUEUE_KEY' })
  try {
    for (let i = 0; i < 10; i++) await nextTick()
    assert.equal(f.calls.length, 0)
    const overview = hostOk(await f.call('accounts', {}, 'GET'))
    assert.equal(overview.scheduler.active, 1)
    assert.equal(overview.scheduler.queued, 1)
    hostOk(await f.call('marking-auto-pause'))
    slow.resolve()
    hostOk(await pending)
    assert.equal(f.calls.length, 1)
    assert.equal(f.operations.filter((operation) => operation.name === 'getQuestion').length, 1)
    assert.equal(f.operations.filter((operation) => operation.name === 'submitScore').length, 0)
  } finally { slow.resolve(); await pending }
})

test('a failed Host experiment releases its busy guard and does not retry before a new explicit trial', async (t) => {
  let attempts = 0
  const f = hostFixture(t, { fetch: async (_, init, payload) => {
    attempts++
    if (attempts === 1) throw new Error('offline response lost')
    return { ok: true, status: 200, json: async () => response({ payload }) }
  } })
  const beforeState = await f.state(), beforeFiles = filesUnder(f.root)
  const body = { config, answer_images: [dataUrl()], api_key: 'OFFLINE_RETRY_GUARD_KEY' }
  hostRejected(await f.call('decisions-test', body))
  assert.equal(attempts, 1)
  assert.deepEqual(await f.state(), beforeState)
  hostOk(await f.call('decisions-test', body))
  assert.equal(attempts, 2)
  assert.deepEqual(filesUnder(f.root), beforeFiles)
  assert.deepEqual(f.operations, [])
})

test('Host disposal aborts an in-flight Decisions trial without persisting a result or key', async (t) => {
  const f = hostFixture(t, { fetch: async (_, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('offline dispose abort')), { once: true })
  }) })
  const pending = f.call('decisions-test', { config, answer_images: [dataUrl()], api_key: 'OFFLINE_DISPOSE_KEY' })
  await f.wait(() => f.calls.length === 1)
  f.dispose()
  const beforeFiles = filesUnder(f.root)
  hostRejected(await pending)
  assert.equal(f.calls[0].init.signal.aborted, true)
  assert.deepEqual(filesUnder(f.root), beforeFiles)
  assert.deepEqual(f.operations, [])
})

test('Host trial body can exceed the ordinary 8MiB limit while image and 14MiB experiment budgets remain enforced', async (t) => {
  const f = hostFixture(t)
  const large = dataUrl(sizedPng(3 * 1024 * 1024))
  const body = { config, answer_images: [large, large], api_key: 'OFFLINE_LARGE_BODY_KEY' }
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 8 * 1024 * 1024)
  hostOk(await f.call('decisions-test', body))
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].payload.images.length, 2)
  assert.ok(Buffer.byteLength(f.calls[0].init.body) < 13 * 1024 * 1024)
  const oversized = { config, answer_images: [dataUrl()], padding: 'x'.repeat(14 * 1024 * 1024) }
  hostRejected(await f.call('decisions-test', oversized))
  assert.equal(f.calls.length, 1)
})

for (const variant of ['http', 'invalid-json', 'api-error']) {
  test(`transport ${variant} reports failure once and omits reflected credentials or image data`, async () => {
    let calls = 0
    await assert.rejects(testDecisions(input(), { apiKey: 'OFFLINE_TEST_KEY', fetchImpl: async () => {
      calls++
      return { ok: variant !== 'http', status: variant === 'http' ? 429 : 200, json: async () => {
        if (variant === 'invalid-json') throw new Error('broken')
        return { code: 429, message: 'OFFLINE_TEST_KEY ' + dataUrl() }
      } }
    } }), (error) => {
      assert.ok(!error.message.includes('OFFLINE_TEST_KEY'))
      assert.ok(!error.message.includes('data:image'))
      assert.match(error.message, /不会自动重试/)
      return true
    })
    assert.equal(calls, 1)
  })
}
