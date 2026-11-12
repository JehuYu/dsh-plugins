import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)

test('client.js 是普通脚本，只注册一个惰性 DSH 模块', async () => {
  const source = await readFile(new URL('client.js', root), 'utf8')
  const registrations = []
  // 不提供 React/DOM：真正的渲染由运行中的 DSH 客户端负责。
  new vm.Script(source, { filename: 'client.js' }).runInNewContext(
    { window: { __ModuleLoader__: { load: (entry) => registrations.push(entry) } } },
    { timeout: 1000 },
  )
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, '@local/dsh-score-analysis')
  assert.equal(typeof registrations[0].factory, 'function')
})

test('包导出运行期文件与展示资源', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  for (const key of ['.', './client', './icon']) {
    assert.ok((await readFile(new URL(pkg.exports[key], root))).length, `${key} 不应为空`)
  }
  for (const language of ['zh', 'en']) {
    const dict = JSON.parse(await readFile(new URL(`locale/${language}.json`, root), 'utf8'))
    assert.ok(dict.meta.title)
    assert.ok(dict.meta.description)
  }
})
