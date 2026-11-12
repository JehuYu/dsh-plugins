// A shared, abortable model semaphore. View selection never owns a lease.
export class ModelScheduler {
  constructor({ maxConcurrentModels = 2, providerConcurrency = {} } = {}) {
    const limit = Number(maxConcurrentModels)
    this.limit = Number.isInteger(limit) && limit > 0 && limit <= 8 ? limit : 2
    this.providerLimits = providerConcurrency && typeof providerConcurrency === 'object' ? providerConcurrency : {}
    this.active = 0
    this.byProvider = new Map()
    this.queue = []
    this.closed = false
  }
  acquire(provider, { signal, onWaiting } = {}) {
    if (this.closed) return Promise.reject(new Error('模型调度器已关闭'))
    if (signal?.aborted) return Promise.reject(signal.reason || new Error('已取消'))
    return new Promise((resolve, reject) => {
      const entry = { provider, signal, resolve, reject }
      entry.abort = () => {
        const index = this.queue.indexOf(entry)
        if (index >= 0) this.queue.splice(index, 1)
        signal?.removeEventListener('abort', entry.abort)
        reject(signal.reason || new Error('已取消'))
        this.drain()
      }
      signal?.addEventListener('abort', entry.abort, { once: true })
      this.queue.push(entry)
      this.drain()
      if (this.queue.includes(entry)) onWaiting?.()
    })
  }
  drain() {
    for (let i = 0; i < this.queue.length && this.active < this.limit;) {
      const entry = this.queue[i]
      const declared = Number(this.providerLimits[entry.provider])
      const limit = Number.isInteger(declared) && declared > 0 ? Math.min(declared, this.limit) : Math.min(2, this.limit)
      if ((this.byProvider.get(entry.provider) || 0) >= limit) { i++; continue }
      this.queue.splice(i, 1)
      entry.signal?.removeEventListener('abort', entry.abort)
      this.active++
      this.byProvider.set(entry.provider, (this.byProvider.get(entry.provider) || 0) + 1)
      let released = false
      entry.resolve(() => {
        if (released) return
        released = true
        this.active--
        this.byProvider.set(entry.provider, this.byProvider.get(entry.provider) - 1)
        this.drain()
      })
    }
  }
  view() { return { active: this.active, queued: this.queue.length, limit: this.limit } }
  dispose() {
    this.closed = true
    for (const entry of this.queue.splice(0)) {
      entry.signal?.removeEventListener('abort', entry.abort)
      entry.reject(new Error('模型调度器已关闭'))
    }
  }
}
