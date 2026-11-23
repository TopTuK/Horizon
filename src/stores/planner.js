import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useStorage } from '@vueuse/core'
import { YEARS, addDays, addMonthsKey, diffDays, monthKey, parseISO, toISO } from '../lib/calendar'
import { buildEvenAllocation, computeActivity, memberLoads, poolLoad } from '../lib/planning'
import { isDefaultWorking, makeCalendar } from '../lib/workdays'

const STORAGE_KEY = 'horizon-state'
const VERSION = 3
const LANE_COLORS = ['#818cf8', '#34d399', '#f472b6', '#fbbf24', '#38bdf8', '#a78bfa', '#fb7185', '#2dd4bf']
export const POOL_COLORS = ['#818cf8', '#34d399', '#fbbf24', '#f472b6', '#38bdf8', '#fb7185', '#a78bfa', '#2dd4bf']
const DEFAULT_HOURS = 6
const DEFAULT_BUSINESS_DAYS = 221

const uid = () => Math.random().toString(36).slice(2, 10)
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
  const poolsOk = Array.isArray(s?.pools) || (s?.pools?.dev && s?.pools?.test)
  return s && typeof s === 'object' && poolsOk && Array.isArray(s.swimlanes) && Array.isArray(s.activities)
}

/** Old allocations stored a head count per pool ({ dev: 2.5 }); spread it over named members. */
function spreadCount(count, members) {
  const out = {}
  if (!(count > 0) || !members.length) return out
  if (count > members.length) {
    for (const m of members) out[m.id] = round(count / members.length)
    return out
  }
  members.forEach((m, i) => {
    const v = round(Math.min(1, count - i))
    if (v > 0) out[m.id] = v
  })
  return out
}

/**
 * v1 stored a working-day count per month; v2 stored two anonymous pools (dev/test) with a head
 * count and per-month head counts on activities. v3 has named pools of individual members.
 */
function migrate(s) {
  if (s.version === VERSION && Array.isArray(s.pools)) return { ...defaultState(), ...s }
  const { calendar, pools: old = {}, ...rest } = s
  const pools = [
    makePool('dev', 'Developer Pool', 'Developer', POOL_COLORS[0], old.dev?.count ?? 8, old.dev?.hoursPerDay ?? DEFAULT_HOURS),
    makePool('test', 'Testing Pool', 'Tester', POOL_COLORS[1], old.test?.count ?? 4, old.test?.hoursPerDay ?? DEFAULT_HOURS),
  ]
  const activities = (rest.activities || []).map((a) => {
    const alloc = {}
    for (const [key, entry] of Object.entries(a.alloc || {})) {
      const merged = Object.assign({}, ...pools.map((p) => spreadCount(entry?.[p.id] || 0, p.members)))
      if (Object.keys(merged).length) alloc[key] = merged
    }
    return { ...a, estimate: { dev: a.estimate?.dev || 0, test: a.estimate?.test || 0 }, alloc }
  })
  return {
    ...defaultState(),
    ...rest,
    pools,
    activities,
    businessDays: old.dev?.businessDays ?? DEFAULT_BUSINESS_DAYS,
    dayOverrides: rest.dayOverrides || {},
    version: VERSION,
  }
}

