import { YEARS } from './calendar'
import { uid } from './planning'

/** Format version of the plan document. Bump it only for a change an older document cannot express. */
export const VERSION = 4

/** Where plans were kept before accounts existed. The landing page offers to import it once. */
export const BROWSER_PLAN_KEY = 'horizon-state'

export const LANE_COLORS = ['#818cf8', '#34d399', '#f472b6', '#fbbf24', '#38bdf8', '#a78bfa', '#fb7185', '#2dd4bf']
export const POOL_COLORS = ['#818cf8', '#34d399', '#fbbf24', '#f472b6', '#38bdf8', '#fb7185', '#a78bfa', '#2dd4bf']
export const DEFAULT_HOURS = 6
const DEFAULT_BUSINESS_DAYS = 221

function makeMembers(role, count, hoursPerDay = DEFAULT_HOURS) {
  return Array.from({ length: count }, (_, i) => ({ id: uid(), name: `${role} ${i + 1}`, hoursPerDay }))
}

function makePool(id, name, role, color, count, hoursPerDay) {
  return { id, name, role, color, members: makeMembers(role, count, hoursPerDay) }
}

export function defaultState() {
  return {
    version: VERSION,
    /** Business days per year, shared by every pool (capped by the working calendar). */
    businessDays: DEFAULT_BUSINESS_DAYS,
    pools: [
      makePool('dev', 'Developer Pool', 'Developer', POOL_COLORS[0], 8),
      makePool('test', 'Testing Pool', 'Tester', POOL_COLORS[1], 4),
    ],
    /** Days that differ from the default (weekdays working, weekends off): { 'YYYY-MM-DD': isWorking } */
    dayOverrides: {},
    selectedYear: YEARS[0],
    swimlanes: [],
    activities: [],
  }
}

export function isValidState(s) {
  return s && typeof s === 'object' && Array.isArray(s.pools) && Array.isArray(s.swimlanes) && Array.isArray(s.activities)
}

/** A stored document as the editor expects it: defaults for anything missing, an assignments array on every activity. */
export function normalizeDocument(data) {
  return {
    ...defaultState(),
    ...data,
    activities: (data.activities || []).map((a) => ({ ...a, assignments: a.assignments || [] })),
  }
}

function isUntouchedPool(pool) {
  const expected = pool.id === 'dev' ? 8 : pool.id === 'test' ? 4 : 0
  return (
    pool.members.length === expected &&
    pool.members.every((m, i) => m.name === `${pool.role} ${i + 1}` && m.hoursPerDay === DEFAULT_HOURS)
  )
}

/** Whether a document holds anything a person entered, as opposed to the plan a new browser starts with. */
export function hasWork(plan) {
  return (
    plan.activities.length > 0 ||
    plan.swimlanes.length > 0 ||
    Object.keys(plan.dayOverrides || {}).length > 0 ||
    plan.businessDays !== DEFAULT_BUSINESS_DAYS ||
    plan.selectedYear !== defaultState().selectedYear ||
    plan.pools.length !== 2 ||
    !plan.pools.every(isUntouchedPool)
  )
}

/**
 * The plan this browser kept before accounts existed, when it holds work worth keeping.
 * Reading a browser's storage can fail or hold anything, so this never throws.
 */
export function readBrowserPlan(storage = localStorage) {
  try {
    const raw = storage.getItem(BROWSER_PLAN_KEY)
    if (!raw) return null
    const plan = JSON.parse(raw)
    if (!isValidState(plan) || plan.version !== VERSION || !hasWork(plan)) return null
    return plan
  } catch {
    return null
  }
}

export function discardBrowserPlan(storage = localStorage) {
  storage.removeItem(BROWSER_PLAN_KEY)
}

/** Offers `data` to the browser as a JSON download. */
export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
