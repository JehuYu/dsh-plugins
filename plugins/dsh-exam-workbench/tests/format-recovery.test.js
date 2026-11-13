import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { extractJson } from '../json-output.js'
import { withFormatRecovery } from '../format-recovery.js'
import { apply } from '../grading-host.js'
import { ReadonlyClient } from '../ameqp.js'

const selection = { exam: 1, subject: 2, question: 3 }
const config = { question: 'OFFLINE_RECOVERY_QUESTION', question_prompt: 'OFFLINE_RECOVERY_RULE', grading_method: 'rubric', max_score: 8,
  criteria: [{ id: 'sketch', description: 'Sketch', max_score: 4 }, { id: 'dimensions', description: 'Dimensions', max_score: 4 }] }
const evidence = '标注"60mm"可见'
const prediction = { criteria: [{ id: 'sketch', score: 4, image_evidence: evidence }, { id: 'dimensions', score: 2.5, image_evidence: '尺寸部分缺失' }] }
const good = JSON.stringify(prediction)
// An actual JSON syntax error: the quote marks inside the evidence are unescaped.
const bad = '{"criteria":[{"id":"sketch","score":4,"image_evidence":"标注"60mm"可见"},{"id":"dimensions","score":2.5,"image_evidence":"尺寸部分缺失"}]}'
// Synthetic one-pixel PNG: independent of removed private samples.
const image = { bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB3sAAAAASUVORK5CYII=', 'base64'), mediaType: 'image/png' }
const imageUrl = 'data:image/png;base64,' + image.bytes.toString('base64')
const tick = () => new Promise((resolve) => setImmediate(resolve))
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
function ok(reply) { assert.equal(reply.code, 200, JSON.stringify(reply.body)); return reply.body }
function fault(code, text = bad) { return Object.assign(new Error('offline model error'), { code, modelOutput: text }) }

for (const [label, raw, expected, validate] of [
  ['unescaped evidence quotes', bad, 'MODEL_JSON_SYNTAX'],
  ['missing JSON', 'The score is seven.', 'MODEL_JSON_SYNTAX'],
  ['conflicting complete objects', good + '\n' + JSON.stringify({ ...prediction, criteria: [] }), 'MODEL_JSON_CONFLICT'],
  ['validated object with illegal scores', good, 'MODEL_JSON_VALIDATION', () => { throw new Error('illegal score') }],
  ['output limit', 'x'.repeat(1_000_001), 'MODEL_JSON_LIMIT'],
]) {
  test(`extractJson classifies ${label} and retains the unrepaired model text`, () => {
    assert.throws(() => extractJson(raw, { validate }), (error) => {
      assert.equal(error.code, expected)
      assert.equal(error.modelOutput, raw.slice(0, 1_000_000))
      return true
    })
  })
}

test('format recovery retries a syntax error once with only a format instruction and reports success', async () => {
  const calls = [], retries = [], recovered = []
  const result = await withFormatRecovery(async (args) => {
    calls.push(args)
    if (args.attempt === 0) throw fault('MODEL_JSON_SYNTAX')
    return { score: 7, criteria: structuredClone(prediction.criteria) }
  }, { onRetry: (...args) => retries.push(args), onRecovered: (...args) => recovered.push(args) })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].attempt, 0); assert.equal(calls[0].formatInstruction, '')
  assert.equal(calls[1].attempt, 1); assert.equal(typeof calls[1].formatInstruction, 'string')
  assert.ok(calls[1].formatInstruction.trim())
  assert.match(calls[1].formatInstruction, /JSON|json/)
  assert.equal(retries.length, 1); assert.equal(recovered.length, 1)
  assert.equal(result.formatRetries, 1)
  assert.equal(result.score, 7)
  assert.deepEqual(result.criteria, prediction.criteria)
})

test('a valid first output runs once and receives formatRetries zero', async () => {
  let calls = 0
  const result = await withFormatRecovery(async () => { calls++; return { score: 0 } })
  assert.equal(calls, 1); assert.equal(result.formatRetries, 0)
})

