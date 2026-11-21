import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useStorage } from '@vueuse/core'
import { YEARS, addDays, addMonthsKey, diffDays, monthKey, parseISO, toISO } from '../lib/calendar'
import { buildEvenAllocation, computeActivity, poolLoad } from '../lib/planning'
import { isDefaultWorking, makeCalendar } from '../lib/workdays'

const STORAGE_KEY = 'horizon-state'
const LANE_COLORS = ['#818cf8', '#34d399', '#f472b6', '#fbbf24', '#38bdf8', '#a78bfa', '#fb7185', '#2dd4bf']

const uid = () => Math.random().toString(36).slice(2, 10)

export function defaultState() {
  return {
    version: 2,
    pools: {
      dev: { count: 8, hoursPerDay: 6, businessDays: 221 },
      test: { count: 4, hoursPerDay: 6, businessDays: 221 },
    },
    /** Days that differ from the default (weekdays working, weekends off): { 'YYYY-MM-DD': isWorking } */
    dayOverrides: {},
    selectedYear: YEARS[0],
    swimlanes: [],
    activities: [],
  }
}

function isValidState(s) {
  return (
    s &&
    typeof s === 'object' &&
    s.pools?.dev &&
    s.pools?.test &&
    Array.isArray(s.swimlanes) &&
    Array.isArray(s.activities)
  )
}

/** Version 1 stored a working-day count per month; the day-level calendar replaces it. */
function migrate(s) {
  const { calendar, ...rest } = s
  return { ...defaultState(), ...rest, dayOverrides: rest.dayOverrides || {}, version: 2 }
}

export const usePlanner = defineStore('planner', () => {
  const state = useStorage(STORAGE_KEY, defaultState(), localStorage, { mergeDefaults: true })
  if (state.value.version !== 2) state.value = migrate(state.value)
  const editingId = ref(null)
  const expanded = ref({})
  const calendarModal = ref({ open: false, month: null })
  const burndownId = ref(null)

  const cal = computed(() => makeCalendar(state.value.dayOverrides))
  const ctx = computed(() => ({ pools: state.value.pools, cal: cal.value }))

  const year = computed({
    get: () => state.value.selectedYear,
    set: (v) => (state.value.selectedYear = v),
  })

  const results = computed(() =>
    Object.fromEntries(state.value.activities.map((a) => [a.id, computeActivity(a, ctx.value)])),
  )

  const load = computed(() => poolLoad(ctx.value, results.value, year.value))

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

  // Pools and calendar

  function setPool(poolId, patch) {
    Object.assign(state.value.pools[poolId], patch)
  }

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
      estimate: { dev: 480, test: 120 },
      alloc: mode === 'estimate' ? { [monthKey(s.y, s.m)]: { dev: 1, test: 0 } } : {},
    }
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

  function setAlloc(id, key, poolId, value) {
    const a = getActivity(id)
    if (!a) return
    const v = Math.max(0, Math.round((Number(value) || 0) * 10) / 10)
    const entry = { dev: 0, test: 0, ...(a.alloc[key] || {}) }
    entry[poolId] = v
    if (!entry.dev && !entry.test) delete a.alloc[key]
    else a.alloc[key] = entry
  }

  function bumpAlloc(id, key, poolId, delta) {
    const a = getActivity(id)
    if (!a) return
    setAlloc(id, key, poolId, (a.alloc[key]?.[poolId] || 0) + delta)
  }

  function fillEvenly(id, perMonth) {
    const a = getActivity(id)
    if (!a) return
    a.alloc = buildEvenAllocation(a, ctx.value, perMonth)
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
    results,
    load,
    activitiesByLane,
    editingId,
    editing,
    expanded,
    calendarModal,
    burndownId,
    getActivity,
    setPool,
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
    bumpAlloc,
    fillEvenly,
    clearAlloc,
    toggleExpanded,
    exportJson,
    importJson,
    reset,
  }
})
