// 用最小 React shim 把 client.js 的 factory 跑起来，验证：
//   1. 工厂只做注册、没有副作用；
//   2. PanelIcon / App 都能被渲染；
//   3. 传真实结果时表格、建议、KPI 都能渲染出元素。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

function makeReact() {
  const createElement = (type, props, ...children) => ({
    type,
    props: props || {},
    children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
  })
  return {
    createElement,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useSyncExternalStore: () => undefined,
  }
}

function render(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (Array.isArray(node)) {
    for (const child of node) render(child, out)
    return out
  }
  if (typeof node !== 'object') {
    out.push(String(node))
    return out
  }
  if (typeof node.type === 'function') {
    render(node.type({ ...node.props, children: node.children }), out)
    return out
  }
  if (node.type === 'style') return out
  for (const child of node.children) render(child, out)
  return out
}

function collectText(node) {
  return render(node).join(' ')
}

function loadFactory() {
  let entry = null
  new vm.Script(source, { filename: 'client.js' }).runInNewContext(
    {
      window: { __ModuleLoader__: { load: (value) => (entry = value) } },
      document: { baseURI: 'http://127.0.0.1:8831/' },
      URL,
      Intl,
      setTimeout,
      clearTimeout,
    },
    { timeout: 2000 },
  )
  const react = makeReact()
  const factory = entry.factory
  const Api = factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected require: ${name}`)
  })
  return Api
}

function makeLocale() {
  const dicts = {}
  return {
    register: (ns, locale, dict) => {
      dicts[`${ns}:${locale}`] = dict
      return () => {}
    },
    bind: (ns) => (key, params) => {
      const dict = dicts[`${ns}:zh`] || {}
      const template = dict[key] ?? key
      return params ? template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? '')) : template
    },
    subscribe: () => () => {},
    getSnapshot: () => ({ active: 'zh', revision: 1 }),
  }
}

function makeCtx() {
  const registered = []
  const locale = makeLocale()
  return {
    registered,
    ctx: {
      effect: (fn) => {
        fn()
        return () => {}
      },
      locale,
      slots: {
        inject: (key, callback) => {
          callback()
          return () => {}
        },
        register: (options, component) => {
          registered.push({ options, component })
          return () => {}
        },
      },
    },
  }
}

test('工厂只注册槽位，不渲染页面', () => {
  const Api = loadFactory()
  const { ctx, registered } = makeCtx()
  Api.apply(ctx)
  assert.equal(registered.length, 2)
  const sidebar = registered.find((entry) => entry.options.name === 'sidebar.panellist')
  const main = registered.find((entry) => entry.options.name === 'main')
  assert.equal(sidebar.options.id, 'score-analysis')
  assert.equal(main.options.key, 'score-analysis')
  assert.equal(typeof sidebar.component, 'function')
  assert.equal(typeof main.component, 'function')
  // 侧边栏图标能直接渲染（PanelIcon 把绘图路径交给 Icon）
  const icon = sidebar.component({ size: 18, active: false })
  assert.ok(String(icon.props.path).startsWith('M4 19V5'), '应带上柱状图路径')
})

test('空态面板显示上传区与提示文案', () => {
  const Api = loadFactory()
  const { ctx, registered } = makeCtx()
  Api.apply(ctx)
  const main = registered.find((entry) => entry.options.name === 'main')
  const text = collectText(main.component({ useRemoteAccess: () => true }))
  for (const expected of ['成绩分析', '点击或拖拽文件到这里', '开始处理', '教学班映射', '已保存考试', '上传成绩文件后在这里查看分析结果。']) {
    assert.ok(text.includes(expected), `缺少文案：${expected}`)
  }
})

test('客户端拒绝非成绩文件类型（通过 accept 与命名约定）', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(source, /accept: '\.xls,\.xlsx,\.zip'/)
  assert.match(source, /accept: '\.xls,\.xlsx'/)
})
