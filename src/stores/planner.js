import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useStorage } from '@vueuse/core'
import { YEARS, addDays, diffDays, endOfMonthISO, monthKey, parseKey, toISO } from '../lib/calendar'
import {
  activityAllocations,
  assignmentSpan,
  buildAssignments,
  computeActivity,
  findOverloads,
  memberDailyLoad,
  memberLoads,
  overloadedByMonth,
  planReleasedAlignment,
  poolLoad,
  uid,
} from '../lib/planning'
import { isMonthEditable } from '../components/gantt/editable'
import { isDefaultWorking, makeCalendar } from '../lib/workdays'

const STORAGE_KEY = 'horizon-state'
const VERSION = 4
const LANE_COLORS = ['#818cf8', '#34d399', '#f472b6', '#fbbf24', '#38bdf8', '#a78bfa', '#fb7185', '#2dd4bf']
export const POOL_COLORS = ['#818cf8', '#34d399', '#fbbf24', '#f472b6', '#38bdf8', '#fb7185', '#a78bfa', '#2dd4bf']
const DEFAULT_HOURS = 6
const DEFAULT_BUSINESS_DAYS = 221

const round = (v, step = 0.05) => Math.round(v / step) * step

function makeMembers(role, count, hoursPerDay = DEFAULT_HOURS) {
  return Array.from({ length: count }, (_, i) => ({ id: uid(), name: `${role} ${i + 1}`, hoursPerDay }))
}

function makePool(id, name, role, color, count, hoursPerDay) {
  return { id, name, role, color, members: makeMembers(role, count, hoursPerDay) }
}

/** "Design Pool" -> "Design"; used to name new members of a pool. */
const roleFromName = (name) => name.replace(/\s*pool\s*$/i, '').trim() || 'Member'

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

function isValidState(s) {
  return s && typeof s === 'object' && Array.isArray(s.pools) && Array.isArray(s.swimlanes) && Array.isArray(s.activities)
}

