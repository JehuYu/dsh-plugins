import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { createAccountRuntime } from '../grading-host.js'

function fixture(t, text) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grading-recovery-storage-'))
  const journal = path.join(root, 'task-journal.json')
  if (text !== undefined) fs.writeFileSync(journal, text)
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('Network is forbidden in storage regression tests') })
  const runtime = createAccountRuntime({ get() { return null } }, {}, { dataDir: root })
  t.after(() => {
    runtime.dispose()
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('grading-recovery-storage-'))
    fs.rmSync(root, { recursive: true, force: true })
  })
  async function call(operation, body = {}) {
    const request = new PassThrough()
    request.method = 'POST'; request.url = '/ameqp-grading/api/' + operation
    let output
    const response = { statusCode: 200, setHeader() {}, end(value) { output = JSON.parse(String(value)) } }
    const pending = runtime.handler(request, response)
    request.end(JSON.stringify(body)); await pending
    return { code: response.statusCode, body: output }
  }
  return { runtime, journal, call }
}

for (const text of ['{broken', 'null', '[]', '{}', '{"pending":"false"}']) {
  test('malformed recovery journal blocks claims and preserves original bytes: ' + text, async t => {
    const f = fixture(t, text)
    assert.equal(f.runtime.view().recovery.pending, true)
    assert.equal(f.runtime.view().recovery.storageError, true)
    for (const operation of ['start', 'paper-load', 'marking-get', 'marking-auto-start']) {
      const result = await f.call(operation, { exam: 1, subject: 2, question: 3 })
      assert.ok(result.code >= 400, operation)
      assert.match(result.body.error, /恢复记录|未确认答卷/)
    }
    const resolution = await f.call('recovery-resolve', { ansQueSN: null, resolution: 'confirmed_cancelled', note: 'cannot bypass corrupt storage' })
    assert.ok(resolution.code >= 400); assert.match(resolution.body.error, /无法读取/)
    f.runtime.dispose()
    assert.equal(fs.readFileSync(f.journal, 'utf8'), text)
  })
}

test('only missing or explicitly completed journals start without recovery', t => {
  assert.equal(fixture(t).runtime.view().recovery, null)
  assert.equal(fixture(t, '{"version":1,"pending":false}').runtime.view().recovery, null)
})

test('valid held claim survives loading and remains pending', t => {
  const journal = { version: 1, pending: true, claim: { ansQueSN: 42, selection: { exam: 1, subject: 2, question: 3 } } }
  const f = fixture(t, JSON.stringify(journal))
  assert.deepEqual(f.runtime.view().recovery, journal)
})
