import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

const source = fs.readFileSync(new URL('../grading-client.js', import.meta.url), 'utf8')
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data })
const gate = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const config = (account, question = 1) => ({ exam: 10, subject: 20, question_id: question, max_score: 8, question: `${account} question ${question}`, question_prompt: `${account} rules`, criteria: [{ id: 'sketch', max_score: 8, description: '结构' }] })
function state(account, extra = {}) {
  return { accountId: account, taskId: `task-${account}`, connected: true, username: account, name: `账号${account}`, base: `http://${account.toLowerCase()}.invalid/`,
    productionMarking: true, exam: '10', subject: '20', question: 1, exams: [{ id: 10, name: '考试' }], subjects: [{ id: 20, name: '科目' }],
    questions: [{ id: 1, name: '题一', max_score: 8 }, { id: 2, name: '题二', max_score: 8 }], prompt: `${account} prompt`, model: { mode: 'harness', provider: 'p', model: `model-${account}` },
    autoMark: { status: 'running', phase: `${account} grading`, inFlight: true, selection: { exam: 10, subject: 20, question: 1 }, model: `model-${account}`, submitted: 3,
      current: { ansQueSN: account === 'A' ? 101 : 202, submitted: false, images: [`/ameqp-grading/api/accounts/${account}/marking-image?ans=${account}`] }, stream: { text: `${account} stream`, status: 'streaming' } }, ...extra }
}
function fixture(t, options = {}) {
  const states = options.states || { A: state('A'), B: state('B') }
  const calls = [], registrations = [], signals = []
  const items = new Map(Object.entries(options.session || {})), local = new Map()
  let plugin, render, renderer, quota = false
  const storage = (map) => ({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { if (quota && k.includes('selection:')) throw new Error('QuotaExceededError'); map.set(k, v) }, removeItem: (k) => map.delete(k) })
  const directory = () => ({ defaultAccountId: 'A', maxConcurrentModels: 2, accounts: Object.values(states).map((s) => ({ ...s, isDefault: s.accountId === 'A', manualPending: !!s.manualMark })) })
  const context = {
    console: { ...console, error() {} }, URL, AbortController, setTimeout, clearTimeout,
    sessionStorage: storage(items), localStorage: storage(local),
    FileReader: class { readAsDataURL(file) { this.result = file.data; this.onload() } },
    document: { baseURI: 'http://localhost.invalid/', body: { addEventListener() {}, removeEventListener() {} }, getElementById() { return null } },
    fetch: async (url, init = {}) => {
      const op = new URL(url).pathname.replace('/ameqp-grading/api/', '')
      const call = { op, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined }
      calls.push(call); if (init.signal) signals.push({ op, signal: init.signal })
      const custom = options.fetch && await options.fetch(call, init, { states, directory })
      if (custom) return custom
      if (op === 'accounts') return response(directory())
      const match = /^accounts\/([^/]+)\/(.+)$/.exec(op)
      assert.ok(match, 'Every operation must identify an account: ' + op)
      const account = decodeURIComponent(match[1]), action = match[2]
      if (action === 'state') return response(states[account])
      if (action === 'question-config') return response(config(account, call.body.question))
      if (action === 'llm-models') return response({ providers: [{ provider: 'p', name: 'Provider', models: [{ id: 'model-A', name: '模型A', image: true }, { id: 'model-B', name: '模型B', image: true }] }] })
      if (action === 'save-config') return response({ ...call.body.config, exam: call.body.exam, subject: call.body.subject, question_id: call.body.question, max_score: 8 })
      return response(states[account])
    },
    window: { addEventListener() {}, removeEventListener() {}, confirm: () => true, __ModuleLoader__: { load({ factory }) { plugin = factory(() => React) } } },
  }
  vm.runInNewContext(source, context)
  plugin.apply({ slots: { inject(_name, fn) { fn() }, register(entry, fn) { registrations.push(entry); if (entry.name === 'main') render = fn; return () => {} } } })
  t.after(async () => { if (renderer) await act(async () => renderer.unmount()) })
  return {
    calls, states, signals, items,
    async mount() { await act(async () => { renderer = TestRenderer.create(render()) }) },
    async unmount() { await act(async () => renderer.unmount()); renderer = null },
    get tree() { return renderer },
    text() { return JSON.stringify(renderer.toJSON()) },
    button(label) { return renderer.root.findAllByType('button').find((node) => node.children.join('') === label) },
    field(label) { const node = renderer.root.findAllByType('label').find((node) => node.children.join('') === label); assert.ok(node, label); return node.parent.findAll((n) => ['input', 'textarea', 'select'].includes(n.type))[0] },
    async choose(account) { await act(async () => renderer.root.findByProps({ id: 'ag-account' }).props.onChange({ target: { value: account } })) },
    async click(label) { await act(async () => { const button = this.button(label); assert.ok(button, label); assert.ok(!button.props.disabled, label + ' is enabled'); await button.props.onClick() }) },
    async change(label, value) { await act(async () => this.field(label).props.onChange({ target: { value } })) },
    setQuota(value) { quota = value },
  }
}

