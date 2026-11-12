import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)
test('client is a classic script that only registers a lazy DSH module', async () => {
  const source = await readFile(new URL('client.js', root), 'utf8')
  const registrations = []
  // No React or DOM shim: materialization and rendering belong to the live DSH client.
  new vm.Script(source, { filename: 'client.js' }).runInNewContext({
    window: { __ModuleLoader__: { load: entry => registrations.push(entry) } },
  }, { timeout: 1000 })
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, '@local/dsh-exam-archive')
  assert.equal(typeof registrations[0].factory, 'function')
})

test('linked bundle exports its runtime and display resources', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  for (const key of ['.', './client', './icon']) {
    assert.ok((await readFile(new URL(pkg.exports[key], root))).length)
  }
  for (const language of ['zh', 'en']) {
    const dict = JSON.parse(await readFile(new URL(`locale/${language}.json`, root), 'utf8'))
    assert.ok(dict.meta.title)
    assert.ok(dict.meta.description)
  }
})
