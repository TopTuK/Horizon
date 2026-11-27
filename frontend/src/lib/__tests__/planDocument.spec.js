import { beforeEach, describe, expect, it } from 'vitest'
import {
  BROWSER_PLAN_KEY,
  VERSION,
  defaultState,
  discardBrowserPlan,
  hasWork,
  normalizeDocument,
  readBrowserPlan,
} from '../planDocument'

function stored(plan) {
  localStorage.setItem(BROWSER_PLAN_KEY, typeof plan === 'string' ? plan : JSON.stringify(plan))
}

describe('planDocument', () => {
  beforeEach(() => localStorage.clear())

  it('fills in defaults and gives every activity its assignments array', () => {
    const document = normalizeDocument({ version: VERSION, pools: [], swimlanes: [], activities: [{ id: 'a1' }] })

    expect(document.businessDays).toBe(defaultState().businessDays)
    expect(document.dayOverrides).toEqual({})
    expect(document.activities).toEqual([{ id: 'a1', assignments: [] }])
    expect(normalizeDocument({ activities: [{ id: 'a1', assignments: [{ id: 'x' }] }] }).activities).toEqual([
      { id: 'a1', assignments: [{ id: 'x' }] },
    ])
  })

  it('a new plan holds no work, and any entered change does', () => {
    expect(hasWork(defaultState())).toBe(false)

    const renamed = defaultState()
    renamed.pools[0].members[0].name = 'Yuliya'
    expect(hasWork(renamed)).toBe(true)

    const holiday = defaultState()
    holiday.dayOverrides['2027-01-01'] = false
    expect(hasWork(holiday)).toBe(true)

    expect(hasWork({ ...defaultState(), businessDays: 200 })).toBe(true)
    expect(hasWork({ ...defaultState(), swimlanes: [{ id: 'l1', name: 'KNIS' }] })).toBe(true)

    const away = defaultState()
    away.pools[0].members[0].absences = [{ id: 'a', kind: 'vacation', from: '2026-01-05', to: '2026-01-09' }]
    expect(hasWork(away)).toBe(true)
  })

  it('gives every member an absences list', () => {
    expect(defaultState().pools[0].members[0].absences).toEqual([])

    const missing = normalizeDocument({
      version: VERSION,
      pools: [{ id: 'dev', members: [{ id: 'm1', name: 'A', hoursPerDay: 6 }] }],
      swimlanes: [],
      activities: [],
    })
    expect(missing.pools[0].members[0].absences).toEqual([])

    const corrupt = normalizeDocument({
      pools: [{ id: 'dev', members: [{ id: 'm1', absences: 'no' }] }],
    })
    expect(corrupt.pools[0].members[0].absences).toEqual([])

    const kept = [{ id: 'a', kind: 'vacation', from: '2026-01-05', to: '2026-01-09' }]
    const document = normalizeDocument({
      pools: [{ id: 'dev', members: [{ id: 'm1', absences: kept }] }],
    })
    expect(document.pools[0].members[0].absences).toEqual(kept)
  })

  it('offers the browser plan only when it holds work the editor could open', () => {
    expect(readBrowserPlan()).toBeNull()

    stored(defaultState())
    expect(readBrowserPlan()).toBeNull()

    stored('{not json')
    expect(readBrowserPlan()).toBeNull()

    stored({ version: VERSION - 1, pools: [], swimlanes: [], activities: [] })
    expect(readBrowserPlan()).toBeNull()

    stored({ pools: 'no' })
    expect(readBrowserPlan()).toBeNull()

    const work = defaultState()
    work.activities.push({ id: 'a1', name: 'Integration' })
    stored(work)
    expect(readBrowserPlan()).toEqual(work)
  })

  it('forgets the browser plan once it is saved elsewhere', () => {
    const work = defaultState()
    work.activities.push({ id: 'a1' })
    stored(work)

    discardBrowserPlan()

    expect(readBrowserPlan()).toBeNull()
  })
})
