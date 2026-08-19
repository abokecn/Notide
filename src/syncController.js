const DEBOUNCE_MS = 2_500
const MAX_WAIT_MS = 20_000
const BACKOFF_STEPS_MS = Object.freeze([5_000, 15_000, 60_000, 5 * 60_000])
const BACKOFF_MAX_MS = BACKOFF_STEPS_MS.at(-1)

function noop() {}

function errorStatus(error) {
  if (Number.isFinite(error?.status)) return Number(error.status)
  const match = String(error?.code || error?.message || '').match(/(?:sync_[a-z]+_|http_)(\d{3})$/i)
  return match ? Number(match[1]) : 0
}

function retryDelay(error) {
  if (Number.isFinite(error?.retryAfterMs)) return Math.max(0, Number(error.retryAfterMs))
  if (Number.isFinite(error?.retryAfter)) return Math.max(0, Number(error.retryAfter) * 1000)
  return null
}

export class SyncController {
  constructor({
    sync,
    getSnapshot,
    applyResult,
    onState = noop,
    setTimer = globalThis.setTimeout?.bind(globalThis),
    clearTimer = globalThis.clearTimeout?.bind(globalThis),
    now = Date.now,
    random = Math.random,
    eventTarget = globalThis.window,
    document = globalThis.document,
  } = {}) {
    if (typeof sync !== 'function') throw new TypeError('SyncController requires sync')
    if (typeof getSnapshot !== 'function') throw new TypeError('SyncController requires getSnapshot')
    if (typeof applyResult !== 'function') throw new TypeError('SyncController requires applyResult')
    if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') throw new TypeError('SyncController requires timer functions')

    this.sync = sync
    this.getSnapshot = getSnapshot
    this.applyResult = applyResult
    this.onState = onState
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.now = now
    this.random = random
    this.eventTarget = eventTarget
    this.document = document

    this.epoch = 0
    this.dirtyIds = new Set()
    this.inFlight = null
    this.abortController = null
    this.pendingReason = null
    this.debounceTimer = null
    this.maxTimer = null
    this.retryTimer = null
    this.failureCount = 0
    this.retryAt = 0
    this.circuit = null
    this.disposed = false
    this.applying = false

    this.handleOnline = () => this.trigger('online', { force: false }).catch(noop)
    this.handleFocus = () => {
      if (!this.document || this.document.visibilityState !== 'hidden') this.trigger('focus', { force: false }).catch(noop)
    }
    this.handleVisibility = () => {
      if (this.document?.visibilityState === 'visible') this.trigger('visible', { force: false }).catch(noop)
    }
    this.eventTarget?.addEventListener?.('online', this.handleOnline)
    this.eventTarget?.addEventListener?.('focus', this.handleFocus)
    this.document?.addEventListener?.('visibilitychange', this.handleVisibility)
  }

  markDirty(noteId) {
    if (this.disposed || this.applying) return false
    this.epoch += 1
    this.dirtyIds.add(noteId == null ? '*' : String(noteId))
    this.scheduleDirty()
    return true
  }

  scheduleDirty() {
    if (this.disposed || this.circuit) return
    if (this.retryAt > this.now()) {
      this.scheduleRetry()
      return
    }
    if (this.debounceTimer != null) this.clearTimer(this.debounceTimer)
    this.debounceTimer = this.setTimer(() => {
      this.debounceTimer = null
      this.trigger('dirty', { force: false }).catch(noop)
    }, DEBOUNCE_MS)
    if (this.maxTimer == null) {
      this.maxTimer = this.setTimer(() => {
        this.maxTimer = null
        this.trigger('max-wait', { force: false }).catch(noop)
      }, MAX_WAIT_MS)
    }
  }

  trigger(reason = 'manual', { force = reason === 'manual' } = {}) {
    if (this.disposed) return Promise.resolve(null)
    if (this.circuit && !force) {
      this.emit({ status: 'paused', reason, circuit: this.circuit, retryAt: null })
      return Promise.resolve(null)
    }
    if (this.retryAt > this.now() && !force) {
      this.scheduleRetry()
      return Promise.resolve(null)
    }
    if (force) {
      this.circuit = null
      this.retryAt = 0
      this.failureCount = 0
    }
    this.clearDirtyTimers()
    // Visibility and focus commonly fire together. The active request already
    // observes the latest clean snapshot; edits are tracked separately by epoch.
    if (this.inFlight) return this.inFlight
    return this.run(reason)
  }

