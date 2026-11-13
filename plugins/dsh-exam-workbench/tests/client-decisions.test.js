import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

const source = fs.readFileSync(new URL('../grading-client.js', import.meta.url), 'utf8')
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const questionConfig = { exam: 1, subject: 2, question_id: 3, question: '原题', question_prompt: '题目标准', max_score: 8, criteria: [{ id: 'drawing', description: '结构', max_score: 8 }], stem_image: 'data:image/png;base64,stem', reference_image: 'data:image/png;base64,reference' }
const result = { test_only: true, submitted: false, provider: 'decisions-api.dev', model: 'openai/gpt-6-luna-decisions', requestId: 'test-request-A', protocol: 'systemone-choice-v1', score: 6.25, raw_score: 6.18, max_score: 8,
  criteria: [{ id: 'drawing', score: 6.25, max_score: 8, confidence: 0.7, probability: 0.61, distribution: { '6': 0.39, '6.25': 0.61 } }], needs_human_review: true, reason: '需核验边线', warnings: ['诊断提示'], elapsedMs: 5300, upstreamElapsedMs: 5200, creditsUsed: 1, usage: { calls: 1 } }
const gate = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { resolve, promise } }
function fixture(t, options = {}) {
  const calls = [], stores = [], bodyHandlers = new Map()
  const states = Object.fromEntries(['A', 'B'].map((id) => [id, { connected: true, accountId: id, taskId: 'task-' + id, username: id, productionMarking: true, exam: '1', subject: '2', question: 3, exams: [], subjects: [], questions: [{ id: 3, name: '当前题', max_score: 8 }], model: { mode: 'harness', model: 'official-' + id }, prompt: '总提示词-' + id, autoMark: null }]))
  if (options.disconnected) for (const state of Object.values(states)) { state.connected = false; state.username = ''; state.question = ''; state.questions = []; state.model = null }
  let renderer, render
  const storage = () => { const map = new Map(); return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { stores.push({ key, value }); map.set(key, value) }, removeItem: (key) => map.delete(key) } }
  const context = { console: { ...console, error() {} }, URL, AbortController, setTimeout, clearTimeout,
    sessionStorage: storage(), localStorage: storage(),
    FileReader: class { readAsDataURL(file) { if (options.readFile) return options.readFile(this, file); this.result = file.data; this.onload() } },
    document: { baseURI: 'http://fixture.invalid/', body: { addEventListener: (name, callback) => bodyHandlers.set(name, callback), removeEventListener: (name) => bodyHandlers.delete(name) }, getElementById: () => null },
    fetch: async (url, init = {}) => {
      const op = new URL(url).pathname.replace('/ameqp-grading/api/', ''), body = init.body ? JSON.parse(init.body) : undefined
      calls.push({ op, method: init.method || 'GET', body })
      if (op === 'accounts') return response({ accounts: Object.values(states), defaultAccountId: 'A', maxConcurrentModels: 2 })
      const match = /^accounts\/([^/]+)\/(.+)$/.exec(op)
      assert.ok(match, 'request must be account scoped')
      if (match[2] === 'state') return response(states[match[1]])
      if (match[2] === 'question-config') return response(options.config || questionConfig)
      if (match[2] === 'llm-models') return response({ providers: [{ provider: 'official', name: '正式模型', models: [{ id: 'official-A', name: '正式模型A', image: true }] }] })
      assert.equal(match[2], 'decisions-test', 'Decisions must not change configuration or call marking')
      return options.trial ? options.trial(body, match[1]) : response(result)
    },
    window: { addEventListener() {}, removeEventListener() {}, __ModuleLoader__: { load({ factory }) { const plugin = factory(() => React); plugin.apply({ slots: { inject(_slot, callback) { callback() }, register(entry, callback) { if (entry.name === 'main') render = callback; return () => {} } } }) } } },
  }
  vm.runInNewContext(source, context)
  t.after(async () => { if (renderer) await act(async () => renderer.unmount()) })
  return { calls, stores, states, bodyHandlers,
    async mount() { await act(async () => { renderer = TestRenderer.create(render()) }) },
    async unmount() { await act(async () => renderer.unmount()); renderer = null },
    get root() { return renderer.root },
    text() { return JSON.stringify(renderer.toJSON()) },
    card() { return renderer.root.findByProps({ 'data-testid': 'decisions-trial' }) },
    button(label) { return renderer.root.findAllByType('button').find((b) => b.children.join('') === label) },
    async click(label) { await act(async () => { const button = this.button(label); assert.ok(button, label); assert.ok(!button.props.disabled, label + ' enabled'); await button.props.onClick() }) },
    async field(id, value) { await act(async () => renderer.root.findByProps({ id }).props.onChange({ target: { value } })) },
    async upload(files) { await act(async () => renderer.root.findByProps({ id: 'ag-decisions-images' }).props.onChange({ target: { files } })) },
    trials() { return calls.filter((c) => c.op.endsWith('/decisions-test')) },
    async section(id) { await act(async () => renderer.root.findByProps({ id: 'ag-settings-nav-' + id }).props.onClick()) },
    async ready() { await this.mount(); await this.click('设置'); await this.section('trial') },
  }
}
const image = (name = 'answer') => ({ type: 'image/png', size: 128, data: 'data:image/png;base64,' + name })

