// Extract complete model JSON without changing scores or repairing broken JSON.
const OUTPUT_LIMIT = 1_000_000
function outputError(message, code) { return Object.assign(new Error(message), { code }) }

export function extractJson(text, { validate } = {}) {
  const source = String(text || '').trim()
  try {
    if (source.length > OUTPUT_LIMIT) throw outputError('模型输出过长', 'MODEL_JSON_LIMIT')
    let direct, parsed = false
    try { direct = JSON.parse(source); parsed = true } catch { /* inspect wrappers below */ }
    if (parsed) {
      if (!direct || typeof direct !== 'object' || Array.isArray(direct)) throw outputError('模型未返回 JSON 对象', 'MODEL_JSON_VALIDATION')
      validate?.(direct)
      return direct
    }

    const candidates = []
    const parseCandidate = (value) => {
      try {
        const object = JSON.parse(value)
        if (object && typeof object === 'object' && !Array.isArray(object)) candidates.push(object)
      } catch { /* do not invent missing delimiters or alter numeric values */ }
    }
    for (const match of source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) parseCandidate(match[1].trim())

    let start = -1, depth = 0, inString = false, escaped = false
    for (let i = 0; i < source.length; i++) {
      const char = source[i]
      if (start < 0) {
        if (char === '{') { start = i; depth = 1; inString = false; escaped = false }
        continue
      }
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
      } else if (char === '"') inString = true
      else if (char === '{') depth++
      else if (char === '}' && --depth === 0) {
        parseCandidate(source.slice(start, i + 1))
        start = -1
      }
    }

    const accepted = new Map()
    let validationError
    for (const candidate of candidates) {
      try {
        const validated = validate ? validate(candidate) : candidate
        const key = JSON.stringify(validated === undefined ? candidate : validated)
        if (!accepted.has(key)) accepted.set(key, candidate)
      } catch (error) { validationError ||= error }
    }
    if (accepted.size === 1) return accepted.values().next().value
    if (accepted.size > 1) throw outputError('模型返回多个相互冲突的 JSON 结果，请核对当前答卷后重试', 'MODEL_JSON_CONFLICT')
    if (validationError) throw validationError
    throw outputError(source.includes('{') ? '模型输出无法解析为 JSON，未获得完整有效对象' : '模型未返回 JSON 对象', 'MODEL_JSON_SYNTAX')
  } catch (error) {
    // Classification controls a bounded model-only retry; schema/score failures
    // must never be mistaken for syntax or repaired into a plausible grade.
    if (!error.code) error.code = 'MODEL_JSON_VALIDATION'
    error.modelOutput = source.slice(0, OUTPUT_LIMIT)
    throw error
  }
}
