import test from 'node:test'
import assert from 'node:assert/strict'
import { extractJson } from '../json-output.js'

const validate = (value) => {
  if (!Array.isArray(value.criteria)) throw new Error('Missing criteria')
  return value
}

test('JSON extraction skips unrelated or invalid braces before a grading result', () => {
  for (const prefix of ['说明 {示例}，结果如下：', '说明 {}，结果如下：', '说明 {"note":"仅说明"}，结果如下：']) {
    assert.deepEqual(extractJson(prefix + '{"criteria":[]}', { validate }), { criteria: [] })
  }
})

test('fenced JSON works even after an unmatched brace in the explanatory prefix', () => {
  assert.deepEqual(extractJson('说明 { 未闭合\n```json\n{"criteria":[]}\n```', { validate }), { criteria: [] })
})

test('quoted braces and escaped quotes are preserved inside evidence text', () => {
  const expected = { criteria: [{ id: 'one', score: 1, image_evidence: '标注为 "{a}"，另一处为 }' }] }
  assert.deepEqual(extractJson('评分：' + JSON.stringify(expected), { validate }), expected)
})

test('repeated identical complete results are accepted without combining them', () => {
  assert.deepEqual(extractJson('{"criteria":[]}\n{"criteria":[]}', { validate }), { criteria: [] })
})

test('conflicting complete results are rejected instead of choosing a score', () => {
  assert.throws(() => extractJson('{"criteria":[{"score":1}]}\n{"criteria":[{"score":2}]}', { validate }), /相互冲突/)
})

test('invalid, incomplete or non-object JSON is never repaired into a score', () => {
  for (const text of ['{"criteria":[],}', '{"criteria":[', '{“criteria”:[]}', '[]', 'null', '解释而无结果']) {
    assert.throws(() => extractJson(text, { validate }))
  }
})

test('parse failures retain bounded original output for local diagnostics', () => {
  try { extractJson('{"criteria":['); assert.fail('Expected incomplete JSON failure') }
  catch (error) { assert.equal(error.modelOutput, '{"criteria":[') }
  assert.throws(() => extractJson('x'.repeat(1_000_001)), /过长/)
})