test('a disconnected account shows the public no-sample notice and never offers a paid request', async (t) => {
  const f = fixture(t, { disconnected: true })
  await f.mount()
  const entry = 'Decisions 试验'
  assert.ok(f.button('登录'))
  assert.equal(f.trials().length, 0)
  await f.click(entry)
  assert.equal(f.button(entry).props['aria-expanded'], true)
  assert.match(f.text(), /公开版不附带考试或学生样本/)
  assert.equal(f.root.findAllByProps({ id: 'ag-decisions-key' }).length, 0)
  assert.equal(f.root.findAllByProps({ id: 'ag-decisions-mode' }).length, 0)
  assert.equal(f.button('运行 Decisions 试评'), undefined)
  assert.equal(f.trials().length, 0)
  assert.ok(!f.calls.some((call) => /login|marking-|save-config|\/model$/.test(call.op)))
  await f.click(entry)
  await f.click(entry)
  assert.match(f.text(), /公开版不附带考试或学生样本/)
  assert.equal(f.trials().length, 0)
})

test('the standalone trial opens on its own settings page and never automatically calls or enables Decisions', async (t) => {
  const f = fixture(t)
  await f.ready()
  assert.match(f.text(), /Decisions 评分试验/)
  assert.equal(f.trials().length, 0)
  assert.equal(f.root.findAllByProps({ id: 'ag-decisions-sample' }).length, 0)
  assert.equal(f.root.findAllByProps({ id: 'ag-decisions-question' }).length, 0)
  assert.deepEqual(f.root.findByProps({ id: 'ag-decisions-mode' }).findAllByType('option').map((option) => option.props.value), ['custom'])
  assert.equal(f.button('运行 Decisions 试评').props.disabled, true)
  assert.equal(f.root.findByProps({ id: 'ag-decisions-step' }).props.value, '0.25')
  const selects = f.root.findAllByType('select').filter((n) => !n.props.id?.startsWith('ag-decisions'))
  assert.ok(selects.every((n) => n.findAllByType('option').every((o) => !o.children.join('').includes('Decisions'))))
  assert.ok(!f.calls.some((c) => /\/model$|save-config|marking-/.test(c.op)))
})

test('uploaded synthetic image sends exactly one test request and shows scores, diagnostics, cost and timing', async (t) => {
  const f = fixture(t)
  await f.ready()
  await f.upload([image()])
  const before = f.calls.length
  await f.click('运行 Decisions 试评')
  assert.equal(f.calls.length - before, 1)
  assert.equal(f.trials()[0].op, 'accounts/A/decisions-test')
  assert.equal(f.trials()[0].body.score_step, 0.25)
  assert.deepEqual(f.trials()[0].body.answer_images, [image().data])
  assert.deepEqual(f.trials()[0].body.config.criteria, questionConfig.criteria)
  assert.ok(!Object.hasOwn(f.trials()[0].body, 'sample'))
  assert.match(f.text(), /试评总分 6.25 \/ 8/)
  assert.match(f.text(), /原始分 6.18/)
  assert.match(f.text(), /61.0%/)
  assert.match(f.text(), /不是评分准确率/)
  assert.match(f.text(), /5300ms/)
  assert.match(f.text(), /积分 1/)
  assert.match(f.text(), /仅试验 · 未提交/)
  assert.match(f.text(), /需核验边线/)
  assert.match(f.text(), /诊断提示/)
  assert.equal(f.states.A.model.model, 'official-A')
})

