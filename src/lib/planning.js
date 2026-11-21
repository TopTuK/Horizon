import { addDays, daysInMonth, diffDays, endOfMonthISO, monthKey, parseISO, parseKey, toISO } from './calendar'

export const POOLS = ['dev', 'test']
const MAX_MONTHS = 120
const MAX_TAIL_MONTHS = 36

/*
 * All functions take a planning context: { pools, cal }, where `cal` comes from
 * makeCalendar() and knows which individual days are working days.
 */

/** Effective hours one person of the pool delivers per working day. */
export function personDayHours(ctx, poolId) {
  return ctx.pools[poolId].hoursPerDay
}

/** Yearly man-hours of the whole pool, limited by its business days per year. */
export function poolYearHours(ctx, poolId, y) {
  const pool = ctx.pools[poolId]
  return pool.count * Math.min(pool.businessDays, ctx.cal.yearCount(y)) * pool.hoursPerDay
}

/** Effective hours one person of the pool delivers in a full month. */
export function personMonthHours(ctx, poolId, y, m) {
  return ctx.cal.monthCount(y, m) * personDayHours(ctx, poolId)
}

function lastAllocatedKey(act, fromKey) {
  let last = null
  for (const [key, a] of Object.entries(act.alloc || {})) {
    if (key < fromKey) continue
    if ((a.dev || 0) > 0 || (a.test || 0) > 0) {
      if (!last || key > last) last = key
    }
  }
  return last
}

function emptyMonth(workingDays) {
  return {
    workingDays,
    dev: { people: 0, hours: 0, load: 0 },
    test: { people: 0, hours: 0, load: 0 },
  }
}

