import { addDays, diffDays, monthKey, parseISO } from './calendar'

const MAX_YEARS = 10
const MAX_TAIL_DAYS = 3 * 366
const EPS = 1e-9
const OVER = 1 + 1e-6

/*
 * All functions take a planning context: { pools, members, cal, businessDays }.
 * - pools: [{ id, name, color, members: [{ id, name, hoursPerDay }] }]
 * - members: index memberId -> { ...member, poolId }
 * - cal: makeCalendar() result that knows which individual days are working days
 * Activities carry assignments: [{ id, memberId, share, from, to }], where share is the part of
 * the member's FTE (efficient hours per day) spent on the activity on every working day of the
 * range [from, to]. `to = null` on an estimated activity means "until the estimate is covered".
 */

export const uid = () => Math.random().toString(36).slice(2, 10)

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

/** Effective [from, to] of an assignment inside its activity; to = null means open-ended. */
export function assignmentSpan(act, a) {
  const fixed = act.mode === 'fixed'
  const actEnd = act.end && act.end >= act.start ? act.end : act.start
  const from = a.from && a.from > act.start ? a.from : act.start
  let to = a.to || null
  if (fixed) to = !to || to > actEnd ? actEnd : to
  return { from, to }
}

/** Valid assignments of an activity with member data attached. */
function resolveAssignments(act, ctx) {
  const out = []
  for (const a of act.assignments || []) {
    const member = ctx.members[a.memberId]
    if (!member || !(a.share > 0)) continue
    const { from, to } = assignmentSpan(act, a)
    if (to && to < from) continue
    out.push({ id: a.id, memberId: a.memberId, poolId: member.poolId, share: a.share, hpd: member.hoursPerDay || 0, from, to })
  }
  return out
}

const isActive = (a, iso) => a.from <= iso && (!a.to || iso <= a.to)

function emptyMonth(ctx) {
  return { workingDays: 0, pools: byPool(ctx, () => ({ people: 0, hours: 0, load: 0 })), members: {} }
}

/**
 * Walks the activity day by day. Each working day every active assignment books share × h/day;
 * for an estimated activity a pool stops booking (pro rata on its last day) once its estimate
 * is covered.
 */