test('account switching reads only the selected detail and never starts, pauses or logs in', async (t) => {
  const f = fixture(t)
  await f.mount()
  assert.match(f.tree.root.findByProps({ alt: '当前答卷' }).props.src, /accounts\/A\//)
  await f.choose('B')
  assert.match(f.tree.root.findByProps({ alt: '当前答卷' }).props.src, /accounts\/B\//)
  assert.match(f.text(), /B grading/)
  assert.doesNotMatch(f.text(), /A grading/)
  f.states.A = { ...f.states.A, autoMark: { ...f.states.A.autoMark, submitted: 42 } }
  await f.choose('A')
  assert.match(f.text(), /"42"/)
  assert.match(f.text(), /已提交份数/)
  assert.ok(f.calls.every((c) => c.method === 'GET'))
  assert.equal(f.calls.filter((c) => c.op === 'accounts/A/state').length, 2)
})

test('login reconnects the saved matching account rather than sending another identity to the selected account', async (t) => {
  const f = fixture(t, { states: { A: state('A', { connected: false, autoMark: null }), B: state('B', { connected: false, autoMark: null }) },
    fetch: async (c, _init, { states }) => {
      if (c.op === 'accounts/B/login') { states.B = state('B', { autoMark: null }); return response(states.B) }
    } })
  await f.mount()
  await f.change('阅卷地址', ' http://B.invalid:80 ')
  await f.change('账号', ' B ')
  await f.change('密码', 'fictional-password')
  await f.click('登录')
  assert.deepEqual(f.calls.filter((c) => c.method === 'POST').map((c) => c.op), ['accounts/B/login'])
  assert.equal(f.tree.root.findByProps({ id: 'ag-account' }).props.value, 'B')
  assert.ok(f.button('设置'))
  assert.equal(f.states.A.connected, false)
})

test('login for an already connected matching account only switches views without logging in again', async (t) => {
  const f = fixture(t, { states: { A: state('A', { connected: false, autoMark: null }), B: state('B') } })
  await f.mount()
  await f.change('阅卷地址', 'http://b.invalid/')
  await f.change('账号', 'B')
  await f.change('密码', 'fictional-password')
  await f.click('登录')
  assert.ok(f.calls.every((c) => c.method === 'GET'))
  assert.equal(f.tree.root.findByProps({ id: 'ag-account' }).props.value, 'B')
  assert.match(f.text(), /B grading/)
})

test('a failed matching-account login stays on the original view and cannot be submitted twice concurrently', async (t) => {
  const delayed = gate()
  const f = fixture(t, { states: { A: state('A', { connected: false, autoMark: null }), B: state('B', { connected: false, autoMark: null }) },
    fetch: async (c) => c.op === 'accounts/B/login' ? delayed.promise : null })
  await f.mount()
  await f.change('阅卷地址', 'http://b.invalid/')
  await f.change('账号', 'B')
  await f.change('密码', 'fictional-password')
  let pendingLogin
  await act(async () => {
    const login = f.button('登录').props.onClick
    pendingLogin = login()
    await login()
    await Promise.resolve()
  })
  assert.equal(f.calls.filter((c) => c.op === 'accounts/B/login').length, 1)
  await act(async () => { delayed.resolve(response({ error: 'offline password rejected' }, 400)); await pendingLogin })
  assert.equal(f.tree.root.findByProps({ id: 'ag-account' }).props.value, 'A')
  assert.match(f.text(), /登录失败：offline password rejected/)
  assert.equal(f.button('登录').props.disabled, false)
  assert.equal(f.states.B.connected, false)
})

test('switching away during login does not select the login target when its late response arrives', async (t) => {
  const delayed = gate()
  const f = fixture(t, { states: { A: state('A', { connected: false, autoMark: null }), B: state('B', { connected: false, autoMark: null }), C: state('C') },
    fetch: async (c) => c.op === 'accounts/B/login' ? delayed.promise : null })
  await f.mount()
  await f.change('阅卷地址', 'http://b.invalid/')
  await f.change('账号', 'B')
  await f.change('密码', 'fictional-password')
  let pendingLogin
  await act(async () => { pendingLogin = f.button('登录').props.onClick(); await Promise.resolve() })
  await f.choose('C')
  await act(async () => { delayed.resolve(response(state('B'))); await pendingLogin })
  assert.equal(f.tree.root.findByProps({ id: 'ag-account' }).props.value, 'C')
  assert.match(f.text(), /C grading/)
  assert.deepEqual(f.calls.filter((c) => c.method === 'POST').map((c) => c.op), ['accounts/B/login'])
})

test('an ignored abort and a late A state reply cannot replace B images or output', async (t) => {
  const delayed = gate()
  const f = fixture(t, { fetch: async (c) => c.op === 'accounts/A/state' ? delayed.promise : null })
  await f.mount()
  await f.choose('B')
  await act(async () => delayed.resolve(response(state('A'))))
  assert.match(f.text(), /B grading/)
  assert.doesNotMatch(f.text(), /A grading/)
  assert.match(f.tree.root.findByProps({ alt: '当前答卷' }).props.src, /accounts\/B\//)
  assert.ok(f.signals.find((c) => c.op === 'accounts/A/state').signal.aborted)
  assert.ok(f.calls.every((c) => c.method === 'GET'))
})

test('a pause binds account and top-level taskId before switching and its late receipt leaves B intact', async (t) => {
  const delayed = gate()
  const f = fixture(t, { fetch: async (c) => c.op === 'accounts/A/marking-auto-pause' ? delayed.promise : null })
  await f.mount()
  let pause
  await act(async () => { pause = f.button('暂停').props.onClick() })
  await f.choose('B')
  await act(async () => { delayed.resolve(response(state('A', { taskId: 'old-A' }))); await pause })
  const writes = f.calls.filter((c) => c.method === 'POST')
  assert.deepEqual(writes, [{ op: 'accounts/A/marking-auto-pause', method: 'POST', body: { taskId: 'task-A' } }])
  assert.match(f.text(), /B grading/)
  assert.doesNotMatch(f.text(), /已暂停/)
})

test('start projects a new taskId and subsequent task controls use the new identity', async (t) => {
  const a = state('A', { taskId: null, autoMark: null })
  const f = fixture(t, { states: { A: a }, fetch: async (c, _init, { states }) => {
    if (c.op === 'accounts/A/marking-auto-start') { states.A = state('A', { taskId: 'new-A' }); return response(states.A) }
  } })
  await f.mount()
  await f.click('启动 AI 逐份阅卷')
  await f.click('暂停')
  assert.equal(f.calls.find((c) => c.op.endsWith('/marking-auto-pause')).body.taskId, 'new-A')
  assert.match(f.tree.root.findByProps({ alt: '当前答卷' }).props.src, /accounts\/A\//)
})

test('manual submit and continue remains bound to A when its acknowledgement arrives in B', async (t) => {
  const delayed = gate(), a = state('A')
  a.autoMark = { ...a.autoMark, status: 'paused', inFlight: false, current: { ...a.autoMark.current, needs_human_review: true, max_score: 8 } }
  const f = fixture(t, { states: { A: a, B: state('B') }, fetch: async (c) => c.op === 'accounts/A/marking-submit' ? delayed.promise : null })
  await f.mount()
  await act(async () => f.tree.root.findByProps({ id: 'manual-score-101' }).props.onChange({ target: { value: '5' } }))
  let submit
  await act(async () => { submit = f.button('人工提交并继续 AI').props.onClick() })
  await f.choose('B')
  await act(async () => { delayed.resolve(response({ ok: true })); await submit })
  const writes = f.calls.filter((c) => c.method === 'POST')
  assert.deepEqual(writes.map((c) => [c.op, c.body.taskId]), [['accounts/A/marking-submit', 'task-A'], ['accounts/A/marking-auto-resume', 'task-A']])
  assert.equal(writes[0].body.ansQueSN, 101)
  assert.match(f.text(), /B grading/)
})

test('adding a connection uses the accounts API and never resets the other connection', async (t) => {
  const f = fixture(t, { fetch: async (c, _init, { states }) => {
    if (c.op === 'accounts' && c.method === 'POST') { states.C = state('C'); return response(states.C) }
  } })
  await f.mount()
  await f.click('添加账号')
  for (const [label, value] of [['阅卷地址', 'http://c.invalid/'], ['账号', 'C'], ['密码', 'secret'], ['账号简称（可选）', '第三路']]) await f.change(label, value)
  await f.click('连接新账号')
  assert.equal(f.tree.root.findByProps({ id: 'ag-account' }).props.value, 'C')
  assert.match(f.text(), /C grading/)
  assert.deepEqual(f.calls.filter((c) => c.method === 'POST'), [{ op: 'accounts', method: 'POST', body: { base: 'http://c.invalid/', username: 'C', password: 'secret', name: '第三路' } }])
  assert.equal(f.states.A.autoMark.submitted, 3)
})

test('the overview displays non-selected errors without loading its images and pause-all is explicit', async (t) => {
  const b = state('B'); b.autoMark = { ...b.autoMark, submissionUncertain: true, phase: '提交待核对' }
  const f = fixture(t, { states: { A: state('A'), B: b }, fetch: async (c) => c.op === 'tasks/pause-all' ? response({ accounts: [] }) : null })
  await f.mount()
  await f.click('全部任务')
  assert.match(f.text(), /待核对提交/)
  assert.match(f.text(), /model-B/)
  assert.equal(f.button('继续').props.disabled, true)
  assert.ok(!f.calls.some((c) => c.op === 'accounts/B/state'))
  assert.equal(f.tree.root.findAllByType('img').length, 1)
  await f.click('全部暂停')
  assert.deepEqual(f.calls.find((c) => c.op === 'tasks/pause-all').body, {})
  assert.match(f.text(), /在途请求和提交仍需等待确认/)
})

test('automatic marking displays the real secret number and omits the AI stream panel', async (t) => {
  const a = state('A')
  a.autoMark.current.stuSecNo = '00123456'
  const f = fixture(t, { states: { A: a } })
  await f.mount()
  const label = f.tree.root.findByProps({ className: 'ag-paper-label' })
  assert.equal(label.children.map((n) => n.children.join('')).join(' '), '密号 00123456')
  assert.equal(f.tree.root.findAllByProps({ 'data-testid': 'grading-stream' }).length, 0)
  assert.doesNotMatch(f.text(), /A stream/)
  assert.match(f.text(), /A grading/)
  assert.ok(f.calls.every((c) => c.method === 'GET'))
  f.states.A = state('A')
  await f.unmount(); await f.mount()
  const missing = f.tree.root.findByProps({ className: 'ag-paper-label' })
  assert.equal(missing.children.map((n) => n.children.join('')).join(' '), '密号 未提供')
})

test('settings navigation switches visible pages, retains drafts and restores the selected page per account', async (t) => {
  const f = fixture(t)
  await f.mount(); await f.click('设置')
  const section = async (id) => act(async () => f.tree.root.findByProps({ id: 'ag-settings-nav-' + id }).props.onClick())
  const visible = () => f.tree.root.findAll((n) => n.type === 'section' && n.props.className === 'ag-settings-section' && !n.props.hidden).map((n) => n.props.id)
  assert.deepEqual(visible(), ['ag-settings-rubric'])
  await f.change('题干 / 评分范围', 'unsaved rubric')
  await section('prompt')
  assert.deepEqual(visible(), ['ag-settings-prompt'])
  await f.change('跨题复用的判分方法（可编辑）', 'unsaved prompt')
  await section('model')
  assert.deepEqual(visible(), ['ag-settings-model'])
  assert.equal(f.tree.root.findByProps({ id: 'ag-settings-nav-model' }).props['aria-current'], 'page')
  await f.change('模型', 'model-B')
  await section('general')
  assert.deepEqual(visible(), ['ag-settings-general'])
  await section('rubric')
  assert.equal(f.field('题干 / 评分范围').props.value, 'unsaved rubric')
  await section('prompt')
  assert.equal(f.field('跨题复用的判分方法（可编辑）').props.value, 'unsaved prompt')
  await f.choose('B'); await f.click('设置')
  assert.deepEqual(visible(), ['ag-settings-rubric'])
  await f.choose('A')
  assert.deepEqual(visible(), ['ag-settings-prompt'])
  await section('model')
  assert.equal(f.field('模型').props.value, 'model-B')
  await f.unmount(); await f.mount()
  assert.deepEqual(visible(), ['ag-settings-model'])
  assert.ok(!f.calls.some((c) => c.method === 'POST' && !c.op.endsWith('/question-config') && !c.op.endsWith('/llm-models')))
})

test('settings, models, prompt and full image drafts restore independently across accounts and remount', async (t) => {
  const f = fixture(t)
  await f.mount()
  await f.click('设置')
  assert.equal(f.field('题干 / 评分范围').props.value, 'A question 1')
  assert.equal(f.field('模型').props.value, 'model-A')
  await f.change('题干 / 评分范围', 'A unsaved question')
  await f.change('跨题复用的判分方法（可编辑）', 'A custom prompt')
  await f.change('模型', 'model-B')
  await act(async () => f.tree.root.findByProps({ id: 'stem-file' }).props.onChange({ target: { files: [{ size: 50, data: 'data:image/png;base64,A-image' }] } }))
  await f.choose('B')
  await f.click('设置')
  assert.equal(f.field('题干 / 评分范围').props.value, 'B question 1')
  assert.equal(f.field('跨题复用的判分方法（可编辑）').props.value, 'B prompt')
  await f.change('题干 / 评分范围', 'B unsaved question')
  await f.choose('A')
  assert.equal(f.field('题干 / 评分范围').props.value, 'A unsaved question')
  assert.equal(f.field('跨题复用的判分方法（可编辑）').props.value, 'A custom prompt')
  assert.equal(f.field('模型').props.value, 'model-B')
  assert.equal(f.tree.root.findByProps({ alt: '题干图' }).props.src, 'data:image/png;base64,A-image')
  await f.unmount(); await f.mount()
  assert.equal(f.field('题干 / 评分范围').props.value, 'A unsaved question')
  assert.equal(f.tree.root.findByProps({ alt: '题干图' }).props.src, 'data:image/png;base64,A-image')
  await f.choose('B')
  assert.equal(f.field('题干 / 评分范围').props.value, 'B unsaved question')
  assert.equal(f.tree.root.findAllByProps({ alt: '题干图' }).length, 0)
})

test('model and prompt saves carry only the selected account settings and do not control other tasks', async (t) => {
  const f = fixture(t)
  await f.mount(); await f.choose('B'); await f.click('设置')
  await f.change('模型', 'model-A')
  await f.change('跨题复用的判分方法（可编辑）', 'B new prompt')
  await f.click('保存模型配置'); await f.click('保存总提示词')
  const writes = f.calls.filter((c) => c.method === 'POST')
  assert.ok(writes.every((c) => c.op.startsWith('accounts/B/')))
  assert.deepEqual(writes.find((c) => c.op.endsWith('/model')).body, { mode: 'harness', provider: 'p', model: 'model-A', grading_effort: 'low' })
  assert.deepEqual(writes.find((c) => c.op.endsWith('/save-prompt')).body, { prompt: 'B new prompt' })
  assert.ok(!writes.some((c) => /marking-|login|disconnect/.test(c.op)))
  assert.equal(f.states.A.model.model, 'model-A')
})

test('lightweight overview polling updates a non-selected task without loading its details', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture(t)
  await f.mount(); await f.click('全部任务')
  f.states.B = { ...f.states.B, autoMark: { ...f.states.B.autoMark, phase: 'B new failure', failed: 1, submitted: 8, status: 'paused', inFlight: false } }
  await act(async () => t.mock.timers.tick(1800))
  assert.match(f.text(), /B new failure/)
  assert.match(f.text(), /已提交 8/)
  assert.ok(!f.calls.some((c) => c.op === 'accounts/B/state'))
  assert.ok(f.calls.every((c) => c.method === 'GET'))
})

test('question selection isolates drafts and saved configuration loads automatically after remount', async (t) => {
  let saved = null, configReads = 0
  const f = fixture(t, { states: { A: state('A', { autoMark: null }) }, fetch: async (c) => {
    if (c.op === 'accounts/A/question-config') { configReads++; return response(saved && c.body.question === 1 ? saved : config('A', c.body.question)) }
    if (c.op === 'accounts/A/save-config') { saved = { ...c.body.config, exam: 10, subject: 20, question_id: c.body.question, max_score: 8 }; return response(saved) }
  } })
  await f.mount(); await f.click('设置')
  await f.change('题干 / 评分范围', 'question one draft')
  await f.click('自动阅卷'); await f.change('题目', '2'); await f.click('设置')
  assert.equal(f.field('题干 / 评分范围').props.value, 'A question 2')
  await f.change('题干 / 评分范围', 'question two draft')
  await f.click('自动阅卷'); await f.change('题目', '1'); await f.click('设置')
  assert.equal(f.field('题干 / 评分范围').props.value, 'question one draft')
  await f.click('保存本题配置')
  const before = configReads
  saved.question = 'server saved latest'
  await f.unmount(); await f.mount()
  assert.ok(configReads > before, 'Saved configuration is refreshed without pressing load')
  assert.equal(f.field('题干 / 评分范围').props.value, 'server saved latest')
})

test('image storage quota failure is visible and the full image survives switching in the window', async (t) => {
  const f = fixture(t)
  await f.mount(); await f.click('设置')
  f.setQuota(true)
  const image = 'data:image/png;base64,' + 'x'.repeat(2_600_000)
  await act(async () => f.tree.root.findByProps({ id: 'stem-file' }).props.onChange({ target: { files: [{ size: 1_950_000, data: image }] } }))
  assert.match(f.text(), /图片或配置草稿未能持久保存/)
  await f.choose('B'); await f.choose('A')
  assert.equal(f.tree.root.findByProps({ alt: '题干图' }).props.src.length, image.length)
  assert.match(f.text(), /图片或配置草稿未能持久保存/)
})

test('recovery requires explicit original-system confirmation before enabling a new claim or task', async (t) => {
  const a = state('A', { autoMark: null, recovery: { pending: true, claim: { ansQueSN: 919, selection: { exam: 10, subject: 20, question: 2 }, submissionUncertain: true } } })
  const f = fixture(t, { states: { A: a }, fetch: async (c, _init, { states }) => {
    if (c.op === 'accounts/A/recovery-resolve') { states.A = { ...states.A, recovery: null }; return response(states.A) }
  } })
  await f.mount()
  assert.match(f.text(), /答卷 919/)
  assert.match(f.text(), /题目 2/)
  assert.match(f.text(), /提交结果未确认/)
  for (const label of ['启动 AI 逐份阅卷', '领一份答卷', '已在原系统确认提交', '已在原系统确认取消']) assert.equal(f.button(label).props.disabled, true, label)
  assert.ok(f.calls.every((c) => c.method === 'GET'), 'Recovery is never resolved automatically')
  await f.change('原系统核对结果说明', '已在原系统查询到919已提交5分')
  await f.click('已在原系统确认提交')
  assert.deepEqual(f.calls.find((c) => c.op === 'accounts/A/recovery-resolve').body, { ansQueSN: 919, resolution: 'confirmed_submitted', note: '已在原系统查询到919已提交5分' })
  assert.equal(f.tree.root.findAllByProps({ 'data-testid': 'recovery-resolution' }).length, 0)
  assert.equal(f.button('启动 AI 逐份阅卷').props.disabled, false)
})

test('an unknown recovered claim remains blocked until the user confirms and late confirmation cannot change B', async (t) => {
  const delayed = gate()
  const a = state('A', { autoMark: null, recovery: { pending: true, claim: { ansQueSN: null, claimUncertain: true, selection: { exam: 10, subject: 20, question: 1 } } } })
  const f = fixture(t, { states: { A: a, B: state('B') }, fetch: async (c) => c.op === 'accounts/A/recovery-resolve' ? delayed.promise : null })
  await f.mount()
  assert.match(f.text(), /编号未知/)
  assert.equal(f.button('领一份答卷').props.disabled, true)
  await f.change('原系统核对结果说明', '已在原系统确认该账号没有占卷，取消已完成')
  let operation
  await act(async () => { operation = f.button('已在原系统确认取消').props.onClick() })
  await f.choose('B')
  await act(async () => { delayed.resolve(response({ ...a, recovery: null })); await operation })
  assert.deepEqual(f.calls.find((c) => c.op === 'accounts/A/recovery-resolve').body, { ansQueSN: null, resolution: 'confirmed_cancelled', note: '已在原系统确认该账号没有占卷，取消已完成' })
  assert.match(f.text(), /B grading/)
  assert.equal(f.tree.root.findAllByProps({ 'data-testid': 'recovery-resolution' }).length, 0)
})

test('an absent accounts collection uses legacy state without account-scoped or login requests', async (t) => {
  const f = fixture(t, { fetch: async (c) => ['accounts', 'state'].includes(c.op) ? response({ connected: false, exams: [], subjects: [], questions: [], defaultBase: 'http://legacy.invalid/' }) : null })
  await f.mount()
  assert.match(f.text(), /阅卷地址/)
  assert.deepEqual(f.calls.map((c) => c.op), ['accounts', 'state'])
  assert.ok(f.calls.every((c) => c.method === 'GET'))
})

test('late configuration reads cannot replace another selection in the same account', async (t) => {
  const delayed = gate()
  const f = fixture(t, { states: { A: state('A', { autoMark: null }) }, fetch: async (c) => c.op === 'accounts/A/question-config' && c.body.question === 1 ? delayed.promise : null })
  await f.mount()
  await act(async () => f.button('设置').props.onClick())
  await f.click('自动阅卷'); await f.change('题目', '2'); await f.click('设置')
  assert.equal(f.field('题干 / 评分范围').props.value, 'A question 2')
  await act(async () => delayed.resolve(response(config('A', 1))))
  assert.equal(f.field('题干 / 评分范围').props.value, 'A question 2')
})

test('unmounting the panel only disposes readers and never pauses running tasks', async (t) => {
  const f = fixture(t)
  await f.mount(); await f.unmount()
  assert.ok(f.calls.every((c) => c.method === 'GET'))
  assert.equal(f.states.A.autoMark.status, 'running')
  assert.equal(f.states.B.autoMark.status, 'running')
})
