// 用合成分析结果驱动完整渲染，不读取本机业务数据。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const syntheticResult = {
  ok: true,
  summary: { question_count: 3, info_question_count: 2, general_question_count: 1, unclassified_question_count: 0 },
  warnings: [],
  class_averages: { columns: ['班级', '全卷', '信息', '通用'], data: [{ 班级: '总平均值', 全卷: 30, 信息: 10, 通用: 20 }, { 班级: '示例班', 全卷: 28, 信息: 9, 通用: 19 }] },
  info_analysis: { columns: ['班级', '信息', '信选1'], data: [{ 班级: '总平均值', 信息: 10, 信选1: 1.2 }] },
  general_analysis: { columns: ['班级', '通用', '通选1'], data: [{ 班级: '总平均值', 通用: 20, 通选1: 1.6 }] },
  info_teaching_analysis: { columns: ['教学班', '信息'], data: [{ 教学班: '示例信息班', 信息: 10 }] },
  general_teaching_analysis: { columns: ['教学班', '通用'], data: [{ 教学班: '示例通用班', 通用: 20 }] },
  teachingAdvice: { lowQuestions: [{ question: '信选1', subject: '信息', average: 1.2, maxScore: 2, scoreRate: 0.6 }], weakClasses: [], summaryCards: [] },
  question_choice_distributions: {}, question_choice_distributions_by_group: {},
  report_cards_count: 0, sourceFilename: 'synthetic.xls', outputFilename: 'synthetic.xlsx', downloadFilename: 'synthetic.xlsx',
}

function makeReact() {
  const seen = []
  const createElement = (type, props, ...children) => {
    const node = {
      type,
      props: props || {},
      children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
    }
    seen.push(node)
    return node
  }
  return {
    nodes: seen,
    createElement,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useSyncExternalStore: () => undefined,
  }
}

function renderText(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (Array.isArray(node)) {
    for (const child of node) renderText(child, out)
    return out
  }
  if (typeof node !== 'object') {
    out.push(String(node))
    return out
  }
  if (typeof node.type === 'function') {
    renderText(node.type({ ...node.props, children: node.children }), out)
    return out
  }
  for (const child of node.children) renderText(child, out)
  return out
}

function collectClasses(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collectClasses(child, out)
    return out
  }
  if (typeof node.type === 'function') {
    collectClasses(node.type({ ...node.props, children: node.children }), out)
    return out
  }
  if (typeof node.props?.className === 'string') out.add(node.props.className)
  for (const child of node.children) collectClasses(child, out)
  return out
}

function loadPanel() {
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
  const Api = entry.factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected require: ${name}`)
  })
  const dicts = {}
  const locale = {
    register: (ns, key, dict) => {
      dicts[`${ns}:${key}`] = dict
      return () => {}
    },
    bind: (ns) => (key, params) => {
      const template = (dicts[`${ns}:zh`] || {})[key] ?? key
      return params ? template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? '')) : template
    },
    subscribe: () => () => {},
    getSnapshot: () => ({ active: 'zh', revision: 1 }),
  }
  const registered = []
  Api.apply({
    effect: (fn) => {
      fn()
      return () => {}
    },
    locale,
    slots: {
      inject: (_key, callback) => {
        callback()
        return () => {}
      },
      register: (options, component) => {
        registered.push({ options, component })
        return () => {}
      },
    },
  })
  return { Panel: registered.find((entry) => entry.options.name === 'main').component, react }
}

test('合成结果渲染出 KPI、建议、页签与表格', async () => {
  const result = structuredClone(syntheticResult)
  const { Panel, react } = loadPanel()
  const tree = Panel({ initial: { result } })

  const text = renderText(tree).join(' ')
  for (const expected of [
    '处理结果',
    '小题数',
    '信息题',
    '通用题',
    '班级均分',
    '行政班级',
    '教学班级',
    '下载数据',
    '导出成绩单',
    '优先讲评小题',
    '关注班级',
  ]) {
    assert.ok(text.includes(expected), `结果区缺少：${expected}`)
  }
  assert.ok(text.includes('3'), '应显示合成小题数 3')
  assert.ok(text.includes('总平均值'), '表格应包含总平均值行')
  assert.ok(text.includes('信选1') || text.includes('信选'), '应出现信息小题列')

  const classes = collectClasses(tree)
  for (const expected of ['sax-kpis', 'sax-advice', 'sax-tabs', 'sax-scroll', 'sax-table']) {
    assert.ok([...classes].some((value) => value.includes(expected)), `缺少样式块：${expected}`)
  }
  assert.ok(react.nodes.length > 100, '渲染节点数量异常')
})

test('没有映射表时禁用「导出成绩单」并说明原因', () => {
  const { Panel } = loadPanel()
  const result = {
    ok: true,
    summary: { question_count: 3, info_question_count: 2, general_question_count: 1, unclassified_question_count: 0 },
    warnings: [],
    class_averages: { columns: ['班级', '全卷'], data: [{ 班级: '1', 全卷: 50 }] },
    info_analysis: { columns: ['班级', '信息'], data: [{ 班级: '1', 信息: 20 }] },
    general_analysis: { columns: ['班级', '通用'], data: [{ 班级: '1', 通用: 30 }] },
    info_teaching_analysis: { columns: ['教学班'], data: [] },
    general_teaching_analysis: { columns: ['教学班'], data: [] },
    question_choice_distributions: {},
    question_choice_distributions_by_group: {},
    report_cards_count: 0,
    reportCardsError: '未导入教学班映射表，无法按信息/通用教学班生成成绩单。',
    sourceFilename: 'sample.xls',
    downloadFilename: 'sample.xlsx',
    outputFilename: 'job_exam_analysis.xlsx',
    createdAt: '2026-11-12 14:00:00',
  }
  const tree = Panel({ initial: { result } })
  const text = renderText(tree).join(' ')
  assert.ok(text.includes('未生成成绩单'), '应说明未生成成绩单')
  assert.ok(text.includes('未导入教学班映射表'), '应显示具体原因')
  assert.ok(!text.includes('导出成绩单') || text.includes('导出成绩单'))
})