test('a second failure is thrown unchanged with retry count one and cannot trigger a third call', async () => {
  let calls = 0
  const second = fault('MODEL_JSON_SYNTAX', 'still broken')
  await assert.rejects(withFormatRecovery(async () => { calls++; throw calls === 1 ? fault('MODEL_JSON_SYNTAX') : second }), (error) => {
    assert.equal(error, second)
    assert.equal(error.modelOutput, 'still broken')
    assert.equal(error.formatRetries, 1)
    return true
  })
  assert.equal(calls, 2)
})

for (const code of ['MODEL_JSON_CONFLICT', 'MODEL_JSON_VALIDATION', 'MODEL_JSON_LIMIT', 'ETIMEDOUT', 'ECONNRESET', undefined]) {
  test(`format recovery never retries non-syntax error ${String(code)}`, async () => {
    const error = fault(code)
    let calls = 0
    await assert.rejects(withFormatRecovery(async () => { calls++; throw error }), (actual) => actual === error)
    assert.equal(calls, 1)
  })
}

test('empty model text cannot cause a billable recovery request', async () => {
  let calls = 0
  await assert.rejects(withFormatRecovery(async () => { calls++; throw fault('MODEL_JSON_SYNTAX', '') }))
  assert.equal(calls, 1)
})

test('aborting while the first result fails prevents the format retry', async () => {
  let calls = 0
  const controller = new AbortController()
  await assert.rejects(withFormatRecovery(async () => {
    calls++; controller.abort(); throw fault('MODEL_JSON_SYNTAX')
  }, { signal: controller.signal }))
  assert.equal(calls, 1)
})

