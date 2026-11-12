import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const plugins = path.join(root, 'plugins')
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => ['node_modules', '.git', '__pycache__'].includes(e.name) ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])
let count = 0
for (const slug of fs.readdirSync(plugins)) {
  const dir = path.join(plugins, slug)
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  assert(pkg.dsh?.bundle?.patch, `${slug}: missing bundle`)
  for (const f of [pkg.exports['.'], pkg.exports['./client'], pkg.dsh.bundle.patch, 'README.md', 'LICENSE']) assert(fs.existsSync(path.join(dir, f)), `${slug}: missing ${f}`)
  const patch = fs.readFileSync(path.join(dir, pkg.dsh.bundle.patch), 'utf8')
  assert(patch.includes(pkg.name), `${slug}: patch module name mismatch`)
  for (const f of walk(dir)) {
    if (/\.(?:js|mjs|cjs)$/.test(f)) {
      const result = spawnSync(process.execPath, ['--check', f], { stdio: 'inherit' })
      assert.equal(result.status, 0, `${f}: syntax error`)
      count++
    }
    if (f.endsWith('.json')) JSON.parse(fs.readFileSync(f, 'utf8'))
    if (/\.(?:js|mjs|cjs|json|yml|md|py|css|html|txt)$/.test(f)) {
      const text = fs.readFileSync(f, 'utf8')
      for (const forbidden of [/[A-Z]:(?:\\\\?|\/)(?:Documents|project)(?:\\\\?|\/)/i, /https?:\/\/(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(?:[:/]|\b)/, /(?:ghp_|github_pat_)[A-Za-z0-9_]{25,}/, /-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/]) assert(!forbidden.test(text), `${path.relative(root, f)}: private configuration or credential pattern`)
    }
  }
  const module = await import(pathToFileURL(path.join(dir, pkg.exports['.'])).href)
  assert.equal(typeof module.apply, 'function', `${slug}: missing host entry`)
  console.log(`OK ${slug}: manifest, syntax, privacy patterns, host import`)
}
// Verify the standalone drawing package actually serves its embedded application and dependencies.
const { apply } = await import(pathToFileURL(path.join(plugins, 'dsh-sanview-studio/index.js')).href)
let handler
const host = { effect(fn) { return fn() }, webServer: { register(route) { handler = route.handler; return () => {} } } }
apply({ inject(_names, fn) { fn(host) } })
assert(handler, 'Sanview route was not registered')
const request = async url => {
  const response = { writeHead(status, headers) { this.status = status; this.headers = headers }, end(body) { this.body = body } }
  await handler({ method: 'GET', url }, response)
  return response
}
const html = await request('/sanview-studio/')
assert.equal(html.status, 200)
assert(String(html.body).includes('dsh-sanview-theme'))
for (const match of String(html.body).matchAll(/(?:src|href)="([^"#]+\.(?:js|css)(?:\?[^\"]*)?)"/g)) {
  const response = await request('/sanview-studio/' + match[1])
  assert.equal(response.status, 200, `Missing embedded resource ${match[1]}`)
}
assert.equal((await request('/sanview-studio/missing-file.js')).status, 404)
console.log(`PASS: ${count} JavaScript sources; six host imports; embedded Sanview HTTP/resources`)
