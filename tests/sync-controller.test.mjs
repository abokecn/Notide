import test from 'node:test'
import assert from 'node:assert/strict'
import { SyncRequestError } from '../src/sync.js'
import { SyncController, syncTiming } from '../src/syncController.js'

function fakeClock() {
  let timestamp = 0
  let nextId = 1
  const tasks = new Map()
  return {
    now: () => timestamp,
    setTimer(callback, delay) {
      const id = nextId
      nextId += 1
      tasks.set(id, { at: timestamp + delay, callback })
      return id
    },
    clearTimer(id) { tasks.delete(id) },
    async tick(milliseconds) {
      const target = timestamp + milliseconds
      while (true) {
        const pending = [...tasks.entries()]
          .filter(([, task]) => task.at <= target)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0]
        if (!pending) break
        const [id, task] = pending
        tasks.delete(id)
        timestamp = task.at
        task.callback()
        await Promise.resolve()
        await Promise.resolve()
      }
      timestamp = target
      await Promise.resolve()
      await Promise.resolve()
    },
    get pending() { return tasks.size },
  }
}

function controllerOptions(clock, overrides = {}) {
  return {
    sync: async () => ({ notes: [], tombstones: [], changed: false, notModified: true }),
    getSnapshot: () => ({ endpoint: 'https://sync.example', notes: [], tombstones: [] }),
    applyResult: () => {},
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
    random: () => 0.5,
    eventTarget: null,
    document: null,
    ...overrides,
  }
}

async function flushMicrotasks(count = 8) {
  for (let index = 0; index < count; index += 1) await Promise.resolve()
}

test('SyncController debounces edits for 2.5 seconds and enforces a 20 second maximum', async () => {
  const clock = fakeClock()
  let calls = 0
  const controller = new SyncController(controllerOptions(clock, { sync: async () => { calls += 1; return { notModified: true } } }))

  controller.markDirty('a')
  await clock.tick(syncTiming.debounceMs - 1)
  assert.equal(calls, 0)
  await clock.tick(1)
  assert.equal(calls, 1)

  controller.markDirty('a')
  for (let elapsed = 2_000; elapsed < syncTiming.maxWaitMs; elapsed += 2_000) {
    await clock.tick(2_000)
    controller.markDirty('a')
  }
  await clock.tick(2_000)
  assert.equal(calls, 2)
  controller.dispose()
})

test('SyncController keeps one in-flight request and discards a result from an older dirty epoch', async () => {
  const clock = fakeClock()
  const resolvers = []
  const applied = []
  let calls = 0
  const controller = new SyncController(controllerOptions(clock, {
    sync: () => {
      calls += 1
      return new Promise((resolve) => resolvers.push(resolve))
    },
    applyResult: (result) => applied.push(result),
  }))

  const first = controller.trigger('manual')
  const same = controller.trigger('focus')
  assert.equal(first, same)
  assert.equal(calls, 0)
  await Promise.resolve()
  assert.equal(calls, 1)
  controller.markDirty('note-a')
  resolvers.shift()({ changed: true, marker: 'stale' })
  await first
  await Promise.resolve()
  assert.deepEqual(applied, [])

  await clock.tick(syncTiming.debounceMs)
  assert.equal(calls, 2)
  resolvers.shift()({ changed: true, marker: 'fresh' })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(applied, [{ changed: true, marker: 'fresh' }])
  controller.dispose()
})

test('foreground events coalesce into the active request without a duplicate follow-up', async () => {
  const clock = fakeClock()
  let resolveRequest
  let calls = 0
  const controller = new SyncController(controllerOptions(clock, {
    sync: () => {
      calls += 1
      return new Promise((resolve) => { resolveRequest = resolve })
    },
  }))

  const first = controller.trigger('visible', { force: false })
  await Promise.resolve()
  const focused = controller.trigger('focus', { force: false })
  assert.equal(first, focused)
  assert.equal(calls, 1)
  resolveRequest({ changed: false, notModified: true })
  await first
  await flushMicrotasks()
  assert.equal(calls, 1)
  assert.equal(clock.pending, 0)
  controller.dispose()
})

test('SyncController opens a credential circuit and only a forced manual trigger probes it', async () => {
  const clock = fakeClock()
  let calls = 0
  const states = []
  const controller = new SyncController(controllerOptions(clock, {
    sync: async () => {
      calls += 1
      if (calls === 1) throw new SyncRequestError('sync_fetch_401', { status: 401 })
      return { notModified: true }
    },
    onState: (state) => states.push(state),
  }))

  await assert.rejects(controller.trigger('manual'))
  await controller.trigger('online', { force: false })
  assert.equal(calls, 1)
  assert.equal(states.some((state) => state.status === 'paused' && state.circuit.status === 401), true)
  await controller.trigger('manual')
  assert.equal(calls, 2)
  controller.dispose()
})

test('SyncController retries server failures with backoff and uses no polling timer after success', async () => {
  const clock = fakeClock()
  let calls = 0
  const controller = new SyncController(controllerOptions(clock, {
    sync: async () => {
      calls += 1
      if (calls === 1) throw new SyncRequestError('sync_fetch_503', { status: 503 })
      return { notModified: true }
    },
  }))

  await assert.rejects(controller.trigger('manual'))
  await clock.tick(syncTiming.backoffBaseMs - 1)
  assert.equal(calls, 1)
  await clock.tick(1)
  assert.equal(calls, 2)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(clock.pending, 0)
  controller.dispose()
})

test('SyncController reacts to online and visibility events and removes listeners on dispose', async () => {
  const listeners = new Map()
  const target = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
  }
  const documentListeners = new Map()
  const document = {
    visibilityState: 'hidden',
    addEventListener: (name, callback) => documentListeners.set(name, callback),
    removeEventListener: (name) => documentListeners.delete(name),
  }
  const clock = fakeClock()
  let calls = 0
  const controller = new SyncController(controllerOptions(clock, {
    sync: async () => { calls += 1; return { notModified: true } },
    eventTarget: target,
    document,
  }))

  listeners.get('online')()
  await flushMicrotasks()
  assert.equal(calls, 1)
  document.visibilityState = 'visible'
  documentListeners.get('visibilitychange')()
  await flushMicrotasks()
  assert.equal(calls, 2)
  controller.dispose()
  assert.equal(listeners.size, 0)
  assert.equal(documentListeners.size, 0)
})
