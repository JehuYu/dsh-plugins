import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

const source = fs.readFileSync(new URL('../grading-client.js', import.meta.url), 'utf8')
const basicState = { connected: false, defaultBase: 'http://exam.invalid/', exams: [], subjects: [], questions: [], model: null }
const question = { exam: 505, subject: 2261, question_id: 1, title: '测试草图题', max_score: 8, question: '设计一个可折叠的晾衣架', question_prompt: '按原有标准评分', criteria: [{ id: 'sketch', max_score: 8, description: '结构与尺寸' }] }

function fixture(t, fetchImpl, options = {}) {
  const calls = [], accountProbes = [], registrations = [], events = new Map()
  let plugin, renderer
  const storage = (initial = {}) => {
    const items = new Map(Object.entries(initial))
    return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: (key) => items.delete(key) }
  }
  const context = {
    console: { ...console, error() {} }, URL, AbortController,
    setTimeout, clearTimeout,
    localStorage: storage(), sessionStorage: storage(options.session),
    document: { baseURI: options.baseURI || 'http://127.0.0.1:8041/', body: { addEventListener() {}, removeEventListener() {} } },
    fetch: async (url, init = {}) => {
      // Existing fixtures represent the legacy Host, whose account directory is absent.
      if (url.endsWith('/accounts') && !init.method) { accountProbes.push(url); return response({}, 404) }
      calls.push({ url, method: init.method || 'GET', body: init.body })
      return fetchImpl(url, init, calls)
    },
    window: {
      addEventListener: (name, fn) => events.set(name, fn), removeEventListener: (name) => events.delete(name),
      __ModuleLoader__: { load({ factory }) { plugin = factory((name) => { assert.equal(name, 'react'); return React }) } },
    },
  }
  vm.runInNewContext(source, context)
  const main = new Map()
  plugin.apply({ slots: {
    inject(name, fn) { fn() },
    register(entry, render) {
      registrations.push(entry)
      if (entry.name === 'main') main.set(entry.key, render)
      if (entry.name === 'sidebar.panellist') assert.ok(main.has(entry.id), 'Destination must exist when navigation appears')
      return () => {}
    },
  } })
  t.after(async () => { if (renderer) await act(async () => renderer.unmount()) })
  return {
    calls, accountProbes, registrations, events, plugin,
    async mount() { await act(async () => { renderer = TestRenderer.create(main.get('ameqp-grading')()) }) },
    get tree() { return renderer },
    text() { return JSON.stringify(renderer.toJSON()) },
    button(label) { return renderer.root.findAllByType('button').find((b) => b.children.join('') === label) },
  }
}
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

test('the main panel is registered before its sidebar entry', (t) => {
  const f = fixture(t, async () => assert.fail('Registration must not make requests'))
  assert.equal(f.registrations[0].name, 'main')
  assert.equal(f.plugin.isPlugin, true)
})

test('initial backend failure can recover automatically with readonly state requests', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture(t, async (_url, _init, calls) => calls.length === 1 ? response({}, 503) : response(basicState))
  await f.mount()
  assert.match(f.text(), /无法连接后端/)
  assert.ok(f.button('重新连接'))
  await act(async () => t.mock.timers.tick(3000))
  assert.match(f.text(), /阅卷地址/)
  assert.ok(!f.text().includes('无法连接后端'))
  assert.equal(f.calls.length, 2)
  assert.ok(f.calls.every((c) => c.method === 'GET' && c.url.endsWith('/state')))
})

test('nested document paths fall back to the root API after a readonly probe', async (t) => {
  const f = fixture(t, async (url) => url.includes('/sessions/') ? response({}, 404) : response(basicState), { baseURI: 'http://127.0.0.1:8041/sessions/current/' })
  await f.mount()
  assert.equal(f.calls[0].url, 'http://127.0.0.1:8041/sessions/current/ameqp-grading/api/state')
  assert.equal(f.calls[1].url, 'http://127.0.0.1:8041/ameqp-grading/api/state')
  assert.match(f.text(), /阅卷地址/)
})

test('a hanging state request times out into a visible retry action', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture(t, async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error) })
  }))
  await f.mount()
  await act(async () => t.mock.timers.tick(8000))
  assert.match(f.text(), /状态读取超时/)
  assert.ok(f.button('重新连接'))
})