test('an abort raised by onRetry cancels recovery before a second model dispatch', async () => {
  const controller = new AbortController()
  let calls = 0
  await assert.rejects(withFormatRecovery(async () => { calls++; throw fault('MODEL_JSON_SYNTAX') }, {
    signal: controller.signal, onRetry: () => controller.abort(),
  }))
  assert.equal(calls, 1)
})

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ameqp-format-recovery-test-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const calls = [], claims = [], writes = [], imageReads = [], attachments = [], external = [], gates = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (options.mode !== 'api' || url !== 'https://models.invalid/v1/chat/completions') {
      external.push(String(url)); throw new Error('Unexpected network request forbidden in offline recovery tests')
    }
    const request = JSON.parse(init.body)
    calls.push(request)
    if (options.api) return options.api(calls.length, request, init)
    const raw = options.outputs?.[calls.length - 1] ?? (calls.length === 1 ? bad : good)
    return new Response(JSON.stringify({ choices: [{ message: { content: raw }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } })
  })
  t.mock.method(ReadonlyClient.prototype, 'login', async () => {})
  t.mock.method(ReadonlyClient.prototype, 'logout', async () => {})
  t.mock.method(ReadonlyClient.prototype, 'listExams', async () => [])
  t.mock.method(ReadonlyClient.prototype, 'keepAlive', async () => ({}))
  t.mock.method(ReadonlyClient.prototype, 'getSessionId', async () => ({ SessionId: 'offline-session', teaSN: 99 }))
  t.mock.method(ReadonlyClient.prototype, 'getQuestion', async (...args) => {
    claims.push(args)
    return { ansQueSN: 101, ansStuSN: 202, ansQueMarkState: 'A' }
  })
  t.mock.method(ReadonlyClient.prototype, 'claimCropImages', async (...args) => { imageReads.push(args); return [image] })
  t.mock.method(ReadonlyClient.prototype, 'submitScore', async (...args) => {
    writes.push(args)
    if (options.submit) return options.submit(...args)
    return {}
  })
  t.mock.method(ReadonlyClient.prototype, 'cancelQuestion', async () => { assert.fail('Recovery must not cancel a held paper') })
  t.mock.method(ReadonlyClient.prototype, 'listStudents', async () => [{ ansStuSN: 202 }])
  t.mock.method(ReadonlyClient.prototype, 'studentMeta', async () => ({ stuSN: 303 }))
  t.mock.method(ReadonlyClient.prototype, 'questionCropImages', async (...args) => { imageReads.push(args); return [image] })
  const llm = { resolveModelInfo: async () => ({}), stream: async function* (request) {
    calls.push(request)
    if (options.stream) yield* options.stream(calls.length, request)
    else yield { type: 'text-delta', text: options.outputs?.[calls.length - 1] ?? (calls.length === 1 ? bad : good) }
  } }
  const services = { llm, attachments: { saveImage: async ({ data, mediaType, name }) => {
    const value = { bytes: Buffer.from(data).toString('base64'), mediaType, name }
    attachments.push(value)
    return { id: name + ':' + value.bytes }
  } } }
  let handler
  const runtime = apply({ get: (name) => services[name], inject: (_, callback) => callback({ effect: (fn) => fn(),
    webServer: { register: (route) => { handler = route.handler; return () => {} } },
  }) }, { ameqpBase: 'https://exam.invalid/AMEQP/', productionMarking: true, autoMaxPapers: 1 })
  async function call(route, body = {}, method = 'POST') {
    const req = new PassThrough(); req.url = '/ameqp-grading/api/' + route; req.method = method
    let output
    const res = { statusCode: 200, setHeader() {}, end(value) { output = value } }
    const pending = handler(req, res); req.end(JSON.stringify(body)); await pending
    return { code: res.statusCode, body: JSON.parse(String(output)) }
  }
  const state = async () => ok(await call('state', {}, 'GET'))
  async function wait(predicate) {
    let current
    for (let i = 0; i < 200; i++) { await tick(); current = await state(); if (predicate(current)) return current }
    assert.fail('Recovery fixture did not reach expected state: ' + JSON.stringify(current))
  }
  async function prepare() {
    ok(await call('login', { username: 'offline', password: 'OFFLINE_PASSWORD' }))
    ok(await call('model', options.mode === 'api'
      ? { mode: 'api', base_url: 'https://models.invalid/v1', model: 'offline-vision', api_key: 'OFFLINE_MODEL_KEY' }
      : { mode: 'harness', provider: 'offline-provider', model: 'offline-vision' }))
    ok(await call('save-prompt', { prompt: 'OFFLINE_FIXED_GLOBAL_PROMPT' }))
    ok(await call('save-config', { ...selection, config: { ...config, stem_image: imageUrl, reference_image: imageUrl } }))
  }
  t.after(async () => {
    runtime.dispose()
    for (const gate of gates) gate.resolve()
    for (let i = 0; i < 30; i++) await tick()
    try { assert.deepEqual(external, [], 'No non-mocked network request is allowed') }
    finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
      assert.ok(path.basename(root).startsWith('ameqp-format-recovery-test-'))
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
  return { root, calls, claims, writes, imageReads, attachments, call, state, wait, prepare,
    gate() { const gate = deferred(); gates.push(gate); return gate } }
}
function assertSameInputs(f, mode) {
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[0].model, 'offline-vision'); assert.equal(f.calls[1].model, 'offline-vision')
  if (mode === 'harness') assert.equal(f.calls[1].provider, f.calls[0].provider)
  const content = (request) => request.messages.find((m) => m.role === 'user').content
  const initial = content(f.calls[0]), retried = content(f.calls[1])
  assert.deepEqual(retried.filter((part) => part.type === 'image' || part.type === 'image_url'), initial.filter((part) => part.type === 'image' || part.type === 'image_url'))
  assert.equal(retried[0].text, initial[0].text)
  for (const request of f.calls) assert.match(JSON.stringify(request), /OFFLINE_FIXED_GLOBAL_PROMPT/)
  assert.equal(f.imageReads.length, 1)
}

