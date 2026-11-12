import { throwIfAborted } from './streaming.js'

// This is a second model evaluation of the SAME input, never a JSON repair,
// new claim, submission retry, fallback model, or a relaxation of score checks.
export const FORMAT_RETRY_INSTRUCTION = '\n上一次响应没有形成合法JSON。本次对同一作答图按相同评分标准重新评分，仅返回规定JSON对象，不输出Markdown或解释。所有字段名、评分项id保持原样。证据和reason中的引用请使用中文引号“”，不要在JSON字符串内部直接写未转义的英文双引号；如需英文双引号必须按JSON转义。不要复制或猜测上次分数；分项范围、步长、合分规则保持不变。'

export async function withFormatRecovery(run, { signal, onRetry, onRecovered } = {}) {
  let firstError
  for (let attempt = 0; attempt <= 1; attempt++) {
    throwIfAborted(signal)
    try {
      const result = await run({ attempt, formatInstruction: attempt ? FORMAT_RETRY_INSTRUCTION : '' })
      throwIfAborted(signal)
      if (attempt) await onRecovered?.({ attempt, error: firstError })
      return { ...result, formatRetries: attempt }
    } catch (error) {
      throwIfAborted(signal)
      const syntaxOnly = error?.code === 'MODEL_JSON_SYNTAX' && typeof error.modelOutput === 'string' && error.modelOutput.trim().length > 0
      if (attempt === 0 && syntaxOnly) {
        firstError = error
        await onRetry?.({ attempt: 1, error })
        continue
      }
      if (error && typeof error === 'object') error.formatRetries = attempt
      throw error
    }
  }
}