test('a rejected AI start stays visible beside the workbench instead of disappearing after polling', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const state = { ...basicState, connected: true, username: 'offline', productionMarking: true, exam: '505', subject: '2261', questions: [{ id: 1, name: '测试题目', max_score: 8 }], model: { mode: 'harness', model: 'mock' } }
  const f = fixture(t, async (url) => url.endsWith('/state') ? response(state) : response({ error: '阅卷会话已过期' }, 500), { session: { 'ameqp-grading-selectedQuestion': '1' } })
  await f.mount()
  await act(async () => f.button('启动 AI 逐份阅卷').props.onClick())
  await act(async () => t.mock.timers.tick(10000))
  assert.match(f.text(), /AI 阅卷未启动：阅卷会话已过期/)
  assert.equal(f.calls.filter((c) => c.url.endsWith('/marking-auto-start')).length, 1)
})

test('paused failures stay visible even before a paper or stream output exists', async (t) => {
  const state = { ...basicState, connected: true, productionMarking: true, autoMark: { status: 'paused', inFlight: false, current: null, phase: '领卷失败：会话已过期', stream: { text: '', chars: 0, status: 'error' } } }
  const f = fixture(t, async () => response(state))
  await f.mount()
  assert.match(f.text(), /领卷失败：会话已过期/)
  assert.ok(f.button('继续 AI 阅卷'))
  assert.equal(f.tree.root.findAll((node) => node.props.className === 'ag-paper-img').length, 0)
  assert.ok(f.calls.every((c) => c.method === 'GET'))
})

test('AI start projects the returned claimed answer image immediately', async (t) => {
  const state = { ...basicState, connected: true, username: 'offline', productionMarking: true, exam: '505', subject: '2261', questions: [{ id: 1, name: '测试题目', max_score: 8 }], model: { mode: 'harness', model: 'mock' } }
  const active = { ...state, autoMark: { status: 'paused', inFlight: false, current: { ansQueSN: 101, images: ['/ameqp-grading/api/marking-image?ans=101'], submitted: false }, phase: '图片已就绪，模拟暂停', stream: { text: '', chars: 0, status: 'waiting' } } }
  let started = false
  const f = fixture(t, async (url) => {
    if (url.endsWith('/marking-auto-start')) { started = true; return response(active) }
    return response(started ? active : state)
  }, { session: { 'ameqp-grading-selectedQuestion': '1' } })
  await f.mount()
  await act(async () => f.button('启动 AI 逐份阅卷').props.onClick())
  const answer = f.tree.root.findByProps({ alt: '当前答卷' })
  assert.match(answer.props.src, /marking-image\?ans=101/)
  assert.equal(f.calls.filter((c) => c.url.endsWith('/marking-auto-start')).length, 1)
})

test('a rendering error shows its message and can reopen the panel without restarting the host', async (t) => {
  const originalConsoleError = console.error
  t.mock.method(console, 'error', (...args) => { if (!String(args[0]).includes('The above error occurred')) originalConsoleError(...args) })
  const bad = { ...basicState, connected: true, exams: {} }
  const f = fixture(t, async (_url, _init, calls) => response(calls.length === 1 ? bad : basicState))
  await f.mount()
  assert.match(f.text(), /阅卷工作台加载失败/)
  await act(async () => f.button('重新打开工作台').props.onClick())
  assert.match(f.text(), /阅卷地址/)
  assert.ok(!f.text().includes('阅卷工作台加载失败'))
  assert.ok(f.calls.every((c) => c.method === 'GET'))
})

function reviewState() {
  return { ...basicState, connected: true, productionMarking: true, exam: '504', subject: '2253', questions: [{ id: 4, name: '人工复核题', max_score: 4 }],
    autoMark: { status: 'paused', inFlight: false, selection: { exam: 504, subject: 2253, question: 4 }, review: 1,
      current: { ansQueSN: 101, images: ['/mock-answer.png'], submitted: false, needs_human_review: true, score: null, max_score: 4, review_reason: '图中线型需要教师确认' },
      phase: '需人工复核', stream: { text: '', chars: 0, status: 'completed' } } }
}
async function enterReviewScore(f, score) {
  await act(async () => f.tree.root.findByProps({ id: 'manual-score-101' }).props.onChange({ target: { value: score } }))
}

test('human review exposes manual submit, continue and cancel without defaulting an undecided score to zero', async (t) => {
  const f = fixture(t, async () => response(reviewState()))
  await f.mount()
  assert.match(f.text(), /图中线型需要教师确认/)
  assert.equal(f.tree.root.findByProps({ id: 'manual-score-101' }).props.value, '')
  assert.equal(f.button('人工提交本份').props.disabled, true)
  assert.equal(f.button('人工提交并继续 AI').props.disabled, true)
  assert.equal(f.button('取消当前领卷').props.disabled, false)
  await enterReviewScore(f, '2.5')
  assert.equal(f.button('人工提交本份').props.disabled, true)
  await enterReviewScore(f, '0')
  assert.equal(f.button('人工提交本份').props.disabled, false)
  assert.ok(f.calls.every((c) => c.method === 'GET'))
})

