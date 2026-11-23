import { addDays, daysInMonth, diffDays, endOfMonthISO, monthKey, parseISO, parseKey, toISO } from './calendar'

const MAX_MONTHS = 120
const MAX_TAIL_MONTHS = 36
const EPS = 1e-9

/*
 * All functions take a planning context: { pools, members, cal, businessDays }.
 * - pools: [{ id, name, color, members: [{ id, name, hoursPerDay }] }]
 * - members: index memberId -> { ...member, poolId }
 * - cal: makeCalendar() result that knows which individual days are working days
 * Allocations are stored per activity as alloc['YYYY-MM'] = { [memberId]: multiplier },
 * where the multiplier is the share of the member's efficient daily hours spent on the activity.
 */

export const byPool = (ctx, fn = () => 0) => Object.fromEntries(ctx.pools.map((p) => [p.id, fn(p)]))

export const sumValues = (obj) => Object.values(obj || {}).reduce((s, v) => s + (v || 0), 0)

/** Efficient hours per working day of the whole pool. */
export function poolDayHours(pool) {
  return pool.members.reduce((s, m) => s + (m.hoursPerDay || 0), 0)
}

/** Average efficient hours per member per day (falls back to 6 for an empty pool). */
export function avgMemberHours(pool) {
  return pool.members.length ? poolDayHours(pool) / pool.members.length : 6
}

/** Yearly man-hours of the pool, limited by the shared business days per year. */
export function poolYearHours(ctx, pool, y) {
  return poolDayHours(pool) * Math.min(ctx.businessDays, ctx.cal.yearCount(y))
}

/** Man-hours the whole pool can deliver in a month. */
export function poolMonthCapacity(ctx, pool, y, m) {
  return poolDayHours(pool) * ctx.cal.monthCount(y, m)
}

/** Members of a pool assigned in a month entry: [{ id, mult, hpd }], plus totals. */
function poolAssignment(ctx, poolId, entry) {
  const list = []
  let people = 0
  let rate = 0
  for (const [id, mult] of Object.entries(entry || {})) {
    const member = ctx.members[id]
    if (!member || member.poolId !== poolId || !(mult > 0)) continue
    list.push({ id, mult, hpd: member.hoursPerDay || 0 })
    people += mult
    rate += mult * (member.hoursPerDay || 0)
  }
  return { list, people, rate }
}

function lastAllocatedKey(act, ctx, fromKey) {
  let last = null
  for (const [key, entry] of Object.entries(act.alloc || {})) {
    if (key < fromKey) continue
    if (Object.entries(entry || {}).some(([id, v]) => v > 0 && ctx.members[id])) {
      if (!last || key > last) last = key
    }
  }
  return last
}

function emptyMonth(ctx, workingDays) {
  return { workingDays, pools: byPool(ctx, () => ({ people: 0, hours: 0, load: 0 })), members: {} }
}

function computeFixed(act, ctx) {
  const start = act.start
  const end = act.end && act.end >= start ? act.end : start
  const s = parseISO(start)
  const e = parseISO(end)
  const months = {}
  const planned = byPool(ctx)
  let workingDays = 0

  for (let y = s.y, m = s.m; y * 12 + m <= e.y * 12 + e.m; m === 11 ? (y++, (m = 0)) : m++) {
    const firstDay = y === s.y && m === s.m ? s.d : 1
    const lastDay = y === e.y && m === e.m ? e.d : daysInMonth(y, m)
    const covered = ctx.cal.countRange(y, m, firstDay, lastDay)
    const monthTotal = ctx.cal.monthCount(y, m)
    const key = monthKey(y, m)
    const entry = emptyMonth(ctx, covered)
    workingDays += covered
    for (const pool of ctx.pools) {
      const { list, people, rate } = poolAssignment(ctx, pool.id, act.alloc?.[key])
      const hours = rate * covered
      entry.pools[pool.id] = { people, hours, load: monthTotal ? (people * covered) / monthTotal : 0 }
      for (const a of list) {
        entry.members[a.id] = { mult: a.mult, hours: a.mult * a.hpd * covered, load: monthTotal ? (a.mult * covered) / monthTotal : 0 }
      }
      planned[pool.id] += hours
    }
    months[key] = entry
  }

  return {
    mode: 'fixed',
    start,
    end,
    complete: true,
    tailEnd: null,
    planned,
    required: null,
    missing: byPool(ctx),
    hint: null,
    months,
    durationDays: diffDays(start, end) + 1,
    workingDays,
  }
}

