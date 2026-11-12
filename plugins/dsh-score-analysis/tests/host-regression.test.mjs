import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'

import {
  buildAnalysisDisplayName,
  buildTeachingAdvice,
  buildTeachingClassMappingRows,
  findScoreWorkbookEntry,
  formatAnalysisError,
  sanitizeAttachmentName,
} from '../index.js'
import { readZipEntries, writeXlsxRows } from '../xlsx-reader.js'

test('从成绩平台压缩包里挑出小题分工作簿', () => {
  const names = [
    '2026高一期中/全体报表/小题分(技术（选）).xls',
    '2026高一期中/全体报表/小题分(信息).xls',
    '2026高一期中/全体报表/分班表.xlsx',
    '2026高一期中/学校汇总/小题分(通用).xls',
  ]
  assert.equal(findScoreWorkbookEntry(names), '2026高一期中/全体报表/小题分(技术（选）).xls')
  assert.equal(findScoreWorkbookEntry(['a/全体报表/小题分(信息).xls']), 'a/全体报表/小题分(信息).xls')
  assert.equal(findScoreWorkbookEntry(['a/b.xls']), null)
})

test('压缩包显示名与旧站一致', () => {
  assert.equal(
    buildAnalysisDisplayName('20250416高一下学期期中考试_原始成绩.zip', '全体报表/小题分(技术（选）).xls'),
    '高一下学期期中考试+技术（选）',
  )
  assert.equal(buildAnalysisDisplayName('小题分(技术（选）).xls'), '小题分(技术（选）)')
})

test('附件名带扩展名且长度受限', () => {
  assert.equal(sanitizeAttachmentName('高一期中', '.zip'), '高一期中.zip')
  assert.equal(sanitizeAttachmentName('高一期中.zip', '.zip'), '高一期中.zip')
  assert.ok(sanitizeAttachmentName('长'.repeat(300), '.zip').length <= 150)
})

test('教学班映射把信息班排在通用班之前', () => {
  const rows = buildTeachingClassMappingRows([
    { name: '通用1', students: [{ name: '张三', homeClass: '1' }] },
    { name: '信息1', students: [{ name: '张三', homeClass: '1' }] },
  ])
  assert.deepEqual(rows, [{ 班级: '1', 姓名: '张三', 教学班1: '信息1', 教学班2: '通用1' }])
})

test('教学建议挑出最低分小题与关注班级', () => {
  const advice = buildTeachingAdvice({
    info_analysis: {
      columns: ['班级', '信息', '信选1', '信选2'],
      data: [{ 班级: '总平均值', 信息: 10, 信选1: 1.2, 信选2: 0.4 }],
    },
    general_analysis: {
      columns: ['班级', '通用', '通选1'],
      data: [{ 班级: '总平均值', 通用: 20, 通选1: 1.6 }],
    },
    class_averages: {
      columns: ['班级', '全卷', '信息', '通用'],
      data: [
        { 班级: '总平均值', 全卷: 30, 信息: 10, 通用: 20 },
        { 班级: '2', 全卷: 28, 信息: 9, 通用: 19 },
        { 班级: '1', 全卷: 24, 信息: 8, 通用: 16 },
      ],
    },
  })
  assert.equal(advice.lowQuestions[0].question, '信选2')
  assert.equal(advice.weakClasses[0].className, '1')
  assert.equal(advice.subjectFocus.subject, '信息')
  assert.equal(advice.summaryCards.length, 3)
})

test('已知 Python 依赖错误会翻译成中文提示', () => {
  const missing = formatAnalysisError({ message: "ModuleNotFoundError: No module named 'pandas'" })
  assert.equal(missing.statusCode, 500)
  assert.match(missing.message, /pandas/)
  const wrongFile = formatAnalysisError({ message: '成绩表列数不足，未找到完整的学生基础字段。' })
  assert.equal(wrongFile.statusCode, 400)
})

test('工作目录被删除时不再把本机路径抛给用户', () => {
  const enoent = Object.assign(
    new Error(
      "ENOENT: no such file or directory, open 'C:\\Users\\example-user\\.dsh\\score-analysis\\outputs\\job_小题分_技术_.xls'",
    ),
    { code: 'ENOENT' },
  )
  const formatted = formatAnalysisError(enoent)
  assert.equal(formatted.statusCode, 500)
  assert.doesNotMatch(formatted.message, /ENOENT|C:\\Users/)
  assert.match(formatted.message, /工作目录不存/)

  const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
  assert.match(formatAnalysisError(denied).message, /权限/)

  const full = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
  assert.equal(formatAnalysisError(full).statusCode, 507)
})

test('.xlsx 写入后能被自己的 ZIP 读取器读回', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'score-analysis-'))
  try {
    const file = join(dir, 'map.xlsx')
    await writeXlsxRows(file, [['班级', '姓名'], ['1', '张三']], '教学班映射')
    const entries = await readZipEntries(await readFile(file))
    const names = entries.map((entry) => entry.name)
    for (const required of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']) {
      assert.ok(names.includes(required), `缺少 ${required}`)
    }
    const sheet = await entries.find((entry) => entry.name === 'xl/worksheets/sheet1.xml').read()
    assert.match(sheet.toString('utf8'), /张三/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('压缩包读取器拒绝非 ZIP 内容', async () => {
  await assert.rejects(() => readZipEntries(Buffer.from('not a zip at all, but long enough')), /ZIP|压缩包/)
})

test('deflateRawSync 产物与读取器的解压路径一致', async () => {
  const payload = Buffer.from('hello score analysis')
  const compressed = deflateRawSync(payload)
  assert.equal(compressed.length > 0, true)
})
