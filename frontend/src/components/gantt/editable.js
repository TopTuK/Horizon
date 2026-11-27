import { monthKey, parseISO } from '../../lib/calendar'

/** Fixed activities accept allocations inside their date range, estimated ones from the start month onward. */
export function isMonthEditable(activity, year, m) {
  const key = monthKey(year, m)
  const s = parseISO(activity.start)
  if (key < monthKey(s.y, s.m)) return false
  if (activity.mode !== 'fixed') return true
  const e = parseISO(activity.end)
  return key <= monthKey(e.y, e.m)
}