function computeFixed(act, ctx) {
  const start = act.start
  const end = act.end && act.end >= start ? act.end : start
  const s = parseISO(start)
  const e = parseISO(end)
  const months = {}
  const planned = { dev: 0, test: 0 }
  let workingDays = 0

  for (let y = s.y, m = s.m; y * 12 + m <= e.y * 12 + e.m; m === 11 ? (y++, (m = 0)) : m++) {
    const firstDay = y === s.y && m === s.m ? s.d : 1
    const lastDay = y === e.y && m === e.m ? e.d : daysInMonth(y, m)
    const covered = ctx.cal.countRange(y, m, firstDay, lastDay)
    const monthTotal = ctx.cal.monthCount(y, m)
    const key = monthKey(y, m)
    const entry = emptyMonth(covered)
    workingDays += covered
    for (const p of POOLS) {
      const people = act.alloc?.[key]?.[p] || 0
      const hours = people * personDayHours(ctx, p) * covered
      entry[p] = { people, hours, load: monthTotal ? (people * covered) / monthTotal : 0 }
      planned[p] += hours
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
    missing: { dev: 0, test: 0 },
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
  const required = { dev: Math.max(0, act.estimate?.dev || 0), test: Math.max(0, act.estimate?.test || 0) }
  const remaining = { ...required }
  const doneAt = { dev: required.dev <= 0 ? start : null, test: required.test <= 0 ? start : null }
  const planned = { dev: 0, test: 0 }
  const months = {}
  const lastKey = lastAllocatedKey(act, startKey) || startKey
  let workingDays = 0

  let y = s.y
  let m = s.m
  for (let i = 0; i < MAX_MONTHS; i++) {
    const key = monthKey(y, m)
    if (key > lastKey || (doneAt.dev && doneAt.test)) break
    const monthTotal = ctx.cal.monthCount(y, m)
    const days = i === 0 ? ctx.cal.monthDays(y, m).filter((d) => d >= s.d) : ctx.cal.monthDays(y, m)
    const entry = emptyMonth(0)
    let lastUsedDay = 0

    for (const p of POOLS) {
      const people = act.alloc?.[key]?.[p] || 0
      entry[p].people = people
      if (doneAt[p] || !days.length) continue
      const pdh = personDayHours(ctx, p)
      const rate = people * pdh
      const avail = rate * days.length
      if (rate > 0 && avail >= remaining[p] - 1e-9) {
        const needed = Math.max(1, Math.ceil(remaining[p] / rate - 1e-9))
        const doneDay = days[needed - 1]
        doneAt[p] = toISO(y, m, doneDay)
        entry[p].hours = remaining[p]
        entry[p].load = remaining[p] / (pdh * monthTotal)
        lastUsedDay = Math.max(lastUsedDay, needed)
        remaining[p] = 0
      } else {
        entry[p].hours = avail
        entry[p].load = (people * days.length) / monthTotal
        remaining[p] -= avail
        lastUsedDay = days.length
      }
      planned[p] += entry[p].hours
    }
    entry.workingDays = lastUsedDay
    workingDays += lastUsedDay
    months[key] = entry
    m === 11 ? (y++, (m = 0)) : m++
  }

  const complete = !!(doneAt.dev && doneAt.test)
  const missing = { dev: Math.max(0, remaining.dev), test: Math.max(0, remaining.test) }
  let end
  let tailEnd = null
  let hint = null

  if (complete) {
    end = doneAt.dev > doneAt.test ? doneAt.dev : doneAt.test
  } else {
    const lk = parseKey(lastKey)
    end = endOfMonthISO(lk.y, lk.m)
    const nextY = lk.m === 11 ? lk.y + 1 : lk.y
    const nextM = (lk.m + 1) % 12
    let tailMonths = 0
    hint = {}
    for (const p of POOLS) {
      if (missing[p] <= 0) continue
      const pmh = personMonthHours(ctx, p, nextY, nextM) || 1
      const rate = Math.max(1, act.alloc?.[lastKey]?.[p] || 0)
      tailMonths = Math.max(tailMonths, missing[p] / (rate * pmh))
      hint[p] = missing[p] / pmh
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

/** Monthly load of both pools for a year, given precomputed activity results. */
export function poolLoad(ctx, results, year) {
  return Array.from({ length: 12 }, (_, m) => {
    const key = monthKey(year, m)
    const row = { key, month: m }
    for (const p of POOLS) {
      const capacity = ctx.pools[p].count * personMonthHours(ctx, p, year, m)
      let hours = 0
      let load = 0
      for (const r of Object.values(results)) {
        const e = r.months[key]
        if (!e) continue
        hours += e[p].hours
        load += e[p].load
      }
      row[p] = {
        capacity,
        hours,
        load,
        count: ctx.pools[p].count,
        utilization: capacity ? hours / capacity : 0,
        over: load > ctx.pools[p].count + 1e-6,
      }
    }
    return row
  })
}

/**
 * Builds a per-month allocation that completes an estimate activity using a constant
 * number of people per pool, or covers the whole span of a fixed activity.
 */
export function buildEvenAllocation(act, ctx, perMonth) {
  const s = parseISO(act.start)
  const alloc = {}
  if (act.mode === 'fixed') {
    const e = parseISO(act.end || act.start)
    for (let y = s.y, m = s.m; y * 12 + m <= e.y * 12 + e.m; m === 11 ? (y++, (m = 0)) : m++) {
      alloc[monthKey(y, m)] = { dev: perMonth.dev, test: perMonth.test }
    }
    return alloc
  }
  const remaining = { dev: act.estimate?.dev || 0, test: act.estimate?.test || 0 }
  const pending = () => POOLS.some((p) => remaining[p] > 1e-9 && perMonth[p] > 0)
  let y = s.y
  let m = s.m
  for (let i = 0; i < MAX_MONTHS && pending(); i++) {
    const days = i === 0 ? ctx.cal.countRange(y, m, s.d, 31) : ctx.cal.monthCount(y, m)
    const entry = { dev: 0, test: 0 }
    for (const p of POOLS) {
      if (remaining[p] <= 1e-9 || !perMonth[p]) continue
      entry[p] = perMonth[p]
      remaining[p] -= perMonth[p] * personDayHours(ctx, p) * days
    }
    alloc[monthKey(y, m)] = entry
    m === 11 ? (y++, (m = 0)) : m++
  }
  return alloc
}

const BURNDOWN_MAX_POINTS = 180

export function hasBurndown(act, result) {
  if (act.mode === 'fixed') return result.planned.dev + result.planned.test > 0
  return result.required.dev + result.required.test > 0
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
  const initial = isFixed ? { ...result.planned } : { ...result.required }
  const remaining = { ...initial }
  const s = parseISO(result.start)
  const e = parseISO(result.end)
  const days = []

  for (let y = s.y, m = s.m; y * 12 + m <= e.y * 12 + e.m; m === 11 ? (y++, (m = 0)) : m++) {
    const key = monthKey(y, m)
    for (const d of ctx.cal.monthDays(y, m)) {
      const iso = toISO(y, m, d)
      if (iso < result.start || iso > result.end) continue
      for (const p of POOLS) {
        const burn = (act.alloc?.[key]?.[p] || 0) * personDayHours(ctx, p)
        remaining[p] = Math.max(0, remaining[p] - burn)
      }
      days.push({ date: iso, dev: remaining.dev, test: remaining.test })
    }
  }

  const total0 = initial.dev + initial.test
  const n = days.length
  const all = [{ date: result.start, dev: initial.dev, test: initial.test }, ...days].map((p, i) => ({
    ...p,
    total: p.dev + p.test,
    ideal: n ? total0 * (1 - i / n) : 0,
  }))

  const points =
    n > BURNDOWN_MAX_POINTS
      ? all.filter((p, i) => i === 0 || i === all.length - 1 || weekIndex(p.date) !== weekIndex(all[i + 1].date))
      : all

  return {
    points,
    initial: { ...initial, total: total0 },
    leftover: isFixed ? { dev: 0, test: 0 } : { dev: remaining.dev, test: remaining.test },
    workingDays: n,
    avgPerDay: n ? (total0 - remaining.dev - remaining.test) / n : 0,
    sampled: n > BURNDOWN_MAX_POINTS,
  }
}

export function fmtHours(h) {
  return Math.round(h).toLocaleString('en-US')
}

export function fmtNum(n, digits = 1) {
  return Number(n.toFixed(digits)).toLocaleString('en-US')
}