for (const mode of ['harness', 'api']) {
  test(`${mode}: unescaped evidence triggers one format retry on the same paper and submits once`, async (t) => {
    const f = fixture(t, { mode }); await f.prepare()
    ok(await f.call('marking-auto-start', selection))
    const done = await f.wait((s) => s.autoMark?.pauseReason === 'batch_limit' && !s.autoMark.inFlight)
    assertSameInputs(f, mode)
    assert.equal(f.claims.length, 1); assert.equal(f.writes.length, 1)
    assert.equal(f.writes[0][4].ansQueSN, 101)
    assert.equal(f.writes[0][4].marQueMarkValue, 7)
    assert.equal(done.autoMark.formatRetries, 1)
    assert.equal(done.autoMark.totalFormatRetries, 1)
    assert.equal(done.autoMark.stream.text, good)
    assert.equal(done.autoMark.current.criteria[0].image_evidence, evidence)
    const recovery = JSON.parse(fs.readFileSync(path.join(f.root, 'ameqp-grading', 'last-format-recovery.json'), 'utf8'))
    const failure = JSON.parse(fs.readFileSync(path.join(f.root, 'ameqp-grading', 'last-model-error.json'), 'utf8'))
    assert.equal(recovery.paper_id, 101)
    assert.equal(recovery.taskId, done.taskId)
    assert.equal(recovery.code, 'MODEL_JSON_SYNTAX')
    assert.equal(recovery.recoveryStatus, 'recovered')
    assert.equal(recovery.formatRetries, 1)
    assert.equal(failure.text, bad)
    assert.equal(failure.taskId, done.taskId)
    assert.equal(failure.recoveryStatus, 'recovered')
  })

  test(`${mode}: two malformed outputs pause the original claim after exactly two model calls`, async (t) => {
    const f = fixture(t, { mode, outputs: [bad, bad] }); await f.prepare()
    ok(await f.call('marking-auto-start', selection))
    const paused = await f.wait((s) => s.autoMark?.status === 'paused' && !s.autoMark.inFlight)
    assertSameInputs(f, mode)
    assert.equal(f.claims.length, 1); assert.equal(f.writes.length, 0)
    assert.equal(paused.autoMark.current.ansQueSN, 101)
    assert.equal(paused.autoMark.formatRetries, 1)
    assert.equal(paused.autoMark.totalFormatRetries, 1)
    assert.equal(paused.autoMark.stream.text, bad)
    assert.equal(paused.autoMark.lastError.code, 'MODEL_JSON_SYNTAX')
    assert.equal(paused.autoMark.lastError.formatRetries, 1)
    const failure = JSON.parse(fs.readFileSync(path.join(f.root, 'ameqp-grading', 'last-model-error.json'), 'utf8'))
    assert.equal(failure.text, bad)
    assert.equal(failure.taskId, paused.taskId)
    assert.equal(failure.recoveryStatus, 'paused')
  })

  test(`${mode}: a syntactically valid retry with an illegal score still pauses without a third request`, async (t) => {
    const invalid = JSON.stringify({ criteria: [{ id: 'sketch', score: 99 }, { id: 'dimensions', score: 2.5 }] })
    const f = fixture(t, { mode, outputs: [bad, invalid] }); await f.prepare()
    ok(await f.call('marking-auto-start', selection))
    const paused = await f.wait((s) => s.autoMark?.status === 'paused' && !s.autoMark.inFlight)
    assert.equal(f.calls.length, 2); assert.equal(f.claims.length, 1); assert.equal(f.writes.length, 0)
    assert.equal(paused.autoMark.current.ansQueSN, 101)
    assert.equal(paused.autoMark.lastError.code, 'MODEL_JSON_VALIDATION')
    assert.equal(paused.autoMark.lastError.formatRetries, 1)
    assert.equal(paused.autoMark.stream.text, invalid)
  })

  for (const [name, raw] of [
    ['valid JSON with illegal score', JSON.stringify({ criteria: [{ id: 'sketch', score: '4' }, { id: 'dimensions', score: 2.5 }] })],
    ['conflicting valid JSON', good + '\n' + JSON.stringify({ criteria: [{ id: 'sketch', score: 1 }, { id: 'dimensions', score: 1 }] })],
  ]) {
    test(`${mode}: ${name} never triggers format retry or submission`, async (t) => {
      const f = fixture(t, { mode, outputs: [raw] }); await f.prepare()
      ok(await f.call('marking-auto-start', selection))
      const paused = await f.wait((s) => s.autoMark?.status === 'paused' && !s.autoMark.inFlight)
      assert.equal(f.calls.length, 1); assert.equal(f.claims.length, 1); assert.equal(f.writes.length, 0)
      assert.equal(paused.autoMark.current.ansQueSN, 101)
      assert.equal(paused.autoMark.formatRetries || 0, 0)
    })
  }
}