export const usePlanner = defineStore('planner', () => {
  const state = useStorage(STORAGE_KEY, defaultState(), localStorage, { mergeDefaults: true })
  if (state.value.version !== VERSION || !Array.isArray(state.value.pools)) state.value = migrate(state.value)
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

  const load = computed(() => poolLoad(ctx.value, results.value, memberLoad.value, year.value))

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
    for (const a of state.value.activities) {
      for (const [key, entry] of Object.entries(a.alloc || {})) {
        for (const id of Object.keys(entry)) if (ids.has(id)) delete entry[id]
        if (!Object.keys(entry).length) delete a.alloc[key]
      }
    }
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
    return state.value.activities.some((a) => Object.values(a.alloc || {}).some((e) => e[memberId] > 0))
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

  function addActivity(laneId, start, mode = 'estimate') {
    const s = parseISO(start)
    const activity = {
      id: uid(),
      laneId,
      name: `Activity ${state.value.activities.length + 1}`,
      mode,
      start,
      end: addDays(start, 59),
      estimate: Object.fromEntries(state.value.pools.map((p, i) => [p.id, i === 0 ? 480 : 120])),
      alloc: {},
    }
    const first = state.value.pools[0]?.members[0]
    if (mode === 'estimate' && first) activity.alloc[monthKey(s.y, s.m)] = { [first.id]: 1 }
    state.value.activities.push(activity)
    expanded.value[activity.id] = true
    return activity
  }

  function updateActivity(id, patch) {
    const a = getActivity(id)
    if (!a) return
    Object.assign(a, patch)
    if (a.mode === 'fixed' && a.end < a.start) a.end = a.start
  }

  function removeActivity(id) {
    state.value.activities = state.value.activities.filter((a) => a.id !== id)
    if (editingId.value === id) editingId.value = null
  }

  /** Moves the start date, keeping the duration (fixed) and shifting allocations by whole months. */
  function moveActivity(id, newStart, laneId) {
    const a = getActivity(id)
    if (!a || !newStart) return
    const o = parseISO(a.start)
    const n = parseISO(newStart)
    const monthShift = n.y * 12 + n.m - (o.y * 12 + o.m)
    if (a.mode === 'fixed') a.end = addDays(a.end, diffDays(a.start, newStart))
    a.start = newStart
    if (monthShift) {
      a.alloc = Object.fromEntries(Object.entries(a.alloc).map(([k, v]) => [addMonthsKey(k, monthShift), v]))
    }
    if (laneId) a.laneId = laneId
  }

  function resizeActivity(id, edge, date) {
    const a = getActivity(id)
    if (!a) return
    if (edge === 'start') a.start = date <= a.end ? date : a.end
    else a.end = date >= a.start ? date : a.start
  }

  /** Sets the multiplier (share of daily efficient hours) of a member in one month of an activity. */
  function setAlloc(id, key, memberId, value) {
    const a = getActivity(id)
    if (!a || !members.value[memberId]) return
    const v = Math.max(0, Math.min(5, round(Number(value) || 0)))
    const entry = { ...(a.alloc[key] || {}) }
    if (v > 0) entry[memberId] = v
    else delete entry[memberId]
    if (Object.keys(entry).length) a.alloc[key] = entry
    else delete a.alloc[key]
  }

  function getAlloc(id, key, memberId) {
    return getActivity(id)?.alloc[key]?.[memberId] || 0
  }

  /** Moves a member's assignment from one activity month to another (adding to what is there). */
  function moveAlloc(fromId, fromKey, toId, toKey, memberId) {
    if (fromId === toId && fromKey === toKey) return
    const v = getAlloc(fromId, fromKey, memberId)
    if (!v) return
    setAlloc(fromId, fromKey, memberId, 0)
    setAlloc(toId, toKey, memberId, getAlloc(toId, toKey, memberId) + v)
  }

  /** Copies all assignments of one month onto another month of the same activity. */
  function copyMonth(id, fromKey, toKey) {
    const a = getActivity(id)
    if (!a) return
    if (a.alloc[fromKey]) a.alloc[toKey] = { ...a.alloc[fromKey] }
    else delete a.alloc[toKey]
  }

  /** options: { memberIds, multiplier } */
  function fillEvenly(id, options) {
    const a = getActivity(id)
    if (!a) return
    a.alloc = buildEvenAllocation(a, ctx.value, options)
  }

  function clearAlloc(id) {
    const a = getActivity(id)
    if (a) a.alloc = {}
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
    state.value = migrate(parsed)
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
    results,
    load,
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
    setAlloc,
    getAlloc,
    moveAlloc,
    copyMonth,
    fillEvenly,
    clearAlloc,
    toggleExpanded,
    exportJson,
    importJson,
    reset,
  }
})
