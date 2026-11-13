import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { PassThrough } from 'node:stream'
import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { createUnifiedPlugin } from '../workbench-shell.js'
import { apply, inject } from '../index.js'

function context(language = 'zh') {
  const rows = [], dictionaries = new Map(), listeners = new Set(), cleanups = []
  let current = language
  const locale = {
    register(namespace, lang, values) {
      dictionaries.set(namespace + ':' + lang, values)
      return () => dictionaries.delete(namespace + ':' + lang)
    },
    bind(namespace) { return key => dictionaries.get(namespace + ':' + current)?.[key] ?? key },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    getSnapshot() { return current },
    change(lang) { current = lang; for (const fn of listeners) fn() },
  }
  return {
    rows, dictionaries, locale,
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    slots: {
      inject(_slot, fn) { fn() },
      register(options, component) { const row = { options, component }; rows.push(row); return () => rows.splice(rows.indexOf(row), 1) },
    },
    dispose() { for (const cleanup of cleanups.reverse()) cleanup() },
  }
}
function storage(t, initial, fail = false) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const saved = new Map(initial ? [['exam-workbench-tab', initial]] : [])
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem(key) { if (fail) throw new Error('Storage blocked'); return saved.get(key) ?? null },
    setItem(key, value) { if (fail) throw new Error('Storage blocked'); saved.set(key, value) },
  } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous); else delete globalThis.sessionStorage })
  return saved
}
function fixture(t, options = {}) {
  const saved = storage(t, options.initial, options.failStorage)
  let gradingMounts = 0, archiveMounts = 0
  function GradingApp() {
    const [draft, setDraft] = React.useState('draft')
    React.useEffect(() => { gradingMounts++ }, [])
    return React.createElement('input', { 'data-test': 'grading-draft', value: draft, onChange: event => setDraft(event.target.value) })
  }
  function ArchiveApp() { React.useEffect(() => { archiveMounts++ }, []); return React.createElement('p', null, 'Archive mock') }
  const ctx = context()
  const plugin = createUnifiedPlugin({ React, App: GradingApp, WorkbenchBoundary: React.Fragment, Icon: () => null,
    createArchiveView: () => ({ App: ArchiveApp, namespace: 'archive-test', dictionaries: { zh: { title: '归档测试' }, en: { title: 'Archive mock' } } }),
  })
  plugin.apply(ctx)
  const Main = ctx.rows.find(row => row.options.name === 'main').component
  const focused = []
  let rendered
  act(() => { rendered = Renderer.create(React.createElement(Main), { createNodeMock: element => ({ focus() { focused.push(element.props.id) } }) }) })
  t.after(() => { act(() => rendered.unmount()); ctx.dispose() })
  const tab = name => rendered.root.findByProps({ id: 'ew-tab-' + name })
  return { ctx, plugin, rendered, tab, focused, saved, mounts: () => ({ grading: gradingMounts, archive: archiveMounts }) }
}

test('one unified main/sidebar registration and reactive localized labels', t => {
  const f = fixture(t)
  assert.equal(f.plugin.name, 'exam-workbench')
  assert.deepEqual(f.plugin.inject, ['slots', 'locale'])
  assert.deepEqual(f.ctx.rows.map(row => [row.options.name, row.options.key || row.options.id]), [['main', 'exam-workbench'], ['sidebar.panellist', 'exam-workbench']])
  const sidebar = f.ctx.rows[1]
  assert.equal(sidebar.options.label(), '阅卷工作台')
  assert.equal(f.tab('grading').children.join(''), 'AI 阅卷')
  assert.equal(f.tab('archive').children.join(''), '阅卷归档')
  assert.equal(f.ctx.dictionaries.get('exam-workbench-archive-ui:zh').title, '归档测试')
  act(() => f.ctx.locale.change('en'))
  assert.equal(sidebar.options.label(), 'Exam workbench')
  assert.equal(f.tab('grading').children.join(''), 'AI grading')
  assert.equal(f.tab('archive').children.join(''), 'Exam archive')
  assert.equal(f.rendered.root.findByProps({ role: 'tablist' }).props['aria-label'], 'Exam tools')
})