for (const name of ['timeout', 'network error', 'interrupted stream']) {
  test(`harness ${name} never triggers format recovery`, async (t) => {
    const f = fixture(t, { stream: async function* () {
      if (name === 'interrupted stream') { yield { type: 'text-delta', text: bad }; yield { type: 'finish', reason: { kind: 'length' } }; return }
      throw Object.assign(new Error('offline ' + name), { code: name === 'timeout' ? 'ETIMEDOUT' : 'ECONNRESET' })
    } }); await f.prepare()
    ok(await f.call('marking-auto-start', selection))
    await f.wait((s) => s.autoMark?.status === 'paused' && !s.autoMark.inFlight)
    assert.equal(f.calls.length, 1); assert.equal(f.claims.length, 1); assert.equal(f.writes.length, 0)
  })
}

for (const failure of ['timeout', 'network', 'http', 'stream']) {
  test(`api ${failure} failure never triggers a format retry`, async (t) => {
    const f = fixture(t, { mode: 'api', api: async () => {
      if (failure === 'http') return new Response('offline upstream failure', { status: 503 })
      if (failure === 'stream') return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: bad } }] }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } })
      throw Object.assign(new Error('offline API ' + failure), { code: failure === 'timeout' ? 'ETIMEDOUT' : 'ECONNRESET' })
    } }); await f.prepare()
    ok(await f.call('marking-auto-start', selection))
    const paused = await f.wait((s) => s.autoMark?.status === 'paused' && !s.autoMark.inFlight)
    assert.equal(f.calls.length, 1); assert.equal(f.claims.length, 1); assert.equal(f.writes.length, 0)
    assert.equal(paused.autoMark.current.ansQueSN, 101)
    assert.equal(paused.autoMark.formatRetries || 0, 0)
  })
}

for (const mode of ['harness', 'api']) {
  test(`${mode}: a pause during format retry clears the first output and prevents submit or another claim`, async (t) => {
    let slow
    const f = fixture(t, { mode, stream: async function* (attempt) {
      if (attempt === 1) { yield { type: 'text-delta', text: bad }; return }
      yield { type: 'text-delta', text: good.slice(0, 20) }; await slow.promise
      yield { type: 'text-delta', text: good.slice(20) }
    }, api: async (attempt) => {
      if (attempt === 1) return new Response(JSON.stringify({ choices: [{ message: { content: bad }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } })
      const encoder = new TextEncoder()
      const event = (text) => encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n')
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(event(good.slice(0, 20)))
        slow.promise.then(() => { controller.enqueue(event(good.slice(20))); controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close() })
      } }), { headers: { 'content-type': 'text/event-stream' } })
    } }); slow = f.gate(); await f.prepare()
    const started = ok(await f.call('marking-auto-start', selection))
    const live = await f.wait((s) => f.calls.length === 2 && s.autoMark?.stream?.text === good.slice(0, 20))
    assert.match(live.autoMark.phase, /格式|重试|恢复/)
    assert.ok(!live.autoMark.stream.text.includes('60mm'))
    ok(await f.call('accounts/default/marking-auto-pause', { taskId: started.taskId }))
    slow.resolve()
    const paused = await f.wait((s) => !s.autoMark.inFlight)
    assert.equal(paused.autoMark.status, 'paused')
    assert.equal(paused.autoMark.current.ansQueSN, 101)
    assert.equal(f.calls.length, 2); assert.equal(f.claims.length, 1); assert.equal(f.writes.length, 0)
    const diagnostic = JSON.parse(fs.readFileSync(path.join(f.root, 'ameqp-grading', 'last-model-error.json'), 'utf8'))
    assert.equal(diagnostic.recoveryStatus, 'interrupted')
    assert.equal(diagnostic.taskId, started.taskId)
    assert.equal(diagnostic.paper_id, 101)
    assert.equal(diagnostic.text, bad)
  })
}

