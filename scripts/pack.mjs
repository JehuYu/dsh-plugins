import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'release')
fs.mkdirSync(output, { recursive: true })
const pnpmIndex = process.argv.indexOf('--pnpm')
const pnpm = pnpmIndex >= 0 ? process.argv[pnpmIndex + 1] : null
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
if (!pnpm && !fs.existsSync(npmCli)) throw new Error('npm CLI unavailable: run via npm run pack or pass --pnpm <pnpm script path>')
const sums = []
const manifest = []
for (const slug of fs.readdirSync(path.join(root, 'plugins'))) {
  const dir = path.join(root, 'plugins', slug)
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const filename = pkg.name.replace(/^@/, '').replace('/', '-') + '-' + pkg.version + '.tgz'
  const result = spawnSync(process.execPath, [pnpm || npmCli, 'pack', '--pack-destination', output], { cwd: dir, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Packing failed: ${slug}`)
  const file = path.join(output, filename)
  const bytes = fs.readFileSync(file)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  sums.push(`${sha256}  ${filename}`)
  manifest.push({ plugin: slug, name: pkg.name, version: pkg.version, file: filename, sha256, bytes: bytes.length })
}
fs.writeFileSync(path.join(output, 'SHA256SUMS'), sums.join('\n') + '\n')
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`Packed ${manifest.length} plugins in ${output}`)
