import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/api', () => ({
  plansApi: { get: vi.fn(), save: vi.fn(), rename: vi.fn(), list: vi.fn(), create: vi.fn(), remove: vi.fn() },
}))

import { plansApi } from '../../services/api'
import { VERSION, defaultState } from '../../lib/planDocument'
import { usePlanner } from '../planner'

const SAVE_DELAY = 800

/** An error shaped like the API client's, which this mock of the client cannot build itself. */
const failure = (status, body = null) => Object.assign(new Error(`failed with ${status}`), { status, body })

function serverPlan(overrides = {}) {
  return {
    id: 'p1',
    name: 'Roadmap',
    revision: 3,
    updated_at: '2026-11-01T10:00:00Z',
    data: defaultState(),
    ...overrides,
  }
}

/** Lets microtasks (Vue's watcher, the save loop) run without moving the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0)

let planner

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  vi.mocked(plansApi.get).mockReset().mockResolvedValue(serverPlan())
  vi.mocked(plansApi.save).mockReset().mockResolvedValue(serverPlan({ revision: 4 }))
  vi.mocked(plansApi.rename).mockReset().mockResolvedValue(serverPlan({ name: 'Renamed' }))
  planner = usePlanner()
})

afterEach(() => {
  planner.close()
  vi.useRealTimers()
})

describe('opening a plan', () => {
  it('loads the document and its revision', async () => {
    await planner.openPlan('p1')

    expect(plansApi.get).toHaveBeenCalledWith('p1')
    expect(planner.loadStatus).toBe('ready')
    expect(planner.plan).toMatchObject({ id: 'p1', name: 'Roadmap', revision: 3 })
    expect(planner.state.activities).toEqual([])
    expect(planner.saveStatus).toBe('idle')
  })

  it('sends nothing for a plan that was only opened', async () => {
    await planner.openPlan('p1')
    await vi.advanceTimersByTimeAsync(60000)

    expect(plansApi.save).not.toHaveBeenCalled()
  })

  it('reports a missing plan', async () => {
    vi.mocked(plansApi.get).mockRejectedValue(failure(404))

    await planner.openPlan('gone')

    expect(planner.loadStatus).toBe('missing')
    expect(planner.plan).toBeNull()
  })

  it('refuses a document of a version the editor cannot open, and never saves over it', async () => {
    vi.mocked(plansApi.get).mockResolvedValue(serverPlan({ data: { ...defaultState(), version: VERSION + 1 } }))

    await planner.openPlan('p1')
    planner.state.businessDays = 100
    await vi.advanceTimersByTimeAsync(60000)

    expect(planner.loadStatus).toBe('unsupported')
    expect(planner.plan).toBeNull()
    expect(plansApi.save).not.toHaveBeenCalled()
  })

  it('keeps the plan that was asked for last', async () => {
    vi.mocked(plansApi.get).mockImplementation((id) => new Promise((resolve) => setTimeout(() => resolve(serverPlan({ id })), id === 'a' ? 20 : 5)))

    const first = planner.openPlan('a')
    const second = planner.openPlan('b')
    await vi.advanceTimersByTimeAsync(30)
    await Promise.all([first, second])

    expect(planner.plan.id).toBe('b')
  })
})

describe('saving', () => {
  beforeEach(async () => {
    await planner.openPlan('p1')
  })

  it('sends the document shortly after an edit and records the new revision', async () => {
    planner.addSwimlane('KNIS')
    await settle()

    expect(planner.saveStatus).toBe('saving')
    expect(planner.hasUnsavedChanges()).toBe(true)
    expect(plansApi.save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(SAVE_DELAY)

    expect(plansApi.save).toHaveBeenCalledTimes(1)
    const [id, data, revision] = vi.mocked(plansApi.save).mock.calls[0]
    expect(id).toBe('p1')
    expect(revision).toBe(3)
    expect(data.swimlanes.map((lane) => lane.name)).toEqual(['KNIS'])
    expect(data.version).toBe(VERSION)
    expect(planner.plan.revision).toBe(4)
    expect(planner.saveStatus).toBe('saved')
    expect(planner.hasUnsavedChanges()).toBe(false)
  })

  it('sends a burst of edits as one request', async () => {
    planner.addSwimlane('A')
    await vi.advanceTimersByTimeAsync(500)
    planner.addSwimlane('B')
    await vi.advanceTimersByTimeAsync(300)
    expect(plansApi.save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(SAVE_DELAY)

    expect(plansApi.save).toHaveBeenCalledTimes(1)
    expect(planner.state.swimlanes).toHaveLength(2)
  })

  it('sends the document as it was when the request started, then what changed meanwhile', async () => {
    let finishFirst
    vi.mocked(plansApi.save).mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))

    planner.addSwimlane('A')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY)
    const firstPayload = vi.mocked(plansApi.save).mock.calls[0][1]

    planner.addSwimlane('B')
    expect(firstPayload.swimlanes).toHaveLength(1)
    expect(planner.saveStatus).toBe('saving')

    finishFirst(serverPlan({ revision: 4 }))
    await settle()

    expect(plansApi.save).toHaveBeenCalledTimes(2)
    const [, secondPayload, secondRevision] = vi.mocked(plansApi.save).mock.calls[1]
    expect(secondPayload.swimlanes.map((lane) => lane.name)).toEqual(['A', 'B'])
    expect(secondRevision).toBe(4)
    expect(planner.saveStatus).toBe('saved')
  })

  it('flushing saves at once, even right after an edit, and resolves once that request has settled', async () => {
    let finish
    vi.mocked(plansApi.save).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))

    planner.addSwimlane('KNIS')
    let done = false
    const flushed = planner.flushSave().then(() => (done = true))
    await settle()

    expect(plansApi.save).toHaveBeenCalledTimes(1)
    expect(done).toBe(false)

    finish(serverPlan({ revision: 4 }))
    await flushed

    expect(planner.plan.revision).toBe(4)
    expect(planner.hasUnsavedChanges()).toBe(false)
  })

  it('replaces and imports also reach the server', async () => {
    const exported = defaultState()
    exported.activities.push({ id: 'a9', name: 'Imported' })
    await planner.importJson({ text: async () => JSON.stringify(exported) })
    await vi.advanceTimersByTimeAsync(SAVE_DELAY)

    expect(planner.state.activities[0].id).toBe('a9')
    expect(plansApi.save).toHaveBeenCalledTimes(1)
  })
})

describe('a save that conflicts with changes made elsewhere', () => {
  beforeEach(async () => {
    await planner.openPlan('p1')
    vi.mocked(plansApi.save).mockRejectedValue(failure(409, { current_revision: 7 }))
  })

  it('stops saving and asks, instead of overwriting', async () => {
    planner.addSwimlane('KNIS')
    await vi.advanceTimersByTimeAsync(60000)

    expect(plansApi.save).toHaveBeenCalledTimes(1)
    expect(planner.saveStatus).toBe('conflict')
    expect(planner.serverRevision).toBe(7)
    expect(planner.hasUnsavedChanges()).toBe(true)
    expect(planner.state.swimlanes).toHaveLength(1)
  })

  it('"keep my changes" saves over the newer revision', async () => {
    planner.addSwimlane('KNIS')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY)
    vi.mocked(plansApi.save).mockResolvedValue(serverPlan({ revision: 8 }))

    await planner.keepMyChanges()

    expect(plansApi.save).toHaveBeenCalledTimes(2)
    expect(vi.mocked(plansApi.save).mock.calls[1][2]).toBe(7)
    expect(planner.saveStatus).toBe('saved')
    expect(planner.plan.revision).toBe(8)
  })

  it('"reload from server" drops the edits made here', async () => {
    planner.addSwimlane('KNIS')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY)
    vi.mocked(plansApi.get).mockResolvedValue(serverPlan({ revision: 7, name: 'Changed elsewhere' }))

    await planner.reloadFromServer()

    expect(plansApi.get).toHaveBeenCalledTimes(2)
    expect(planner.state.swimlanes).toEqual([])
    expect(planner.plan).toMatchObject({ name: 'Changed elsewhere', revision: 7 })
    expect(planner.saveStatus).toBe('idle')
  })
})

describe('a save that fails', () => {
  beforeEach(async () => {
    await planner.openPlan('p1')
  })

  it('is tried again after growing pauses', async () => {
    vi.mocked(plansApi.save).mockRejectedValue(failure(500))

    planner.addSwimlane('KNIS')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY)
    expect(plansApi.save).toHaveBeenCalledTimes(1)
    expect(planner.saveStatus).toBe('error')

    await vi.advanceTimersByTimeAsync(1000)
    expect(plansApi.save).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1000)
    expect(plansApi.save).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(plansApi.save).toHaveBeenCalledTimes(3)
  })

  it('recovers by itself once the server answers again', async () => {
    vi.mocked(plansApi.save).mockRejectedValueOnce(failure(0)).mockResolvedValueOnce(serverPlan({ revision: 4 }))

    planner.addSwimlane('KNIS')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY + 1000)

    expect(planner.saveStatus).toBe('saved')
    expect(planner.plan.revision).toBe(4)
  })

  it('"retry now" does not wait for the usual pause', async () => {
    vi.mocked(plansApi.save).mockRejectedValueOnce(failure(500)).mockResolvedValueOnce(serverPlan({ revision: 4 }))

    planner.addSwimlane('KNIS')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY)
    expect(plansApi.save).toHaveBeenCalledTimes(1)

    await planner.retrySave()

    expect(plansApi.save).toHaveBeenCalledTimes(2)
    expect(planner.saveStatus).toBe('saved')
  })

  it('is not retried while signed out: that needs the person', async () => {
    vi.mocked(plansApi.save).mockRejectedValue(failure(401))

    planner.addSwimlane('KNIS')
    await vi.advanceTimersByTimeAsync(60000)

    expect(plansApi.save).toHaveBeenCalledTimes(1)
    expect(planner.saveStatus).toBe('error')
    expect(planner.hasUnsavedChanges()).toBe(true)
  })
})

describe('renaming', () => {
  it('trims the name and shows it in the header', async () => {
    await planner.openPlan('p1')

    await planner.rename('  Roadmap 2027  ')

    expect(plansApi.rename).toHaveBeenCalledWith('p1', 'Roadmap 2027')
    expect(planner.plan.name).toBe('Renamed')
  })

  it('does nothing for the name the plan already has', async () => {
    await planner.openPlan('p1')

    await planner.rename(' Roadmap ')
    await planner.rename('   ')

    expect(plansApi.rename).not.toHaveBeenCalled()
  })
})
