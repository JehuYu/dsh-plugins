import test from 'node:test'
import assert from 'node:assert/strict'
import cp from 'node:child_process'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { EventEmitter } from 'node:events'

// A non-existent path is sufficient: these cases must never create runtime data.
process.env.DSH_HOME = new URL(`.unused-${process.pid}`, import.meta.url).pathname
let externalCalls = 0
let writes = 0
cp.execFile = () => { externalCalls++; throw new Error('external process forbidden') }
fs.writeFileSync = () => { writes++; throw new Error('runtime write forbidden') }
fs.mkdirSync = () => { writes++; throw new Error('runtime directory forbidden') }
syncBuiltinESMExports()
const lesson = await import('../index.js')
const exam = await import('../../dsh-exam-workbench/archive-host.js')

function mount(apply, config = {}) {
  let handler
  const disposers = []
  const host = {
    webServer: { register(route) { handler = route.handler; return () => {} } },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
  }
  apply({ inject(keys, fn) { fn(host) }, effect: host.effect }, config)
  return { handler, close() { for (const dispose of disposers) dispose() } }
}
async function request(handler, url, method = 'GET') {
  const req = new EventEmitter()
  req.url = url
  req.method = method
  const res = { setHeader() {}, end(text) { this.body = JSON.parse(text); this.writableEnded = true } }
  await handler(req, res)
  return res
}

test('empty lesson config has no classes, courses, auto-recording, process or writes', async () => {
  const app = mount(lesson.apply)
  try {
    const res = await request(app.handler, '/lesson-tracker/api/state')
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body.classes, [])
    assert.deepEqual(res.body.today, [])
    assert.deepEqual(res.body.records, [])
    assert.equal(res.body.settings.autoRecord, false)
    assert.equal(res.body.teacher, '')
    assert.equal(res.body.subject, '')
    assert.equal(res.body.importPath, '')
    assert.equal(res.body.ppt.disabled, true)
  } finally { app.close() }
  assert.equal(externalCalls, 0)
  assert.equal(writes, 0)
})

test('configured lesson timetable uses only supplied generic entries', async () => {
  const app = mount(lesson.apply, {
    subject: '示例课程', periods: { 1: ['09:00', '09:40'] },
    classes: [{ name: '示例班', leader: '' }],
    courses: [{ d: new Date().getDay(), period: 1, className: '示例班' }],
  })
  try {
    const res = await request(app.handler, '/lesson-tracker/api/state')
    assert.equal(res.body.today.length, 1)
    assert.equal(res.body.today[0].className, '示例班')
    assert.equal(res.body.today[0].subject, '示例课程')
  } finally { app.close() }
  assert.equal(externalCalls, 0)
  assert.equal(writes, 0)
})

test('empty exam config lists no files and blocks sending or group calls', async () => {
  const app = mount(exam.apply)
  try {
    const res = await request(app.handler, '/exam-archive/api/state')
    assert.deepEqual(res.body.exams, [])
    assert.equal(res.body.roster.count, 0)
    assert.equal(res.body.settings.sendReminders, false)
    assert.equal((await request(app.handler, '/exam-archive/api/remind', 'POST')).statusCode, 400)
    const req = new EventEmitter()
    req.url = '/exam-archive/api/fetch'
    req.method = 'POST'
    const out = { setHeader() {}, end(text) { this.body = JSON.parse(text); this.writableEnded = true } }
    const done = app.handler(req, out)
    setImmediate(() => { req.emit('data', Buffer.from('{}')); req.emit('end') })
    await done
    assert.equal(out.body.ok, false)
    assert.match(out.body.error, /groupName/)
  } finally { app.close() }
  assert.equal(externalCalls, 0)
  assert.equal(writes, 0)
})
