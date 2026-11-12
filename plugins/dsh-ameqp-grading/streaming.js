export const PREVIEW_LIMIT = 24000
const RESPONSE_LIMIT = 1_000_000

export function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('评分已取消', 'AbortError')
}

export function newPreview(paperId) {
  return { paperId, text: '', chars: 0, status: 'waiting', updatedAt: null, truncated: false }
}

export function appendPreview(preview, delta) {
  if (!delta) return
  preview.chars += delta.length
  preview.text = (preview.text + delta).slice(-PREVIEW_LIMIT)
  preview.truncated = preview.chars > PREVIEW_LIMIT
  preview.status = 'streaming'
  preview.updatedAt = Date.now()
}

export function replacePreview(preview, text) {
  preview.chars = text.length
  preview.text = text.slice(-PREVIEW_LIMIT)
  preview.truncated = text.length > PREVIEW_LIMIT
  preview.status = 'streaming'
  preview.updatedAt = Date.now()
}

// Public scoring text only. Reasoning blocks are deliberately not projected
// into the output pane. A terminal abort/error must never become a valid score.
export async function collectText(stream, { onText, onSnapshot, signal } = {}) {
  const blocks = new Map()
  let size = 0
  for await (const chunk of stream) {
    throwIfAborted(signal)
    const index = chunk.index ?? 0
    let delta = ''
    if (chunk.type === 'text-delta') {
      const block = blocks.get(index) || { text: '', closed: false }
      if (block.closed) continue
      delta = chunk.text || ''
      if (typeof delta !== 'string') throw new Error('模型流式正文格式无效')
      block.text += delta
      size += delta.length
      blocks.set(index, block)
    } else if (chunk.type === 'block-end' && chunk.block?.type === 'text') {
      const block = blocks.get(index)
      if (block?.closed) continue
      // The completed block is authoritative, including missing/corrected deltas.
      // Replace the partial text rather than appending the same block twice.
      const previous = block?.text || ''
      const complete = chunk.block.text || previous
      if (typeof complete !== 'string') throw new Error('模型完整正文格式无效')
      size += complete.length - previous.length
      delta = complete.startsWith(previous) ? complete.slice(previous.length) : ''
      blocks.set(index, { text: complete, closed: true })
      if (size > RESPONSE_LIMIT) throw new Error('模型输出过长，请检查评分提示词')
      if (delta) onText?.(delta)
      onSnapshot?.([...blocks.entries()].sort(([a], [b]) => a - b).map(([, b]) => b.text).join(''))
      continue
    } else if (chunk.type === 'finish') {
      const kind = chunk.reason?.kind
      if (kind === 'error') throw new Error('模型调用失败：' + (chunk.reason.failure?.message || '未知错误'))
      if (kind === 'aborted') throw new DOMException('评分已取消', 'AbortError')
      if (kind && kind !== 'stop') throw new Error('模型输出未正常完成：' + kind)
      break
    }
    if (size > RESPONSE_LIMIT) throw new Error('模型输出过长，请检查评分提示词')
    if (delta) onText?.(delta)
  }
  throwIfAborted(signal)
  return [...blocks.entries()].sort(([a], [b]) => a - b).map(([, b]) => b.text).join('')
}

export async function collectChatCompletion(response, { onText, signal } = {}) {
  if (!(response.headers.get('content-type') || '').includes('text/event-stream')) {
    const result = await response.json()
    throwIfAborted(signal)
    if (result.error) throw new Error(result.error.message || '模型服务返回错误')
    const choice = result.choices?.[0]
    if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new Error('模型输出未正常完成：' + choice.finish_reason)
    const text = choice?.message?.content || ''
    if (typeof text !== 'string') throw new Error('模型未返回评分文本')
    if (text.length > RESPONSE_LIMIT) throw new Error('模型输出过长')
    onText?.(text)
    return text
  }
  const decoder = new TextDecoder()
  let pending = '', text = '', finished = false, ended = false
  function event(raw) {
    const data = raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (!data) return
    if (data.trim() === '[DONE]') { finished = true; ended = true; return }
    const value = JSON.parse(data)
    if (value.error) throw new Error(value.error.message || '模型服务返回错误')
    const choice = value.choices?.[0]
    if (choice?.finish_reason) {
      if (choice.finish_reason !== 'stop') throw new Error('模型输出未正常完成：' + choice.finish_reason)
      finished = true
    }
    const delta = choice?.delta?.content || ''
    if (typeof delta !== 'string') throw new Error('模型流式正文格式无效')
    if (delta) {
      text += delta
      if (text.length > RESPONSE_LIMIT) throw new Error('模型输出过长')
      onText?.(delta)
    }
  }
  function drain() {
    let boundary
    while ((boundary = /\r?\n\r?\n/.exec(pending))) {
      const raw = pending.slice(0, boundary.index)
      pending = pending.slice(boundary.index + boundary[0].length)
      event(raw)
      if (ended) { pending = ''; break }
    }
    if (pending.length > RESPONSE_LIMIT) throw new Error('模型流式事件过长')
  }
  if (!response.body) throw new Error('模型返回空响应流')
  for await (const bytes of response.body) {
    throwIfAborted(signal)
    pending += decoder.decode(bytes, { stream: true })
    drain()
    if (ended) break
  }
  pending += decoder.decode()
  drain()
  if (pending.trim()) event(pending)
  throwIfAborted(signal)
  if (!finished) throw new Error('模型流连接提前中断，请重试当前答卷')
  return text
}
