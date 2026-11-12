/**
 * dsh-sanview-studio — Host half.
 *
 * 三视图工作台（Sanview Studio）是一个零依赖的独立绘图应用：引擎、渲染、
 * 工程库和三维模型解析都在浏览器内完成，没有任何服务端逻辑。因此 Host 侧
 * 只做一件事：把 `dist/` 以只读静态资源的方式挂在 Harness 的 webServer 上，
 * 并在返回 `index.html` 时注入一层「Harness 主题适配」样式与桥接脚本。
 *
 * 为什么不改 dist/：那是用户自己的项目产物，插件不应改写它。注入发生在
 * 响应阶段，源文件保持原样；卸载插件即恢复原状。
 *
 * 路由：`<basePath>/`（默认 /sanview-studio/），只接受 GET/HEAD。
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

/** 找到一份可用的静态资源目录。 */
function resolveRoot(config) {
  const candidates = []
  if (typeof config.distPath === 'string' && config.distPath.trim()) {
    candidates.push(resolve(config.distPath.trim()))
  }
  // 独立发布包优先使用自带的绘图应用，开发目录作为后备。
  candidates.push(join(HERE, 'embed'))
  candidates.push(resolve(HERE, '..', '..', 'dist'))
  for (const candidate of candidates) {
    try {
      if (statSync(join(candidate, 'index.html')).isFile()) return candidate
    } catch {
      /* 继续尝试下一个候选 */
    }
  }
  return undefined
}

function readInjected(file) {
  try {
    return readFileSync(join(HERE, file), 'utf8')
  } catch {
    return ''
  }
}

/**
 * 注入内容按修改时间缓存：改主题层不需要重启插件，也不必每次请求都重读文件。
 * `dsh` 是资源目录，改动极少；两次 stat 的成本低于一次读盘。
 */
function injectedReader(file) {
  let stamp = -1
  let text = ''
  return () => {
    let mtime = 0
    try {
      mtime = statSync(join(HERE, file)).mtimeMs
    } catch {
      return ''
    }
    if (mtime !== stamp) {
      stamp = mtime
      text = readInjected(file)
    }
    return text
  }
}

export function apply(ctx, config = {}) {
  const options = config && typeof config === 'object' ? config : {}
  const root = resolveRoot(options)
  if (!root) {
    const warn = ctx.logger?.('warn')
    const message = 'sanview-studio: 未找到 dist/index.html，请在 config.distPath 指向三视图的 dist 目录'
    if (typeof warn === 'function') warn(message)
    else console.warn(message)
    return
  }

  const basePath = ('/' + String(options.basePath || '/sanview-studio').replace(/^\/+|\/+$/g, '')).replace(/\/+$/, '')
  const styleOf = injectedReader('embed-theme.css')
  const bridgeOf = injectedReader('embed-bridge.js')

  /** 主题样式与桥接脚本插在 </head> 之前，晚于应用自身的样式表。 */
  function decorate(html) {
    const style = styleOf()
    const bridge = bridgeOf()
    const head = style ? `<style id="dsh-sanview-theme">${style}</style>` : ''
    const script = bridge ? `<script id="dsh-sanview-bridge">${bridge}</script>` : ''
    const tag = `<meta name="dsh-embed" content="sanview-studio">${head}${script}`
    const at = html.search(/<\/head\s*>/i)
    return at < 0 ? tag + html : html.slice(0, at) + tag + html.slice(at)
  }

  function send(res, status, body, headers = {}) {
    res.writeHead(status, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    })
    res.end(body)
  }

  async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' })
      return
    }

    let pathname
    try {
      pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname)
    } catch {
      send(res, 400, 'Bad request')
      return
    }

    // `/sanview-studio` 补斜杠，否则页面里的相对路径会指向上一级。
    if (pathname === basePath) {
      send(res, 302, '', { Location: `${basePath}/` })
      return
    }

    let rel = pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : '/'
    if (!rel.startsWith('/')) rel = `/${rel}`
    if (rel.endsWith('/')) rel += 'index.html'

    let target = resolve(root, `.${rel}`)
    if (target !== root && !target.startsWith(root + sep)) {
      send(res, 403, 'Forbidden')
      return
    }

    try {
      const info = statSync(target)
      if (info.isDirectory()) target = resolve(target, 'index.html')
    } catch {
      send(res, 404, 'Not found')
      return
    }

    const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream'
    try {
      if (extname(target).toLowerCase() === '.html') {
        const html = decorate(readFileSync(target, 'utf8'))
        send(res, 200, req.method === 'HEAD' ? '' : html, {
          'Content-Type': type,
          'Content-Length': Buffer.byteLength(html),
        })
        return
      }
      const body = readFileSync(target)
      send(res, 200, req.method === 'HEAD' ? '' : body, {
        'Content-Type': type,
        'Content-Length': body.length,
      })
    } catch {
      send(res, 500, 'Read failed')
    }
  }

  ctx.inject(['webServer'], (host) => {
    host.effect(
      () => host.webServer.register({ kind: 'prefix', path: basePath, handler: handle }),
      'sanview-studio: static workspace',
    )
  })
}