function computeEstimate(act, ctx) {
  const start = act.start
  const s = parseISO(start)
  const startKey = monthKey(s.y, s.m)
  const required = byPool(ctx, (p) => Math.max(0, act.estimate?.[p.id] || 0))
  const remaining = { ...required }
  const doneAt = byPool(ctx, (p) => (required[p.id] <= 0 ? start : null))
  const allDone = () => Object.values(doneAt).every(Boolean)
  const planned = byPool(ctx)
  const months = {}
  const lastKey = lastAllocatedKey(act, ctx, startKey) || startKey
  let workingDays = 0

  let y = s.y
  let m = s.m
  for (let i = 0; i < MAX_MONTHS; i++) {
    const key = monthKey(y, m)
    if (key > lastKey || allDone()) break
    const monthTotal = ctx.cal.monthCount(y, m)
    const days = i === 0 ? ctx.cal.monthDays(y, m).filter((d) => d >= s.d) : ctx.cal.monthDays(y, m)
    const entry = emptyMonth(ctx, 0)
    let lastUsedDay = 0

    for (const pool of ctx.pools) {
      const p = pool.id
      const { list, people, rate } = poolAssignment(ctx, p, act.alloc?.[key])
      entry.pools[p].people = people
      if (doneAt[p] || !days.length || rate <= 0) {
        for (const a of list) entry.members[a.id] = { mult: a.mult, hours: 0, load: 0 }
        continue
      }
      const avail = rate * days.length
      // Number of working days the pool works on the activity this month.
      let usedDays
      if (avail >= remaining[p] - EPS) {
        usedDays = remaining[p] / rate
        const needed = Math.max(1, Math.ceil(usedDays - EPS))
        doneAt[p] = toISO(y, m, days[needed - 1])
        entry.pools[p].hours = remaining[p]
        lastUsedDay = Math.max(lastUsedDay, needed)
        remaining[p] = 0
      } else {
        usedDays = days.length
        entry.pools[p].hours = avail
        remaining[p] -= avail
        lastUsedDay = days.length
      }
      entry.pools[p].load = monthTotal ? (people * usedDays) / monthTotal : 0
      for (const a of list) {
        entry.members[a.id] = {
          mult: a.mult,
          hours: a.mult * a.hpd * usedDays,
          load: monthTotal ? (a.mult * usedDays) / monthTotal : 0,
        }
      }
      planned[p] += entry.pools[p].hours
    }
    entry.workingDays = lastUsedDay
    workingDays += lastUsedDay
    months[key] = entry
    m === 11 ? (y++, (m = 0)) : m++
  }

  const complete = allDone()
  const missing = byPool(ctx, (p) => Math.max(0, remaining[p.id]))
  let end
  let tailEnd = null
  let hint = null

  if (complete) {
    end = Object.values(doneAt).reduce((a, b) => (b > a ? b : a), start)
  } else {
    const lk = parseKey(lastKey)
    end = endOfMonthISO(lk.y, lk.m)
    const nextY = lk.m === 11 ? lk.y + 1 : lk.y
    const nextM = (lk.m + 1) % 12
    const nextDays = ctx.cal.monthCount(nextY, nextM) || 21
    let tailMonths = 0
    hint = {}
    for (const pool of ctx.pools) {
      const p = pool.id
      if (missing[p] <= 0) continue
      const personMonth = avgMemberHours(pool) * nextDays || 1
      const lastRate = poolAssignment(ctx, p, act.alloc?.[lastKey]).rate
      const rateMonth = Math.max(lastRate * nextDays, personMonth)
      tailMonths = Math.max(tailMonths, missing[p] / rateMonth)
      hint[p] = missing[p] / personMonth
    }
    tailEnd = addDays(end, Math.round(Math.min(MAX_TAIL_MONTHS, tailMonths) * 30.4))
  }

  return {
    mode: 'estimate',
    start,
    end,
    complete,
    tailEnd,
    planned,
    required,
    missing,
    hint,
    months,
    durationDays: diffDays(start, end) + 1,
    workingDays,
  }
}

export function computeActivity(act, ctx) {
  return act.mode === 'fixed' ? computeFixed(act, ctx) : computeEstimate(act, ctx)
}

/** Share of each member's month taken by all activities: { 'YYYY-MM': { memberId: load } }. */
export function memberLoads(results) {
  const out = {}
  for (const r of Object.values(results)) {
    for (const [key, e] of Object.entries(r.months)) {
      for (const [id, v] of Object.entries(e.members)) {
        const row = (out[key] ||= {})
        row[id] = (row[id] || 0) + v.load
      }
    }
  }
  return out
}

export const isOverloaded = (load) => load > 1 + 1e-6

/** Monthly load of every pool for a year, given precomputed activity results and member loads. */
export function poolLoad(ctx, results, mLoads, year) {
  return Array.from({ length: 12 }, (_, m) => {
    const key = monthKey(year, m)
    const members = mLoads[key] || {}
    const row = { key, month: m, members, pools: {} }
    for (const pool of ctx.pools) {
      const capacity = poolMonthCapacity(ctx, pool, year, m)
      let hours = 0
      let load = 0
      for (const r of Object.values(results)) {
        const e = r.months[key]?.pools[pool.id]
        if (!e) continue
        hours += e.hours
        load += e.load
      }
      const overMembers = pool.members.filter((mem) => isOverloaded(members[mem.id] || 0))
      row.pools[pool.id] = {
        capacity,
        hours,
        load,
        count: pool.members.length,
        utilization: capacity ? hours / capacity : 0,
        overMembers,
        over: load > pool.members.length + 1e-6 || overMembers.length > 0,
      }
    }
    return row
  })
}

/**
 * Assigns the given members with one multiplier: every month of a fixed activity's span, or
 * month by month from the start of an estimated activity until each involved pool's estimate
 * is covered (other existing assignments are kept and counted).
 */
