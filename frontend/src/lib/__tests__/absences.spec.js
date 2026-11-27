import { describe, expect, it } from 'vitest'
import { makeCalendar } from '../workdays'
import { computeActivity, poolDayHours, poolMonthCapacity, poolYearHours } from '../planning'

const HOURS = 6
const WEEK = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09']

function context(absences, businessDays = 221) {
  const member = { id: 'm1', name: 'Developer 1', hoursPerDay: HOURS, absences }
  const pool = { id: 'dev', name: 'Developer Pool', color: '#818cf8', members: [member] }
  return {
    pool,
    ctx: {
      pools: [pool],
      members: { m1: { ...member, poolId: 'dev' } },
      cal: makeCalendar({}),
      businessDays,
    },
  }
}

const range = (from, to, id = 'a') => ({ id, kind: 'vacation', from, to })

describe('absences', () => {
  const cal = makeCalendar({})

  it('leaves capacity unchanged when nobody is away, and a weekend inside a range does not reduce it', () => {
    const { pool, ctx } = context([])
    expect(poolMonthCapacity(ctx, pool, 2026, 0)).toBe(poolDayHours(pool) * cal.monthCount(2026, 0))
    expect(poolYearHours(ctx, pool, 2026)).toBe(poolDayHours(pool) * Math.min(221, cal.yearCount(2026)))

    const weekend = context([range('2026-01-10', '2026-01-11')])
    expect(poolMonthCapacity(weekend.ctx, weekend.pool, 2026, 0)).toBe(poolMonthCapacity(ctx, pool, 2026, 0))
    expect(poolYearHours(weekend.ctx, weekend.pool, 2026)).toBe(poolYearHours(ctx, pool, 2026))
  })

  it('lowers month and year capacity by the working days in a week off', () => {
    const plain = context([])
    const away = context([range('2026-01-05', '2026-01-09')])
    const drop = WEEK.length * HOURS
    expect(poolMonthCapacity(plain.ctx, plain.pool, 2026, 0) - poolMonthCapacity(away.ctx, away.pool, 2026, 0)).toBe(drop)
    expect(poolYearHours(plain.ctx, plain.pool, 2026) - poolYearHours(away.ctx, away.pool, 2026)).toBe(drop)
  })

  it('counts a day covered by two ranges once', () => {
    const plain = context([])
    // Mon 5 – Fri 9 overlaps Wed 7 – Tue 13. The distinct working days are 5–9 and 12–13.
    const overlap = context([range('2026-01-05', '2026-01-09', 'a'), range('2026-01-07', '2026-01-13', 'b')])
    const drop = 7 * HOURS
    expect(poolMonthCapacity(plain.ctx, plain.pool, 2026, 0) - poolMonthCapacity(overlap.ctx, overlap.pool, 2026, 0)).toBe(drop)
    expect(poolYearHours(plain.ctx, plain.pool, 2026) - poolYearHours(overlap.ctx, overlap.pool, 2026)).toBe(drop)
  })

  it('books nothing on days off and finishes an estimate later', () => {
    const act = {
      id: 'a1',
      mode: 'estimate',
      start: '2026-01-05',
      estimate: { dev: 30 },
      assignments: [{ id: 's1', memberId: 'm1', share: 1, from: null, to: null }],
    }
    const done = computeActivity(act, context([]).ctx)
    expect(done.end).toBe('2026-01-09')
    expect(done.planned.dev).toBe(30)

    const later = computeActivity(act, context([range('2026-01-05', '2026-01-09')]).ctx)
    expect(later.end).toBe('2026-01-16')
    expect(later.planned.dev).toBe(30)
    for (const iso of WEEK) expect(later.daily.m1?.[iso] || 0).toBe(0)
    expect(later.daily.m1['2026-01-12']).toBe(HOURS)
  })
})