for (const mode of ['harness', 'api']) {
  test(`${mode}: explicit resume after a paused retry still scores the original claim without refetching its images`, async (t) => {
    let slow
    const f = fixture(t, { mode, stream: async function* (attempt) {
      if (attempt === 1) { yield { type: 'text-delta', text: bad }; return }
      if (attempt === 2) { yield { type: 'text-delta', text: good.slice(0, 20) }; await slow.promise; yield { type: 'text-delta', text: good.slice(20) }; return }
      yield { type: 'text-delta', text: good }
    }, api: async (attempt, request, init) => {
      if (attempt === 2) await slow.promise
      const raw = attempt === 1 ? bad : good
      return new Response(JSON.stringify({ choices: [{ message: { content: raw }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } })
    } }); slow = f.gate(); await f.prepare()
    const started = ok(await f.call('marking-auto-start', selection))
    await f.wait(() => f.calls.length === 2)
    ok(await f.call('accounts/default/marking-auto-pause', { taskId: started.taskId }))
    slow.resolve()
    await f.wait((s) => !s.autoMark.inFlight)
    assert.equal(f.writes.length, 0)
    const diagnosticFile = path.join(f.root, 'ameqp-grading', 'last-model-error.json')
    const interrupted = JSON.parse(fs.readFileSync(diagnosticFile, 'utf8'))
    assert.equal(interrupted.recoveryStatus, 'interrupted')
    assert.equal(interrupted.taskId, started.taskId)
    assert.equal(interrupted.paper_id, 101)
    assert.equal(interrupted.text, bad)
    ok(await f.call('accounts/default/marking-auto-resume', { taskId: started.taskId }))
    const done = await f.wait((s) => s.autoMark?.pauseReason === 'batch_limit' && !s.autoMark.inFlight)
    assert.equal(f.calls.length, 3, 'The third request is allowed only after the explicit resume')
    assert.equal(f.claims.length, 1); assert.equal(f.imageReads.length, 1); assert.equal(f.writes.length, 1)
    assert.equal(done.taskId, started.taskId)
    assert.equal(f.writes[0][4].ansQueSN, 101)
    assert.equal(f.writes[0][4].marQueMarkValue, 7)
    assert.equal(done.autoMark.totalFormatRetries, 1)
    const userContent = (request) => request.messages.find((message) => message.role === 'user').content
    assert.deepEqual(userContent(f.calls[2]), userContent(f.calls[0]))
    assert.equal(f.calls[2].model, f.calls[0].model)
    assert.deepEqual(JSON.parse(fs.readFileSync(diagnosticFile, 'utf8')), interrupted, 'A later explicit resume must retain the accurate interrupted retry history')
  })
}

test('network failure on the second model attempt settles the original syntax diagnostic as paused', async (t) => {
  const f = fixture(t, { stream: async function* (attempt) {
    if (attempt === 1) { yield { type: 'text-delta', text: bad }; return }
    throw Object.assign(new Error('offline second-attempt network failure'), { code: 'ECONNRESET' })
  } }); await f.prepare()
  const started = ok(await f.call('marking-auto-start', selection))
  await f.wait((s) => s.autoMark?.status === 'paused' && !s.autoMark.inFlight)
  const diagnostic = JSON.parse(fs.readFileSync(path.join(f.root, 'ameqp-grading', 'last-model-error.json'), 'utf8'))
  assert.equal(diagnostic.recoveryStatus, 'paused')
  assert.equal(diagnostic.recoveryFailureCode, 'ECONNRESET')
  assert.equal(diagnostic.text, bad)
  assert.equal(diagnostic.taskId, started.taskId)
  assert.equal(diagnostic.paper_id, 101)
  assert.equal(f.calls.length, 2); assert.equal(f.claims.length, 1); assert.equal(f.writes.length, 0)
})

test('stopping a readonly format retry settles its anonymous paper diagnostic as interrupted', async (t) => {
  let slow
  const f = fixture(t, { stream: async function* (attempt) {
    if (attempt === 1) { yield { type: 'text-delta', text: bad }; return }
    yield { type: 'text-delta', text: good.slice(0, 20) }; await slow.promise
    yield { type: 'text-delta', text: good.slice(20) }
  } }); slow = f.gate(); await f.prepare()
  const started = ok(await f.call('start', { ...selection, limit: 1 }))
  await f.wait((s) => f.calls.length === 2 && s.job?.stream?.text === good.slice(0, 20))
  ok(await f.call('stop'))
  slow.resolve()
  await f.wait((s) => s.job?.status === 'stopped')
  const diagnostic = JSON.parse(fs.readFileSync(path.join(f.root, 'ameqp-grading', 'last-model-error.json'), 'utf8'))
  assert.equal(diagnostic.recoveryStatus, 'interrupted')
  assert.equal(diagnostic.taskId, started.taskId)
  assert.equal(diagnostic.paper_id, 'paper00001')
  assert.equal(diagnostic.text, bad)
  assert.equal(f.calls.length, 2); assert.equal(f.claims.length, 0); assert.equal(f.writes.length, 0)
})

for (const existing of ['recovered', 'another-paper']) {
  test(`settling an interrupted retry does not overwrite a ${existing} diagnostic`, async (t) => {
    let slow
    const f = fixture(t, { stream: async function* (attempt) {
      if (attempt === 1) { yield { type: 'text-delta', text: bad }; return }
      yield { type: 'text-delta', text: good.slice(0, 20) }; await slow.promise
      yield { type: 'text-delta', text: good.slice(20) }
    } }); slow = f.gate(); await f.prepare()
    const started = ok(await f.call('marking-auto-start', selection))
    await f.wait((s) => f.calls.length === 2 && s.autoMark?.stream?.text === good.slice(0, 20))
    const diagnosticFile = path.join(f.root, 'ameqp-grading', 'last-model-error.json')
    const previous = JSON.parse(fs.readFileSync(diagnosticFile, 'utf8'))
    const preserved = { ...previous, paper_id: existing === 'another-paper' ? 999 : 101, recoveryStatus: existing === 'recovered' ? 'recovered' : 'retrying' }
    fs.writeFileSync(diagnosticFile, JSON.stringify(preserved))
    ok(await f.call('accounts/default/marking-auto-pause', { taskId: started.taskId }))
    slow.resolve()
    await f.wait((s) => !s.autoMark.inFlight)
    assert.deepEqual(JSON.parse(fs.readFileSync(diagnosticFile, 'utf8')), preserved)
    assert.equal(f.writes.length, 0); assert.equal(f.claims.length, 1)
  })
}

test('diagnostic filesystem failures cannot invalidate a recovered score or cause extra submissions', async (t) => {
  const f = fixture(t); await f.prepare()
  const rename = fs.renameSync
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (String(to).endsWith('last-model-error.json') || String(to).endsWith('last-format-recovery.json')) throw new Error('offline diagnostic disk failure')
    return rename(from, to)
  })
  ok(await f.call('marking-auto-start', selection))
  const done = await f.wait((s) => s.autoMark?.pauseReason === 'batch_limit' && !s.autoMark.inFlight)
  assert.equal(done.autoMark.submitted, 1)
  assert.equal(f.calls.length, 2); assert.equal(f.claims.length, 1); assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0][4].marQueMarkValue, 7)
})