export function computeActivity(act, ctx) {
  const fixed = act.mode === 'fixed'
  const start = act.start
  const asg = resolveAssignments(act, ctx)
  const months = {}
  const daily = {}
  const byAssignment = {}
  const burn = []
  const planned = byPool(ctx)
  const required = fixed ? null : byPool(ctx, (p) => Math.max(0, act.estimate?.[p.id] || 0))
  const remaining = fixed ? null : { ...required }
  const doneAt = fixed ? null : byPool(ctx, (p) => (required[p.id] <= 0 ? start : null))
  /** Latest day an assignment of each pool can be active (Infinity when open-ended). */
  const poolHorizon = byPool(ctx, () => '')
  for (const a of asg) {
    const h = a.to || '9999-12-31'
    if (h > poolHorizon[a.poolId]) poolHorizon[a.poolId] = h
  }

  let horizon
  if (fixed) horizon = act.end && act.end >= start ? act.end : start
  else {
    const finite = asg.map((a) => a.to || addDays(start, MAX_YEARS * 366))
    horizon = finite.reduce((x, y) => (y > x ? y : x), start)
  }

  let lastActive = null
  let lastRates = byPool(ctx)
  let days = 0
  const monthPeople = {}

  for (const iso of ctx.cal.workingDaysBetween(start, horizon)) {
    if (!fixed) {
      const pending = ctx.pools.filter((p) => !doneAt[p.id])
      if (!pending.length || pending.every((p) => poolHorizon[p.id] < iso)) break
    }
    days++
    const key = iso.slice(0, 7)
    const month = (months[key] ||= emptyMonth(ctx))
    const people = (monthPeople[key] ||= byPool(ctx))
    const dayPools = byPool(ctx)
    const active = asg.filter((a) => isActive(a, iso))
    const rates = byPool(ctx)
    for (const a of active) rates[a.poolId] += a.share * a.hpd
    lastRates = rates
    let worked = false

    for (const pool of ctx.pools) {
      const p = pool.id
      const rate = rates[p]
      if (rate <= 0) continue
      let scale = 1
      if (!fixed) {
        if (doneAt[p]) continue
        const take = Math.min(rate, remaining[p])
        scale = take / rate
        remaining[p] -= take
        if (remaining[p] <= EPS) {
          remaining[p] = 0
          doneAt[p] = iso
        }
      }
      let fte = 0
      for (const a of active) {
        if (a.poolId !== p) continue
        const hours = a.share * a.hpd * scale
        fte += a.share * scale
        ;(daily[a.memberId] ||= {})[iso] = (daily[a.memberId][iso] || 0) + hours
        byAssignment[a.id] = (byAssignment[a.id] || 0) + hours
        const mem = (month.members[a.memberId] ||= { share: 0, hours: 0, fteDays: 0, load: 0 })
        mem.share = Math.max(mem.share, a.share)
        mem.hours += hours
        mem.fteDays += a.share * scale
        month.pools[p].hours += hours
      }
      const hours = rate * scale
      dayPools[p] = hours
      planned[p] += hours
      month.pools[p].fteDays = (month.pools[p].fteDays || 0) + fte
      people[p] = Math.max(people[p], fte)
      if (hours > 0) worked = true
    }
    if (fixed || worked) {
      month.workingDays++
      if (worked) lastActive = iso
    }
    burn.push({ date: iso, pools: dayPools })
  }

  // Monthly shares: FTE-days divided by the month's working days.
  for (const [key, e] of Object.entries(months)) {
    const { y, m } = { y: +key.slice(0, 4), m: +key.slice(5, 7) - 1 }
    const total = ctx.cal.monthCount(y, m)
    for (const pool of ctx.pools) {
      const pe = e.pools[pool.id]
      pe.people = monthPeople[key]?.[pool.id] || 0
      pe.load = total ? (pe.fteDays || 0) / total : 0
    }
    for (const mem of Object.values(e.members)) mem.load = total ? mem.fteDays / total : 0
  }

  const base = { mode: act.mode, start, planned, required, months, daily, byAssignment, burn }

  if (fixed) {
    return {
      ...base,
      end: horizon,
      complete: true,
      tailEnd: null,
      missing: byPool(ctx),
      hint: null,
      durationDays: diffDays(start, horizon) + 1,
      workingDays: days,
    }
  }

  const complete = Object.values(doneAt).every(Boolean)
  const missing = byPool(ctx, (p) => Math.max(0, remaining[p.id]))
  let end
  let tailEnd = null
  let hint = null
  if (complete) {
    end = Object.values(doneAt).reduce((a, b) => (b > a ? b : a), start)
  } else {
    end = lastActive || start
    let tailDays = 0
    hint = {}
    for (const pool of ctx.pools) {
      const p = pool.id
      if (missing[p] <= 0) continue
      const personDay = avgMemberHours(pool) || 1
      tailDays = Math.max(tailDays, missing[p] / Math.max(lastRates[p], personDay))
      hint[p] = missing[p] / (personDay * 21)
    }
    tailEnd = addDays(end, Math.round(Math.min(MAX_TAIL_DAYS, (tailDays * 7) / 5)))
  }
  const trimmed = burn.filter((d) => d.date <= end)
  return {
    ...base,
    burn: trimmed,
    end,
    complete,
    tailEnd,
    missing,
    hint,
    durationDays: diffDays(start, end) + 1,
    workingDays: trimmed.length,
  }
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

/** Hours of every member on every working day across activities: { memberId: { iso: { hours, acts } } }. */
export function memberDailyLoad(results) {
  const out = {}
  for (const [actId, r] of Object.entries(results)) {
    for (const [memberId, days] of Object.entries(r.daily)) {
      const row = (out[memberId] ||= {})
      for (const [iso, hours] of Object.entries(days)) {
        if (!(hours > EPS)) continue
        const cell = (row[iso] ||= { hours: 0, acts: [] })
        cell.hours += hours
        cell.acts.push(actId)
      }
    }
  }
  return out
}

/** Daily share of 1 FTE (member's efficient hours per day). */
export const dayShare = (ctx, memberId, hours) => {
  const hpd = ctx.members[memberId]?.hoursPerDay || 0
  return hpd > 0 ? hours / hpd : hours > EPS ? Infinity : 0
}

/**
 * Periods of consecutive working days in which a member is booked for more than 1 FTE:
 * [{ memberId, from, to, days, peakShare, activityIds }] sorted by start date.
 */
export function findOverloads(ctx, daily) {
  const out = []
  for (const [memberId, days] of Object.entries(daily)) {
    if (!ctx.members[memberId]) continue
    let run = null
    let prev = null
    for (const iso of Object.keys(days).sort()) {
      const cell = days[iso]
      const share = dayShare(ctx, memberId, cell.hours)
      const contiguous = prev && ctx.cal.nextWorking(addDays(prev, 1)) === iso
      if (share > OVER) {
        if (!run || !contiguous) {
          if (run) out.push(run)
          run = { memberId, from: iso, to: iso, days: 0, peakShare: 0, activityIds: new Set() }
        }
        run.to = iso
        run.days++
        run.peakShare = Math.max(run.peakShare, share)
        for (const a of cell.acts) run.activityIds.add(a)
      } else if (run) {
        out.push(run)
        run = null
      }
      prev = iso
    }
    if (run) out.push(run)
  }
  return out
    .map((o) => ({ ...o, activityIds: [...o.activityIds] }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
}

/** { 'YYYY-MM': Set(memberId) } of members over 1 FTE on at least one day of the month. */
export function overloadedByMonth(overloads) {
  const out = {}
  for (const o of overloads) {
    for (let k = o.from.slice(0, 7); k <= o.to.slice(0, 7); ) {
      ;(out[k] ||= new Set()).add(o.memberId)
      const { y, m } = parseISO(k + '-01')
      k = monthKey(y, m + 1)
    }
  }
  return out
}

/** Highest daily share of 1 FTE per member within a year: { memberId: { share, date } }. */
export function peakDailyShare(ctx, daily, year) {
  const out = {}
  const prefix = `${year}-`
  for (const [memberId, days] of Object.entries(daily)) {
    let best = { share: 0, date: null }
    for (const [iso, cell] of Object.entries(days)) {
      if (!iso.startsWith(prefix)) continue
      const s = dayShare(ctx, memberId, cell.hours)
      if (s > best.share) best = { share: s, date: iso }
    }
    out[memberId] = best
  }
  return out
}

export const isOverloaded = (load) => load > OVER

/** Monthly load of every pool for a year, given activity results, member loads and overloaded members per month. */
export function poolLoad(ctx, results, mLoads, year, overMonths = {}) {
  return Array.from({ length: 12 }, (_, m) => {
    const key = monthKey(year, m)
    const members = mLoads[key] || {}
    const over = overMonths[key] || new Set()
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
      const overMembers = pool.members.filter((mem) => over.has(mem.id))
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
 * Gives every selected member one assignment with the given share over the whole activity
 * (fixed: start → end; estimated: start → until done). Their previous ranges on the activity are
 * replaced; other members' assignments are kept.
 */
export function buildAssignments(act, ctx, { memberIds, share }) {
  const selected = new Set(memberIds.filter((id) => ctx.members[id]))
  const kept = (act.assignments || []).filter((a) => !selected.has(a.memberId))
  const s = Math.max(0, Number(share) || 0)
  if (!selected.size || !s) return kept
  const to = act.mode === 'fixed' ? act.end : null
  return [...kept, ...[...selected].map((memberId) => ({ id: uid(), memberId, share: s, from: act.start, to }))]
}

const BURNDOWN_MAX_POINTS = 180

export function hasBurndown(act, result) {
  return sumValues(act.mode === 'fixed' ? result.planned : result.required) > 0
}

const weekIndex = (iso) => {
  const { y, m, d } = parseISO(iso)
  return Math.floor((Date.UTC(y, m, d) / 86400000 + 3) / 7)
}

/** Planned remaining hours per working day from the start to the (calculated) end date. */
export function computeBurndown(act, ctx, result) {
  const isFixed = act.mode === 'fixed'
  const initial = { ...(isFixed ? result.planned : result.required) }
  const remaining = { ...initial }
  const days = []

  for (const day of result.burn) {
    if (day.date > result.end) break
    for (const p of Object.keys(remaining)) remaining[p] = Math.max(0, remaining[p] - (day.pools[p] || 0))
    days.push({ date: day.date, pools: { ...remaining } })
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