  run(reason) {
    const capturedEpoch = this.epoch
    const capturedDirtyIds = [...this.dirtyIds]
    const snapshot = this.getSnapshot() || {}
    const abortController = typeof AbortController === 'function' ? new AbortController() : null
    this.abortController = abortController
    this.emit({ status: 'syncing', reason, epoch: capturedEpoch })

    const operation = Promise.resolve().then(() => this.sync({
      ...snapshot,
      dirtyIds: capturedDirtyIds,
      syncEpoch: capturedEpoch,
      ...(abortController ? { signal: abortController.signal } : {}),
    }))

    let tracked
    tracked = operation.then((result) => {
      this.failureCount = 0
      this.retryAt = 0
      this.circuit = null
      if (capturedEpoch !== this.epoch) {
        this.pendingReason = 'dirty-after-sync'
        this.emit({ status: 'stale', reason, epoch: capturedEpoch })
        return
      }

      this.applying = true
      try {
        this.applyResult(result)
      } finally {
        this.applying = false
      }
      if (capturedDirtyIds.includes('*')) this.dirtyIds.clear()
      else for (const id of capturedDirtyIds) this.dirtyIds.delete(id)
      this.emit({
        status: result?.notModified && !result?.conflicts?.length ? 'idle' : 'synced',
        reason,
        epoch: capturedEpoch,
        changed: Boolean(result?.changed),
        conflicts: Array.isArray(result?.conflicts) ? result.conflicts : [],
      })
    }).catch((error) => {
      if (capturedEpoch !== this.epoch || this.disposed) {
        this.emit({ status: 'stale', reason, epoch: capturedEpoch })
        return null
      }
      this.handleFailure(error, reason, capturedEpoch)
      throw error
    }).finally(() => {
      if (this.inFlight === tracked) this.inFlight = null
      if (this.abortController === abortController) this.abortController = null
      const pending = this.pendingReason
      this.pendingReason = null
      if (this.disposed || this.circuit || this.retryAt > this.now()) return
      if (pending && pending !== 'dirty-after-sync' && this.dirtyIds.size === 0) {
        this.trigger(pending, { force: false }).catch(noop)
      } else if (pending || this.dirtyIds.size) {
        this.scheduleDirty()
      }
    })
    this.inFlight = tracked

    return tracked
  }

  handleFailure(error, reason, epoch) {
    const status = errorStatus(error)
    if ([401, 403, 404].includes(status)) {
      this.circuit = { status, code: error?.code || `sync_${status}` }
      this.clearDirtyTimers()
      this.emit({ status: 'paused', reason, error, circuit: this.circuit, epoch })
      return
    }

    if (status === 429 || status >= 500 || status === 0) {
      this.failureCount += 1
      const explicit = retryDelay(error)
      const exponential = BACKOFF_STEPS_MS[Math.min(this.failureCount - 1, BACKOFF_STEPS_MS.length - 1)]
      const jitter = 0.8 + (Math.max(0, Math.min(1, this.random())) * 0.4)
      const delay = explicit ?? Math.round(exponential * jitter)
      this.retryAt = this.now() + Math.min(BACKOFF_MAX_MS, delay)
      this.scheduleRetry()
      this.emit({ status: 'backoff', reason, error, retryAt: this.retryAt, epoch })
      return
    }

    this.emit({ status: 'error', reason, error, epoch })
  }

  scheduleRetry() {
    if (this.disposed || this.circuit || !this.retryAt) return
    if (this.retryTimer != null) this.clearTimer(this.retryTimer)
    const delay = Math.max(0, this.retryAt - this.now())
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null
      this.retryAt = 0
      this.trigger('retry', { force: false }).catch(noop)
    }, delay)
  }

  clearDirtyTimers() {
    if (this.debounceTimer != null) this.clearTimer(this.debounceTimer)
    if (this.maxTimer != null) this.clearTimer(this.maxTimer)
    this.debounceTimer = null
    this.maxTimer = null
  }

  clearAllTimers() {
    this.clearDirtyTimers()
    if (this.retryTimer != null) this.clearTimer(this.retryTimer)
    this.retryTimer = null
  }

  reset() {
    if (this.disposed) return
    this.clearAllTimers()
    this.epoch += 1
    this.abortController?.abort()
    this.abortController = null
    this.inFlight = null
    this.dirtyIds.clear()
    this.pendingReason = null
    this.failureCount = 0
    this.retryAt = 0
    this.circuit = null
    this.emit({ status: 'idle', reason: 'reset', epoch: this.epoch })
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.clearAllTimers()
    this.epoch += 1
    this.abortController?.abort()
    this.abortController = null
    this.inFlight = null
    this.pendingReason = null
    this.eventTarget?.removeEventListener?.('online', this.handleOnline)
    this.eventTarget?.removeEventListener?.('focus', this.handleFocus)
    this.document?.removeEventListener?.('visibilitychange', this.handleVisibility)
  }

  emit(state) {
    try {
      this.onState(state)
    } catch {
      // UI state observers must not affect synchronization.
    }
  }
}

export const syncTiming = Object.freeze({
  debounceMs: DEBOUNCE_MS,
  maxWaitMs: MAX_WAIT_MS,
  backoffBaseMs: BACKOFF_STEPS_MS[0],
  backoffStepsMs: BACKOFF_STEPS_MS,
  backoffMaxMs: BACKOFF_MAX_MS,
})