for (const mode of ['harness', 'api']) test(`${mode}: successful format recovery followed by uncertain submit never retries the submit or claims again`, async (t) => {
  const f = fixture(t, { mode, submit: async () => { throw new Error('offline submit response lost') } }); await f.prepare()
  const started = ok(await f.call('marking-auto-start', selection))
  await f.wait((s) => s.autoMark?.submissionUncertain && !s.autoMark.inFlight)
  assert.equal(f.calls.length, 2); assert.equal(f.writes.length, 1); assert.equal(f.claims.length, 1)
  assert.ok((await f.call('accounts/default/marking-auto-resume', { taskId: started.taskId })).code >= 400)
  assert.ok((await f.call('accounts/default/marking-submit', { ...selection, taskId: started.taskId, ansQueSN: 101, value: 7 })).code >= 400)
  assert.equal(f.calls.length, 2); assert.equal(f.writes.length, 1); assert.equal(f.claims.length, 1)
})

for (const mode of ['harness', 'api']) {
  test(`${mode}: readonly batch recovers syntax for the same anonymous paper without a marking operation`, async (t) => {
    const f = fixture(t, { mode }); await f.prepare()
    ok(await f.call('start', { ...selection, limit: 1 }))
    const done = await f.wait((s) => s.job?.status === 'completed')
    assertSameInputs(f, mode)
    assert.equal(done.job.scored, 1)
    assert.equal(done.job.results[0].score, 7)
    assert.equal(done.job.results[0].formatRetries, 1)
    assert.equal(done.job.totalFormatRetries, 1)
    assert.equal(done.job.stream.text, good)
    assert.equal(f.claims.length, 0); assert.equal(f.writes.length, 0)
  })
}