test('trial Key only lives in password component memory and is absent after switching pages or accounts', async (t) => {
  const f = fixture(t)
  await f.ready()
  const field = f.root.findByProps({ id: 'ag-decisions-key' })
  assert.equal(field.props.type, 'password')
  assert.equal(field.props.value, '')
  await f.field('ag-decisions-key', 'fictional-test-secret')
  await f.upload([image()])
  await f.click('运行 Decisions 试评')
  assert.equal(f.trials()[0].body.api_key, 'fictional-test-secret')
  assert.ok(!JSON.stringify(f.stores).includes('fictional-test-secret'))
  await f.section('model')
  assert.equal(f.root.findAllByProps({ 'data-testid': 'decisions-trial' }).length, 0)
  await f.section('trial')
  assert.equal(f.root.findByProps({ id: 'ag-decisions-key' }).props.value, '')
  assert.equal(f.root.findAllByProps({ 'data-testid': 'decisions-result' }).length, 0)
  await f.click('自动阅卷'); await f.click('设置')
  assert.equal(f.root.findByProps({ id: 'ag-decisions-key' }).props.value, '')
  await f.field('ag-decisions-key', 'another-fictional-secret')
  await f.field('ag-account', 'B'); await f.click('设置'); await f.section('trial')
  assert.equal(f.root.findByProps({ id: 'ag-decisions-key' }).props.value, '')
  assert.ok(!JSON.stringify(f.stores).includes('another-fictional-secret'))
  await f.upload([image()])
  await f.click('运行 Decisions 试评')
  assert.equal(f.trials()[1].op, 'accounts/B/decisions-test')
  assert.ok(!Object.hasOwn(f.trials()[1].body, 'api_key'), 'empty key uses backend fallback')
})

test('custom image mode uses current unsaved rubric, prompt and images without saving or claiming a paper', async (t) => {
  const f = fixture(t)
  await f.ready()
  const label = f.root.findAllByType('label').find((n) => n.children.join('') === '题干 / 评分范围')
  await act(async () => label.parent.findByType('textarea').props.onChange({ target: { value: '未保存题干' } }))
  await f.field('ag-decisions-mode', 'custom')
  assert.equal(f.button('运行 Decisions 试评').props.disabled, true)
  await f.upload([image('first'), image('second')])
  await f.field('ag-decisions-step', '0.5')
  const before = f.calls.length
  await f.click('运行 Decisions 试评')
  assert.equal(f.calls.length - before, 1)
  const body = f.trials()[0].body
  assert.equal(body.config.question, '未保存题干')
  assert.deepEqual(body.config.criteria, questionConfig.criteria)
  assert.equal(body.config.max_score, 8)
  assert.equal(body.config.stem_image, questionConfig.stem_image)
  assert.equal(body.config.reference_image, questionConfig.reference_image)
  assert.equal(body.prompt, '总提示词-A')
  assert.deepEqual(body.answer_images, ['data:image/png;base64,first', 'data:image/png;base64,second'])
  assert.equal(body.score_step, 0.5)
  assert.ok(!Object.hasOwn(body, 'sample'))
  assert.ok(!JSON.stringify(f.stores).includes('data:image/png;base64,first'), 'test images do not enter drafts')
})

test('local paste does not reach the main rubric paste handler and keeps both image roles separate', async (t) => {
  const f = fixture(t)
  await f.ready(); await f.field('ag-decisions-mode', 'custom')
  let prevented = false, stopped = false
  await act(async () => f.card().props.onPaste({ clipboardData: { items: [{ type: 'image/png', getAsFile: () => image('pasted') }] }, preventDefault() { prevented = true }, stopPropagation() { stopped = true } }))
  assert.equal(prevented, true); assert.equal(stopped, true)
  assert.equal(f.root.findByProps({ alt: '试验作答图 1' }).props.src, 'data:image/png;base64,pasted')
  assert.equal(f.root.findByProps({ alt: '题干图' }).props.src, questionConfig.stem_image)
  assert.equal(f.root.findByProps({ alt: '参考答案图' }).props.src, questionConfig.reference_image)
  await f.click('运行 Decisions 试评')
  assert.deepEqual(f.trials()[0].body.answer_images, ['data:image/png;base64,pasted'])
  await f.click('移除作答图 1')
  assert.equal(f.button('运行 Decisions 试评').props.disabled, true)
})