test('archive loads lazily and switching tabs preserves the grading draft and both mounts', t => {
  const f = fixture(t)
  assert.deepEqual(f.mounts(), { grading: 1, archive: 0 })
  act(() => f.rendered.root.findByProps({ 'data-test': 'grading-draft' }).props.onChange({ target: { value: 'unsaved rubric' } }))
  act(() => f.tab('archive').props.onClick())
  assert.deepEqual(f.mounts(), { grading: 1, archive: 1 })
  assert.equal(f.rendered.root.findByProps({ id: 'ew-panel-grading' }).props.hidden, true)
  assert.equal(f.saved.get('exam-workbench-tab'), 'archive')
  act(() => f.tab('grading').props.onClick())
  assert.equal(f.rendered.root.findByProps({ 'data-test': 'grading-draft' }).props.value, 'unsaved rubric')
  assert.equal(f.rendered.root.findByProps({ id: 'ew-panel-archive' }).props.hidden, true)
  assert.deepEqual(f.mounts(), { grading: 1, archive: 1 })
})

test('restored archive tab defers grading until selected', t => {
  const f = fixture(t, { initial: 'archive' })
  assert.deepEqual(f.mounts(), { grading: 0, archive: 1 })
  assert.equal(f.tab('archive').props['aria-selected'], true)
  act(() => f.tab('grading').props.onClick())
  assert.deepEqual(f.mounts(), { grading: 1, archive: 1 })
})

test('keyboard tabs implement arrows/Home/End, focus, selection and panel relationships', t => {
  const f = fixture(t)
  function key(current, key, expected) {
    let prevented = false
    act(() => f.tab(current).props.onKeyDown({ key, preventDefault() { prevented = true } }))
    assert.equal(prevented, true)
    assert.equal(f.tab(expected).props['aria-selected'], true)
    assert.equal(f.tab(expected).props.tabIndex, 0)
    assert.equal(f.focused.at(-1), 'ew-tab-' + expected)
    const panel = f.rendered.root.findByProps({ id: f.tab(expected).props['aria-controls'] })
    assert.equal(panel.props['aria-labelledby'], 'ew-tab-' + expected)
    assert.equal(panel.props.hidden, false)
  }
  key('grading', 'ArrowRight', 'archive')
  key('archive', 'ArrowRight', 'grading')
  key('grading', 'ArrowLeft', 'archive')
  key('archive', 'Home', 'grading')
  key('grading', 'End', 'archive')
  let prevented = false
  act(() => f.tab('archive').props.onKeyDown({ key: 'Escape', preventDefault() { prevented = true } }))
  assert.equal(prevented, false)
  assert.equal(f.tab('archive').props['aria-selected'], true)
})

test('unavailable session storage falls back to grading and still permits tab changes', t => {
  const f = fixture(t, { failStorage: true })
  assert.equal(f.tab('grading').props['aria-selected'], true)
  act(() => f.tab('archive').props.onClick())
  assert.equal(f.tab('archive').props['aria-selected'], true)
  assert.deepEqual(f.mounts(), { grading: 1, archive: 1 })
})

test('built classic client parses and materializes only the unified plugin', () => {
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const entries = []
  new vm.Script(source, { filename: 'client.js' }).runInNewContext({ window: { __ModuleLoader__: { load(entry) { entries.push(entry) } } } }, { timeout: 1000 })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, '@local/dsh-exam-workbench')
  const required = []
  const plugin = entries[0].factory(name => { required.push(name); assert.equal(name, 'react'); return React })
  assert.deepEqual(required, ['react'])
  assert.equal(plugin.name, 'exam-workbench')
  const ctx = context()
  try {
    plugin.apply(ctx)
    assert.deepEqual(ctx.rows.map(row => [row.options.name, row.options.key || row.options.id]), [['main', 'exam-workbench'], ['sidebar.panellist', 'exam-workbench']])
    assert.equal(ctx.dictionaries.get('exam-workbench-archive-ui:en').title, 'Exam archive')
    assert.equal(ctx.rows[1].options.label(), '阅卷工作台')
  } finally { ctx.dispose() }
})