export const usePlanner = defineStore('planner', () => {
  const state = useStorage(STORAGE_KEY, defaultState(), localStorage, { mergeDefaults: true })
  // A saved state from another version can no longer be read: start from a blank plan.
  if (state.value.version !== VERSION || !Array.isArray(state.value.pools)) state.value = defaultState()
  for (const a of state.value.activities) a.assignments ||= []
  const editingId = ref(null)
  const expanded = ref({})
  const calendarModal = ref({ open: false, month: null })
  const burndownId = ref(null)

  const cal = computed(() => makeCalendar(state.value.dayOverrides))
  const pools = computed(() => state.value.pools)
  /** memberId -> { ...member, poolId } */
  const members = computed(() => {
    const index = {}
    for (const p of state.value.pools) for (const m of p.members) index[m.id] = { ...m, poolId: p.id }
    return index
  })
  const ctx = computed(() => ({
    pools: state.value.pools,
    members: members.value,
    cal: cal.value,
    businessDays: state.value.businessDays,
  }))

  const year = computed({
    get: () => state.value.selectedYear,
    set: (v) => (state.value.selectedYear = v),
  })

  const results = computed(() =>
    Object.fromEntries(state.value.activities.map((a) => [a.id, computeActivity(a, ctx.value)])),
  )

  /** { 'YYYY-MM': { memberId: share of the member's month } } across all activities. */
  const memberLoad = computed(() => memberLoads(results.value))

  /** { memberId: { iso: { hours, acts } } } across all activities. */
  const memberDaily = computed(() => memberDailyLoad(results.value))

  /** Periods where a member is booked for more than 1 FTE (their efficient hours per day). */
  const overloads = computed(() => findOverloads(ctx.value, memberDaily.value))

  const overMonths = computed(() => overloadedByMonth(overloads.value))

  const load = computed(() => poolLoad(ctx.value, results.value, memberLoad.value, year.value, overMonths.value))

  /** Monthly load and hours of the selected year, split by activity, for every pool and member. */
  const allocByActivity = computed(() =>
    activityAllocations(ctx.value, state.value.swimlanes, state.value.activities, results.value, year.value),
  )

  /** Overload periods of a member, optionally only those involving an activity and/or touching [from, to]. */
  function overloadsFor(memberId, { activityId = null, from = null, to = null } = {}) {
    return overloads.value.filter(
      (o) =>
        o.memberId === memberId &&
        (!activityId || o.activityIds.includes(activityId)) &&
        (!from || o.to >= from) &&
        (!to || o.from <= to),
    )
  }

  const activitiesByLane = computed(() => {
    const map = {}
    for (const lane of state.value.swimlanes) map[lane.id] = []
    for (const a of state.value.activities) (map[a.laneId] ||= []).push(a)
    return map
  })

  const editing = computed(() => state.value.activities.find((a) => a.id === editingId.value) || null)

  function getActivity(id) {
    return state.value.activities.find((a) => a.id === id)
  }

  // Pools and members

  function getPool(id) {
    return state.value.pools.find((p) => p.id === id)
  }

  function setBusinessDays(v) {
    state.value.businessDays = Math.max(0, Math.min(366, Math.round(Number(v) || 0)))
  }

  function addPool(name) {
    const clean = (name || '').trim() || `Pool ${state.value.pools.length + 1}`
    const role = roleFromName(clean)
    const pool = {
      id: uid(),
      name: clean,
      role,
      color: POOL_COLORS[state.value.pools.length % POOL_COLORS.length],
      members: makeMembers(role, 1),
    }
    state.value.pools.push(pool)
    return pool
  }

  function updatePool(id, patch) {
    const pool = getPool(id)
    if (pool) Object.assign(pool, patch)
  }

  /** Strips allocations of the given members from every activity. */
  function dropAllocations(memberIds) {
    const ids = new Set(memberIds)
    for (const a of state.value.activities) a.assignments = (a.assignments || []).filter((x) => !ids.has(x.memberId))
  }

  function removePool(id) {
    const pool = getPool(id)
    if (!pool) return
    dropAllocations(pool.members.map((m) => m.id))
    for (const a of state.value.activities) if (a.estimate) delete a.estimate[id]
    state.value.pools = state.value.pools.filter((p) => p.id !== id)
  }

  function addMember(poolId) {
    const pool = getPool(poolId)
    if (!pool) return null
    const role = pool.role || roleFromName(pool.name)
    const taken = new Set(pool.members.map((m) => m.name))
    let n = pool.members.length + 1
    while (taken.has(`${role} ${n}`)) n++
    const hoursPerDay = pool.members.at(-1)?.hoursPerDay ?? DEFAULT_HOURS
    const member = { id: uid(), name: `${role} ${n}`, hoursPerDay }
    pool.members.push(member)
    return member
  }

  function updateMember(memberId, patch) {
    for (const p of state.value.pools) {
      const m = p.members.find((x) => x.id === memberId)
      if (m) return Object.assign(m, patch)
    }
  }

  function removeMember(memberId) {
    dropAllocations([memberId])
    for (const p of state.value.pools) p.members = p.members.filter((m) => m.id !== memberId)
  }

  /** Whether the member is assigned to any activity. */
  function isAssigned(memberId) {
    return state.value.activities.some((a) => (a.assignments || []).some((x) => x.memberId === memberId))
  }

  // Calendar

  function setDayWorking(y, m, d, working) {
    const iso = toISO(y, m, d)
    if (working === isDefaultWorking(y, m, d)) delete state.value.dayOverrides[iso]
    else state.value.dayOverrides[iso] = working
  }

  /** Restores the default weekend rule for a whole year, or for one month when given. */
  function resetCalendar(y, m = null) {
    const prefix = m === null ? `${y}-` : monthKey(y, m) + '-'
    for (const iso of Object.keys(state.value.dayOverrides)) {
      if (iso.startsWith(prefix)) delete state.value.dayOverrides[iso]
    }
  }

  function openCalendar(month = null) {
    calendarModal.value = { open: true, month }
  }

  // Swimlanes

  function addSwimlane(name) {
    const lane = {
      id: uid(),
      name: name || `Project ${state.value.swimlanes.length + 1}`,
      color: LANE_COLORS[state.value.swimlanes.length % LANE_COLORS.length],
      collapsed: false,
    }
    state.value.swimlanes.push(lane)
    return lane
  }

  function updateSwimlane(id, patch) {
    const lane = state.value.swimlanes.find((l) => l.id === id)
    if (lane) Object.assign(lane, patch)
  }

  function removeSwimlane(id) {
    state.value.swimlanes = state.value.swimlanes.filter((l) => l.id !== id)
    state.value.activities = state.value.activities.filter((a) => a.laneId !== id)
  }

  function setSwimlaneOrder(lanes) {
    state.value.swimlanes = lanes
  }

  // Activities

  /** Starts never fall on a non-working day, and a fixed activity always ends on a working day. */
  function normalizeDates(a) {
    a.start = cal.value.nextWorking(a.start)
    if (a.mode === 'fixed') {
      if (!a.end || a.end < a.start) a.end = a.start
      a.end = cal.value.prevWorking(a.end)
      if (a.end < a.start) a.end = a.start
    }
  }

  function addActivity(laneId, start, mode = 'estimate') {
    const activity = {
      id: uid(),
      laneId,
      name: `Activity ${state.value.activities.length + 1}`,
      mode,
      start,
      end: addDays(start, 59),
      estimate: Object.fromEntries(state.value.pools.map((p, i) => [p.id, i === 0 ? 480 : 120])),
      assignments: [],
    }
    normalizeDates(activity)
    const first = state.value.pools[0]?.members[0]
    if (mode === 'estimate' && first) activity.assignments.push({ id: uid(), memberId: first.id, share: 1, from: null, to: null })
    state.value.activities.push(activity)
    expanded.value[activity.id] = true
    return activity
  }

  function updateActivity(id, patch) {
    const a = getActivity(id)
    if (!a) return
    Object.assign(a, patch)
    if ('start' in patch || 'end' in patch || 'mode' in patch) normalizeDates(a)
  }

  function removeActivity(id) {
    state.value.activities = state.value.activities.filter((a) => a.id !== id)
    if (editingId.value === id) editingId.value = null
  }

  /** Moves the start date, keeping the duration (fixed) and shifting assignment ranges by the same number of days. */
  function moveActivity(id, newStart, laneId) {
    const a = getActivity(id)
    if (!a || !newStart) return
    const shift = diffDays(a.start, newStart)
    if (shift) {
      if (a.mode === 'fixed') a.end = addDays(a.end, shift)
      a.start = newStart
      for (const x of a.assignments || []) {
        if (x.from) x.from = cal.value.nextWorking(addDays(x.from, shift))
        if (x.to) x.to = cal.value.prevWorking(addDays(x.to, shift))
        if (x.from && x.to && x.to < x.from) x.to = x.from
      }
      normalizeDates(a)
    }
    if (laneId) a.laneId = laneId
  }

  function resizeActivity(id, edge, date) {
    const a = getActivity(id)
    if (!a) return
    if (edge === 'start') a.start = date <= a.end ? date : a.end
    else a.end = date >= a.start ? date : a.start
    normalizeDates(a)
  }

  // Assignments: { id, memberId, share (part of 1 FTE), from, to }; a null bound follows the activity
  // (from = activity start; to = fixed end, or "until the estimate is covered").

  const clampShare = (v) => Math.max(0.05, Math.min(5, round(Number(v) || 0)))

  function getAssignment(actId, asgId) {
    return getActivity(actId)?.assignments.find((x) => x.id === asgId)
  }

  function addAssignment(actId, { memberId, share = 1, from = null, to = null }) {
    const a = getActivity(actId)
    if (!a || !members.value[memberId]) return null
    a.assignments.push({ id: uid(), memberId, share: clampShare(share), from: null, to: null })
    const x = a.assignments[a.assignments.length - 1]
    updateAssignment(actId, x.id, { from, to })
    return x
  }

  /** patch: { share?, from?, to? }; dates snap to working days (from forward, to backward). */
  function updateAssignment(actId, asgId, patch) {
    const a = getActivity(actId)
    const x = getAssignment(actId, asgId)
    if (!x) return
    if ('share' in patch) x.share = clampShare(patch.share)
    if ('from' in patch) {
      const v = patch.from ? cal.value.nextWorking(patch.from) : null
      x.from = v && v > a.start ? v : null
    }
    if ('to' in patch) {
      const v = patch.to ? cal.value.prevWorking(patch.to) : null
      x.to = v && a.mode === 'fixed' && v >= a.end ? null : v
    }
    const span = assignmentSpan(a, x)
    if (span.to && span.to < span.from) {
      if ('from' in patch) x.to = span.from
      else x.from = span.to > a.start ? span.to : null
    }
  }

  function removeAssignment(actId, asgId) {
    const a = getActivity(actId)
    if (a) a.assignments = a.assignments.filter((x) => x.id !== asgId)
  }

  /** Splits a range in two; the second part starts on the given (working) day with the same share. */
  function splitAssignment(actId, asgId, at) {
    const a = getActivity(actId)
    const x = getAssignment(actId, asgId)
    if (!x) return
    const span = assignmentSpan(a, x)
    const start = cal.value.nextWorking(at)
    const firstEnd = cal.value.prevWorking(addDays(start, -1))
    if (start <= span.from || firstEnd < span.from || (span.to && start > span.to)) return
    const second = { id: uid(), memberId: x.memberId, share: x.share, from: start, to: x.to }
    x.to = firstEnd
    a.assignments.splice(a.assignments.indexOf(x) + 1, 0, second)
  }

  /** First working day of a month as an assignment start (null when it is the activity start or earlier). */
  function monthStartFor(a, key) {
    const { y, m } = parseKey(key)
    const first = cal.value.nextWorking(toISO(y, m, 1))
    return first > a.start ? first : null
  }

  /** Whether the member has a range on the activity that touches the month. */
  function hasAssignmentIn(actId, key, memberId) {
    const a = getActivity(actId)
    if (!a) return false
    const r = results.value[actId]
    const { y, m } = parseKey(key)
    const ms = toISO(y, m, 1)
    const me = endOfMonthISO(y, m)
    return a.assignments.some((x) => {
      if (x.memberId !== memberId) return false
      const s = assignmentSpan(a, x)
      return s.from <= me && (s.to || r?.end || '9999-12-31') >= ms
    })
  }

  /** Drop of a pool member on an activity month: 100% from that month on, unless already assigned there. */
  function assignFromMonth(actId, key, memberId) {
    const a = getActivity(actId)
    if (!a || hasAssignmentIn(actId, key, memberId)) return
    addAssignment(actId, { memberId, share: 1, from: monthStartFor(a, key), to: null })
  }

  /** Moves a range to another activity (or to another month of the same one), starting at the target month. */
  function moveAssignment(fromActId, asgId, toActId, key) {
    const x = getAssignment(fromActId, asgId)
    const target = getActivity(toActId)
    if (!x || !target) return
    if (fromActId === toActId) {
      updateAssignment(toActId, asgId, { from: monthStartFor(target, key) })
      return
    }
    const { memberId, share } = x
    removeAssignment(fromActId, asgId)
    addAssignment(toActId, { memberId, share, from: monthStartFor(target, key), to: null })
  }

  /** options: { memberIds, share } */
  function assignEvenly(id, options) {
    const a = getActivity(id)
    if (!a) return
    a.assignments = buildAssignments(a, ctx.value, options).map((x) =>
      x.from === a.start && (x.to === null || x.to === a.end) ? { ...x, from: null, to: null } : x,
    )
  }

  function clearAssignments(id) {
    const a = getActivity(id)
    if (a) a.assignments = []
  }

  /** Month keys the alignment can touch: one chart-year month, or every editable month when `key` is null. */
  function alignmentMonths(act, key) {
    if (!act) return []
    if (key) {
      const { y, m } = parseKey(key)
      return y === year.value && isMonthEditable(act, year.value, m) ? [key] : []
    }
    const keys = []
    for (let m = 0; m < 12; m++) if (isMonthEditable(act, year.value, m)) keys.push(monthKey(year.value, m))
    return keys
  }

  /**
   * Quota freed by other activities that end during the month, placed on this activity through
   * the month's last working day. `key` null covers every editable month of the chart year.
   * Does not change assignments.
   */
  function previewReleased(actId, key) {
    const a = getActivity(actId)
    if (!a) return { assignments: [], changes: [] }
    return planReleasedAlignment(a, state.value.activities, results.value, ctx.value, alignmentMonths(a, key))
  }

  /** Applies previewReleased. A second call is a no-op once that freed quota is already here. */
  function alignReleased(actId, key) {
    const plan = previewReleased(actId, key)
    const a = getActivity(actId)
    if (a && plan.changes.length) a.assignments = plan.assignments
    return plan
  }

  function toggleExpanded(id) {
    expanded.value[id] = !expanded.value[id]
  }

  // Persistence

  function exportJson() {
    const blob = new Blob([JSON.stringify(state.value, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `horizon-roadmap-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function importJson(file) {
    const parsed = JSON.parse(await file.text())
    if (!isValidState(parsed)) throw new Error('This file is not a Horizon roadmap export.')
    if (parsed.version !== VERSION) throw new Error('This file was exported by another version of Horizon.')
    state.value = {
      ...defaultState(),
      ...parsed,
      activities: parsed.activities.map((a) => ({ ...a, assignments: a.assignments || [] })),
    }
    editingId.value = null
  }

  function reset() {
    state.value = defaultState()
    editingId.value = null
    expanded.value = {}
  }

  return {
    state,
    year,
    cal,
    ctx,
    pools,
    members,
    memberLoad,
    memberDaily,
    overloads,
    overloadsFor,
    results,
    load,
    allocByActivity,
    activitiesByLane,
    editingId,
    editing,
    expanded,
    calendarModal,
    burndownId,
    getActivity,
    getPool,
    setBusinessDays,
    addPool,
    updatePool,
    removePool,
    addMember,
    updateMember,
    removeMember,
    isAssigned,
    setDayWorking,
    resetCalendar,
    openCalendar,
    addSwimlane,
    updateSwimlane,
    removeSwimlane,
    setSwimlaneOrder,
    addActivity,
    updateActivity,
    removeActivity,
    moveActivity,
    resizeActivity,
    addAssignment,
    updateAssignment,
    removeAssignment,
    splitAssignment,
    hasAssignmentIn,
    assignFromMonth,
    moveAssignment,
    assignEvenly,
    clearAssignments,
    previewReleased,
    alignReleased,
    toggleExpanded,
    exportJson,
    importJson,
    reset,
  }
})
