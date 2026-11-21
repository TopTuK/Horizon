import { daysInMonth, toISO } from './calendar'

/** Saturday and Sunday are non-working unless overridden. */
export function isDefaultWorking(y, m, d) {
  const dow = new Date(Date.UTC(y, m, d)).getUTCDay()
  return dow !== 0 && dow !== 6
}

/**
 * Working-day calendar built from per-day overrides ({ 'YYYY-MM-DD': boolean }).
 * Overrides are copied up front so a reactive caller tracks every key.
 */
export function makeCalendar(overrides = {}) {
  const ov = { ...overrides }
  const monthCache = new Map()
  const yearCache = new Map()

  function isWorking(y, m, d) {
    const iso = toISO(y, m, d)
    return iso in ov ? ov[iso] : isDefaultWorking(y, m, d)
  }

  /** Sorted day numbers (1-based) that are working days in the month. */
  function monthDays(y, m) {
    const key = y * 12 + m
    let days = monthCache.get(key)
    if (!days) {
      days = []
      for (let d = 1, n = daysInMonth(y, m); d <= n; d++) if (isWorking(y, m, d)) days.push(d)
      monthCache.set(key, days)
    }
    return days
  }

  function monthCount(y, m) {
    return monthDays(y, m).length
  }

  function yearCount(y) {
    if (!yearCache.has(y)) {
      let total = 0
      for (let m = 0; m < 12; m++) total += monthCount(y, m)
      yearCache.set(y, total)
    }
    return yearCache.get(y)
  }

  /** Working days in the month between two day numbers, inclusive. */
  function countRange(y, m, from, to) {
    let n = 0
    for (const d of monthDays(y, m)) if (d >= from && d <= to) n++
    return n
  }

  return { isWorking, monthDays, monthCount, yearCount, countRange }
}
