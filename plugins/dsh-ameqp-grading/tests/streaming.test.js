import test from 'node:test'
import assert from 'node:assert/strict'
import { appendPreview, replacePreview, newPreview, PREVIEW_LIMIT, collectText, collectChatCompletion } from '../streaming.js'

test('stream preview is bounded and reports received characters', () => {
  const preview = newPreview(10)
  appendPreview(preview, 'a'.repeat(PREVIEW_LIMIT + 20))
  assert.equal(preview.text.length, PREVIEW_LIMIT)
  assert.equal(preview.chars, PREVIEW_LIMIT + 20)
  assert.equal(preview.truncated, true)
  assert.equal(preview.status, 'streaming')
})

test('aborted and truncated harness finishes never produce a score body', async () => {
  for (const kind of ['aborted', 'length', 'tool-calls']) {
    async function* stream() { yield { type: 'text-delta', text: '{}' }; yield { type: 'finish', reason: { kind } } }
    await assert.rejects(collectText(stream()))
  }
})

test('public text callback excludes reasoning and ignores duplicate completed blocks', async () => {
  const updates = []
  async function* stream() {
    yield { type: 'reasoning-delta', index: 0, text: 'PRIVATE_REASONING' }
    yield { type: 'text-delta', index: 1, text: '{"score":2}' }
    yield { type: 'block-end', index: 1, block: { type: 'text', text: '{"score":2}' } }
    yield { type: 'block-end', index: 1, block: { type: 'text', text: '{"score":2}' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  assert.equal(await collectText(stream(), { onText: (s) => updates.push(s) }), '{"score":2}')
  assert.deepEqual(updates, ['{"score":2}'])
})

function response(text, width = 3) {
  const bytes = new TextEncoder().encode(text)
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += width) controller.enqueue(bytes.slice(i, i + width))
    controller.close()
  } }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
}

test('SSE decoder handles split UTF-8, CRLF, keepalive, finish and DONE', async () => {
  const updates = []
  const body = ': ping\r\n\r\ndata: {"choices":[{"delta":{"content":"结"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"果"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n'
  assert.equal(await collectChatCompletion(response(body), { onText: (s) => updates.push(s) }), '结果')
  assert.deepEqual(updates, ['结', '果'])
})

test('SSE lost connection, service errors and output cap are surfaced', async () => {
  await assert.rejects(collectChatCompletion(response('data: {"choices":[{"delta":{"content":"{}"}}]}\n\n')), /提前中断/)
  await assert.rejects(collectChatCompletion(response('data: {"error":{"message":"busy"}}\n\n')), /busy/)
  await assert.rejects(collectChatCompletion(response('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n')), /length/)
})

test('compatible non-streaming JSON fallback is projected once', async () => {
  const updates = []
  const response = new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } })
  assert.equal(await collectChatCompletion(response, { onText: (s) => updates.push(s) }), '{}')
  assert.deepEqual(updates, ['{}'])
})

test('a complete text block replaces missing deltas and updates the preview without duplication', async () => {
  const expected = '{"criteria":[]}'
  const preview = newPreview(1)
  async function* chunks() {
    yield { type: 'text-delta', index: 0, text: '{"criteria":[' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: expected } }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: expected } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  assert.equal(await collectText(chunks(), { onText: (delta) => appendPreview(preview, delta), onSnapshot: (text) => replacePreview(preview, text) }), expected)
  assert.equal(preview.text, expected)
  assert.equal(preview.chars, expected.length)
})

test('authoritative corrections and out-of-order blocks produce one ordered final result', async () => {
  const preview = newPreview(1)
  async function* chunks() {
    yield { type: 'text-delta', index: 1, text: ']}' }
    yield { type: 'text-delta', index: 0, text: 'broken partial text' }
    yield { type: 'block-end', index: 1, block: { type: 'text', text: ']}' } }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"criteria":[' } }
  }
  const result = await collectText(chunks(), { onText: (delta) => appendPreview(preview, delta), onSnapshot: (text) => replacePreview(preview, text) })
  assert.equal(result, '{"criteria":[]}')
  assert.equal(preview.text, result)
})

test('empty block-end text does not erase received deltas and completed text still obeys the output cap', async () => {
  async function* emptyEnd() { yield { type: 'text-delta', text: '{}' }; yield { type: 'block-end', block: { type: 'text', text: '' } } }
  assert.equal(await collectText(emptyEnd()), '{}')
  async function* oversized() { yield { type: 'text-delta', text: '{}' }; yield { type: 'block-end', block: { type: 'text', text: 'x'.repeat(1_000_001) } } }
  await assert.rejects(collectText(oversized()), /过长/)
})
