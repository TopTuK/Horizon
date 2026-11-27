export const YEARS = [2026, 2027, 2028]
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTH_W = 128

const pad = (n) => String(n).padStart(2, '0')

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return { y, m: m - 1, d }
}

export function toISO(y, m, d) {
  const dt = new Date(Date.UTC(y, m, d))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export function monthKey(y, m) {
  const dt = new Date(Date.UTC(y, m, 1))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}`
}

export function parseKey(key) {
  const [y, m] = key.split('-').map(Number)
  return { y, m: m - 1 }
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
}

export function addDays(iso, n) {
  const { y, m, d } = parseISO(iso)
  return toISO(y, m, d + n)
}

export function monthIndex(y, m) {
  return y * 12 + m
}

export function diffDays(a, b) {
  const pa = parseISO(a)
  const pb = parseISO(b)
  return Math.round((Date.UTC(pb.y, pb.m, pb.d) - Date.UTC(pa.y, pa.m, pa.d)) / 86400000)
}

export function endOfMonthISO(y, m) {
  return toISO(y, m, daysInMonth(y, m))
}

export function formatDate(iso) {
  if (!iso) return '—'
  const { y, m, d } = parseISO(iso)
  return `${d} ${MONTHS[m]} ${y}`
}

/** Pixel offset of the start of a day inside the visible year (clamped to the year). */
export function dateToX(iso, year) {
  const { y, m, d } = parseISO(iso)
  if (y < year) return 0
  if (y > year) return 12 * MONTH_W
  return m * MONTH_W + ((d - 1) / daysInMonth(y, m)) * MONTH_W
}

/** Pixel offset of the end of a day (exclusive edge). */
export function dateEndToX(iso, year) {
  return dateToX(addDays(iso, 1), year)
}

export function xToDate(x, year) {
  const clamped = Math.max(0, Math.min(12 * MONTH_W - 1, x))
  const m = Math.floor(clamped / MONTH_W)
  const dim = daysInMonth(year, m)
  const d = Math.floor(((clamped - m * MONTH_W) / MONTH_W) * dim) + 1
  return toISO(year, m, d)
}
