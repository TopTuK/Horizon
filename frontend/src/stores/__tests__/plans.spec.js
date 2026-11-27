import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/api', () => ({
  plansApi: { get: vi.fn(), save: vi.fn(), rename: vi.fn(), list: vi.fn(), create: vi.fn(), remove: vi.fn() },
}))

import { plansApi } from '../../services/api'
import { defaultState } from '../../lib/planDocument'
import { usePlans } from '../plans'

const summary = (overrides = {}) => ({
  id: 'p1',
  name: 'Roadmap',
  revision: 1,
  activity_count: 2,
  member_count: 12,
  selected_year: 2027,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
  ...overrides,
})

describe('plans', () => {
  let plans

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(plansApi.create).mockReset()
    vi.mocked(plansApi.rename).mockReset()
    plans = usePlans()
  })

  it('loads the list from the server', async () => {
    vi.mocked(plansApi.list).mockResolvedValue([summary(), summary({ id: 'p2' })])

    await plans.load()

    expect(plans.items.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(plans.loaded).toBe(true)
    expect(plans.loading).toBe(false)
    expect(plans.error).toBeNull()
  })

  it('remembers why the list could not be loaded, until a load succeeds', async () => {
    vi.mocked(plansApi.list).mockRejectedValueOnce(new Error('offline'))

    await expect(plans.load()).rejects.toThrow('offline')

    expect(plans.loaded).toBe(false)
    expect(plans.error.message).toBe('offline')

    vi.mocked(plansApi.list).mockResolvedValueOnce([summary()])
    await plans.load()

    expect(plans.error).toBeNull()
    expect(plans.items).toHaveLength(1)
  })

  it('names a new plan after the default year, and keeps names apart', async () => {
    plans.items = [summary({ name: 'Roadmap 2026' }), summary({ id: 'p2', name: 'Roadmap 2026 (2)' })]

    expect(plans.nextName()).toBe('Roadmap 2026 (3)')
    expect(plans.nextName('KNIS copy')).toBe('KNIS copy')
  })

  it('adds a created plan to the top of the list, without its document', async () => {
    const data = defaultState()
    vi.mocked(plansApi.create).mockResolvedValue({ ...summary(), data })

    const created = await plans.create({ name: 'Roadmap 2026', data })

    expect(created.data).toBe(data)
    expect(plans.items).toHaveLength(1)
    expect(plans.items[0]).not.toHaveProperty('data')
  })

  it('renames a plan in place', async () => {
    plans.items = [summary()]
    vi.mocked(plansApi.rename).mockResolvedValue(summary({ name: 'Roadmap 2027' }))

    await plans.rename('p1', 'Roadmap 2027')

    expect(plansApi.rename).toHaveBeenCalledWith('p1', 'Roadmap 2027')
    expect(plans.items[0].name).toBe('Roadmap 2027')
  })

  it('updates what is known about a plan after a save, without reordering the list', () => {
    plans.items = [summary({ id: 'p1' }), summary({ id: 'p2' })]

    plans.touch(summary({ id: 'p2', revision: 9, updated_at: '2026-11-20T10:00:00Z' }))

    expect(plans.items.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(plans.items[1]).toMatchObject({ revision: 9, updated_at: '2026-11-20T10:00:00Z' })
  })

  it('removes a deleted plan from the list', async () => {
    vi.mocked(plansApi.remove).mockResolvedValue(null)
    plans.items = [summary(), summary({ id: 'p2' })]

    await plans.remove('p1')

    expect(plansApi.remove).toHaveBeenCalledWith('p1')
    expect(plans.items.map((p) => p.id)).toEqual(['p2'])
  })

  it('copies a plan under a name of its own', async () => {
    const data = defaultState()
    vi.mocked(plansApi.get).mockResolvedValue({ ...summary(), data })
    vi.mocked(plansApi.create).mockResolvedValue(summary({ id: 'p9', name: 'Roadmap copy' }))
    plans.items = [summary()]

    const copy = await plans.duplicate('p1')

    expect(plansApi.create).toHaveBeenCalledWith({ name: 'Roadmap copy', data })
    expect(copy.id).toBe('p9')
  })
})