test('image limits include rubric images and reject a batch without silently dropping any image', async (t) => {
  const f = fixture(t)
  await f.ready(); await f.field('ag-decisions-mode', 'custom')
  await f.upload([image('one'), image('two'), image('three')])
  assert.match(f.text(), /总图片最多4张/)
  assert.match(f.text(), /不会自动丢弃图片/)
  assert.equal(f.root.findAllByProps({ alt: '试验作答图 1' }).length, 0)
  await f.upload([{ ...image('too-large'), size: 2 * 1024 * 1024 + 1 }])
  assert.match(f.text(), /2MB以内/)
  await f.upload([{ type: 'text/plain', size: 50, data: 'unrelated' }])
  assert.match(f.text(), /请选择图片文件/)
  assert.equal(f.trials().length, 0)
})

test('double click does not duplicate a charged trial and an account switch discards the late receipt', async (t) => {
  const pending = gate()
  const f = fixture(t, { trial: () => pending.promise })
  await f.ready()
  await f.upload([image()])
  let operation
  await act(async () => { const handler = f.button('运行 Decisions 试评').props.onClick; operation = handler(); await handler() })
  assert.equal(f.trials().length, 1)
  await f.field('ag-account', 'B'); await f.click('设置'); await f.section('trial')
  await act(async () => { pending.resolve(response(result)); await operation })
  assert.equal(f.root.findAllByProps({ 'data-testid': 'decisions-result' }).length, 0)
  assert.equal(f.root.findByProps({ id: 'ag-account' }).props.value, 'B')
  assert.equal(f.trials()[0].op, 'accounts/A/decisions-test')
})

test('switching settings and work preserves hook ordering and never starts a trial', async (t) => {
  const f = fixture(t)
  await f.ready()
  for (let i = 0; i < 3; i++) { await f.click('自动阅卷'); await f.click('设置') }
  assert.equal(f.trials().length, 0)
  assert.match(f.text(), /Decisions 评分试验/)
  assert.doesNotMatch(f.text(), /阅卷工作台加载失败/)
})

test('server message errors are visible without retries or model changes', async (t) => {
  const f = fixture(t, { trial: async () => response({ error: 'upstream_failure', message: '试验接口返回429，请稍后手动重试' }, 429) })
  await f.ready(); await f.upload([image()]); await f.click('运行 Decisions 试评')
  assert.match(f.text(), /试验接口返回429/)
  assert.equal(f.trials().length, 1)
  assert.equal(f.root.findAllByProps({ 'data-testid': 'decisions-result' }).length, 0)
  assert.ok(!f.calls.some((c) => /marking-|save-config|\/model$/.test(c.op)))
})

test('responses without test-only and not-submitted markers are rejected', async (t) => {
  const f = fixture(t, { trial: async () => response({ ...result, submitted: true }) })
  await f.ready(); await f.upload([image()]); await f.click('运行 Decisions 试评')
  assert.match(f.text(), /试验响应缺少仅测试标记/)
  assert.equal(f.root.findAllByProps({ 'data-testid': 'decisions-result' }).length, 0)
})

test('invalid current rubric blocks custom trials locally', async (t) => {
  const f = fixture(t)
  await f.ready(); await f.field('ag-decisions-mode', 'custom'); await f.upload([image()])
  const label = f.root.findAllByType('label').find((n) => n.children.join('') === '评分项 JSON（id、description、max_score，合计须等于满分）')
  await act(async () => label.parent.findByType('textarea').props.onChange({ target: { value: 'invalid json' } }))
  await f.click('运行 Decisions 试评')
  assert.match(f.text(), /当前评分项 JSON 格式错误/)
  assert.equal(f.trials().length, 0)
})