test('a legacy exam-archive locale namespace cannot fail Client activation and block DSH boot', t => {
  const ctx = context()
  const seen = new Set()
  const strict = {
    ...ctx.locale,
    register(namespace, language, values) {
      const key = namespace + ':' + language
      if (seen.has(key)) throw new Error(`locale namespace "${namespace}" already has locale "${language}"`)
      seen.add(key)
      return ctx.locale.register(namespace, language, values)
    },
  }
  // The legacy standalone exam-archive Client owns this namespace with zh and en.
  strict.register('exam-archive-ui', 'zh', { title: '旧归档' })
  strict.register('exam-archive-ui', 'en', { title: 'Legacy archive' })
  const warn = console.warn
  const warnings = []
  console.warn = (...args) => warnings.push(args)
  t.after(() => { console.warn = warn })
  const plugin = createUnifiedPlugin({ React, App: () => null, WorkbenchBoundary: React.Fragment, Icon: () => null,
    createArchiveView: () => ({ App: () => null, namespace: 'exam-archive-ui', dictionaries: { zh: { title: '归档' }, en: { title: 'Archive' } } }),
  })
  assert.doesNotThrow(() => plugin.apply({ ...ctx, locale: strict }))
  assert.deepEqual(ctx.rows.map(row => [row.options.name, row.options.key || row.options.id]), [['main', 'exam-workbench'], ['sidebar.panellist', 'exam-workbench']])
  assert.equal(ctx.dictionaries.get('exam-workbench-ui:zh').title, '阅卷工作台')
  assert.equal(ctx.dictionaries.get('exam-workbench-archive-ui:en').title, 'Archive')
  assert.deepEqual(warnings, [])
})

test('host mounts archive and grading once with separate stores and effect disposal, entirely offline', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-workbench-test-'))
  const previousHome = process.env.DSH_HOME
  const previousFetch = globalThis.fetch
  process.env.DSH_HOME = root
  globalThis.fetch = () => { throw new Error('Network is forbidden in this test') }
  const routes = [], disposed = [], cleanups = []
  const archiveRoot = path.join(root, 'archive-share')
  fs.mkdirSync(archiveRoot)
  t.after(() => {
    for (const cleanup of cleanups.reverse()) cleanup()
    globalThis.fetch = previousFetch
    if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('exam-workbench-test-'))
    fs.rmSync(root, { recursive: true, force: true })
  })
  const runtime = apply({ get() { return undefined }, inject(names, callback) {
    assert.deepEqual(names, ['webServer'])
    callback({ effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
      webServer: { register(route) { routes.push(route); return () => disposed.push(route.path) } } })
  } }, { archive: { archiveRoot, rosterDir: archiveRoot, sendReminders: false }, grading: { productionMarking: false, ameqpBase: 'https://offline.invalid/AMEQP/' } })
  assert.deepEqual(inject, ['llm', 'attachments'])
  assert.deepEqual(routes.map(route => route.path), ['/exam-archive', '/ameqp-grading'])
  async function get(url) {
    const route = routes.find(route => url.startsWith(route.path + '/'))
    const req = new PassThrough(); req.url = url; req.method = 'GET'
    let output
    const res = { statusCode: 200, setHeader() {}, end(value) { output = JSON.parse(String(value)) } }
    const pending = route.handler(req, res); req.end(); await pending
    assert.equal(res.statusCode, 200)
    return output
  }
  const archive = await get('/exam-archive/api/state')
  assert.equal(archive.ok, true)
  assert.equal(archive.settings.archiveRoot, archiveRoot)
  assert.equal(archive.settings.sendReminders, false)
  assert.deepEqual(archive.exams, [])
  const grading = await get('/ameqp-grading/api/accounts')
  assert.equal(grading.accounts.length, 1)
  assert.equal(grading.accounts[0].connected, false)
  assert.equal(grading.accounts[0].base, 'https://offline.invalid/AMEQP/')
  assert.ok(fs.existsSync(path.join(root, 'ameqp-grading')))
  assert.equal(archive.activeExam, null)
  assert.equal(typeof runtime.dispose, 'function')
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  assert.deepEqual(disposed.sort(), ['/ameqp-grading', '/exam-archive'])
})