test('manual submit binds to the held paper and only resumes when that option is chosen', async (t) => {
  const state = reviewState()
  const f = fixture(t, async (url, init) => {
    if (url.endsWith('/marking-submit')) {
      const body = JSON.parse(init.body)
      assert.deepEqual(body, { exam: 504, subject: 2253, question: 4, ansQueSN: 101, value: 3, points: [] })
      state.autoMark.current.submitted = true; state.autoMark.current.needs_human_review = false
      state.autoMark.status = 'stopped'
      return response({ ok: true })
    }
    assert.ok(url.endsWith('/state'), 'No automatic claim or resume after submitting this paper')
    return response(state)
  })
  await f.mount()
  await enterReviewScore(f, '3')
  await act(async () => f.button('人工提交本份').props.onClick())
  assert.equal(f.calls.filter((c) => c.url.endsWith('/marking-submit')).length, 1)
  assert.ok(!f.button('人工提交本份'))
  assert.equal(f.button('继续 AI 阅卷').props.disabled, false)
})

test('manual submit and continue waits for submission acknowledgement and blocks double clicks', async (t) => {
  const state = reviewState()
  let acknowledge
  const gate = new Promise((resolve) => { acknowledge = resolve })
  const f = fixture(t, async (url) => {
    if (url.endsWith('/marking-submit')) { await gate; state.autoMark.current.submitted = true; return response({ ok: true }) }
    if (url.endsWith('/marking-auto-resume')) return response({ ...state, autoMark: { ...state.autoMark, status: 'running', inFlight: true } })
    return response(state)
  })
  await f.mount()
  await enterReviewScore(f, '2')
  let operation
  await act(async () => {
    const handler = f.button('人工提交并继续 AI').props.onClick
    operation = handler()
    await handler()
  })
  assert.equal(f.calls.filter((c) => c.url.endsWith('/marking-submit')).length, 1)
  assert.equal(f.calls.filter((c) => c.url.endsWith('/marking-auto-resume')).length, 0)
  await act(async () => { acknowledge(); await operation })
  assert.equal(f.calls.filter((c) => c.url.endsWith('/marking-auto-resume')).length, 1)
})

test('uncertain submissions disable all manual review writes', async (t) => {
  const state = reviewState(); state.autoMark.submissionUncertain = true
  const f = fixture(t, async () => response(state))
  await f.mount()
  for (const label of ['人工提交本份', '人工提交并继续 AI', '取消当前领卷']) assert.equal(f.button(label).props.disabled, true)
  assert.ok(f.calls.every((c) => c.method === 'GET'))
})

test('a lost manual submission acknowledgement refreshes state and disables further writes', async (t) => {
  const state = reviewState()
  const f = fixture(t, async (url) => {
    if (url.endsWith('/marking-submit')) { state.autoMark.submissionUncertain = true; return response({ error: '提交响应中断，请核对' }, 500) }
    return response(state)
  })
  await f.mount()
  await enterReviewScore(f, '3')
  await act(async () => f.button('人工提交本份').props.onClick())
  assert.match(f.text(), /提交响应中断，请核对/)
  for (const label of ['人工提交本份', '人工提交并继续 AI', '取消当前领卷']) assert.equal(f.button(label).props.disabled, true)
  assert.equal(f.calls.filter((c) => c.url.endsWith('/marking-submit')).length, 1)
})

test('a full batch exposes a next-batch action while retaining cumulative progress', async (t) => {
  const state = { ...basicState, connected: true, productionMarking: true,
    autoMark: { status: 'paused', inFlight: false, pauseReason: 'batch_limit', batchSubmitted: 200, batchLimit: 200, batchNumber: 1, submitted: 200, phase: '本批已完成200份，可继续下一批', current: null } }
  const f = fixture(t, async (url) => {
    if (url.endsWith('/marking-auto-resume')) { state.autoMark = { ...state.autoMark, status: 'completed', batchSubmitted: 1, batchNumber: 2, submitted: 201, pauseReason: null }; return response(state) }
    return response(state)
  })
  await f.mount()
  assert.match(f.text(), /200\/200/)
  assert.equal(f.button('继续下一批（200份）').props.disabled, false)
  await act(async () => f.button('继续下一批（200份）').props.onClick())
  assert.match(f.text(), /"201"/)
  assert.equal(f.calls.filter((c) => c.url.endsWith('/marking-auto-resume')).length, 1)
  assert.ok(!f.calls.some((c) => c.url.endsWith('/marking-auto-start')))
})