export function buildEvenAllocation(act, ctx, { memberIds, multiplier }) {
  const selected = new Set(memberIds.filter((id) => ctx.members[id]))
  const alloc = {}
  for (const [key, entry] of Object.entries(act.alloc || {})) {
    const kept = Object.fromEntries(Object.entries(entry).filter(([id]) => !selected.has(id)))
    if (Object.keys(kept).length) alloc[key] = kept
  }
  const mult = Math.max(0, Number(multiplier) || 0)
  if (!selected.size || !mult) return alloc

  const s = parseISO(act.start)
  if (act.mode === 'fixed') {
    const e = parseISO(act.end || act.start)
    for (let y = s.y, m = s.m; y * 12 + m <= e.y * 12 + e.m; m === 11 ? (y++, (m = 0)) : m++) {
      const key = monthKey(y, m)
      alloc[key] = { ...(alloc[key] || {}) }
      for (const id of selected) alloc[key][id] = mult
    }
    return alloc
  }

  const remaining = byPool(ctx, (p) => Math.max(0, act.estimate?.[p.id] || 0))
  const selectedPools = new Set([...selected].map((id) => ctx.members[id].poolId))
  const pending = () => [...selectedPools].some((p) => remaining[p] > EPS)
  let y = s.y
  let m = s.m
  for (let i = 0; i < MAX_MONTHS && pending(); i++) {
    const key = monthKey(y, m)
    const days = i === 0 ? ctx.cal.countRange(y, m, s.d, 31) : ctx.cal.monthCount(y, m)
    const entry = { ...(alloc[key] || {}) }
    for (const id of selected) {
      if (remaining[ctx.members[id].poolId] > EPS) entry[id] = mult
    }
    for (const pool of ctx.pools) {
      remaining[pool.id] -= poolAssignment(ctx, pool.id, entry).rate * days
    }
    if (Object.keys(entry).length) alloc[key] = entry
    m === 11 ? (y++, (m = 0)) : m++
  }
  return alloc
}

const BURNDOWN_MAX_POINTS = 180

export function hasBurndown(act, result) {
  return sumValues(act.mode === 'fixed' ? result.planned : result.required) > 0
}

const weekIndex = (iso) => {
  const { y, m, d } = parseISO(iso)
  return Math.floor((Date.UTC(y, m, d) / 86400000 + 3) / 7)
}

/**
 * Planned remaining hours per working day from the start to the (calculated) end date,
 * using the same working-day and allocation rules as computeActivity.
 */
export function computeBurndown(act, ctx, result) {
  const isFixed = act.mode === 'fixed'
  const initial = { ...(isFixed ? result.planned : result.required) }
  const remaining = { ...initial }
  const s = parseISO(result.start)
  const e = parseISO(result.end)
  const days = []

  for (let y = s.y, m = s.m; y * 12 + m <= e.y * 12 + e.m; m === 11 ? (y++, (m = 0)) : m++) {
    const key = monthKey(y, m)
    const rates = byPool(ctx, (p) => poolAssignment(ctx, p.id, act.alloc?.[key]).rate)
    for (const d of ctx.cal.monthDays(y, m)) {
      const iso = toISO(y, m, d)
      if (iso < result.start || iso > result.end) continue
      for (const p of Object.keys(remaining)) remaining[p] = Math.max(0, remaining[p] - (rates[p] || 0))
      days.push({ date: iso, pools: { ...remaining } })
    }
  }

  const total0 = sumValues(initial)
  const n = days.length
  const all = [{ date: result.start, pools: { ...initial } }, ...days].map((p, i) => ({
    ...p,
    total: sumValues(p.pools),
    ideal: n ? total0 * (1 - i / n) : 0,
  }))

  const points =
    n > BURNDOWN_MAX_POINTS
      ? all.filter((p, i) => i === 0 || i === all.length - 1 || weekIndex(p.date) !== weekIndex(all[i + 1].date))
      : all

  const left = sumValues(remaining)
  return {
    points,
    initial: { pools: initial, total: total0 },
    leftover: isFixed ? byPool(ctx) : remaining,
    workingDays: n,
    avgPerDay: n ? (total0 - left) / n : 0,
    sampled: n > BURNDOWN_MAX_POINTS,
  }
}

/** Non-zero per-pool values joined for display, e.g. "120 h Developer Pool · 40 h Testing Pool". */
export function describeByPool(pools, values, min = 0.5) {
  return pools
    .filter((p) => (values?.[p.id] || 0) > min)
    .map((p) => `${fmtHours(values[p.id])} h ${p.name}`)
    .join(' · ')
}

/** Short avatar label: "Developer 3" -> "D3", "Jane Smith" -> "JS". */
export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  const last = parts[parts.length - 1]
  return (parts[0][0] + (/^\d+$/.test(last) ? last : last[0])).toUpperCase()
}

export function fmtHours(h) {
  return Math.round(h).toLocaleString('en-US')
}

export function fmtNum(n, digits = 1) {
  return Number(n.toFixed(digits)).toLocaleString('en-US')
}
