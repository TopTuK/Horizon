<script setup>
import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip } from 'chart.js'
import { AlertTriangle } from 'lucide-vue-next'
import { usePlanner } from '../../stores/planner'
import { MONTHS, formatDate } from '../../lib/calendar'
import { avgMemberHours, describeByPool, fmtHours, fmtNum, memberYearDays, poolDayHours, poolYearHours } from '../../lib/planning'
import { withAlpha } from '../../lib/color'

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend)

const planner = usePlanner()
const pools = computed(() => planner.state.pools)

const calendarDays = computed(() => planner.cal.yearCount(planner.year))

const poolStats = computed(() =>
  pools.value.map((pool) => {
    const p = pool.id
    const capacity = poolYearHours(planner.ctx, pool, planner.year)
    const allocated = planner.load.reduce((s, r) => s + r.pools[p].hours, 0)
    const overMonths = planner.load.filter((r) => r.pools[p].over)
    const idleMonths = planner.load.filter((r) => r.pools[p].utilization < 0.5)
    const avgHours = avgMemberHours(pool)
    return {
      p,
      pool,
      avgHours,
      capacity,
      allocated,
      free: capacity - allocated,
      utilization: capacity ? allocated / capacity : 0,
      manDays: pool.members.reduce((s, m) => s + memberYearDays(planner.ctx, m, planner.year), 0),
      allocatedDays: avgHours ? allocated / avgHours : 0,
      daysMismatch: planner.state.businessDays > calendarDays.value,
      overMonths,
      idleMonths,
    }
  }),
)

/** Per-project monthly share of each pool. Lanes with no hours this year are omitted. */
const projectMonths = computed(() => {
  const rows = []
  for (const lane of planner.state.swimlanes) {
    const series = {}
    for (const pool of pools.value) {
      const p = pool.id
      series[p] = planner.load.map((row) => {
        let hours = 0
        let people = 0
        for (const a of planner.state.activities) {
          if (a.laneId !== lane.id) continue
          const e = planner.results[a.id]?.months[row.key]?.pools[p]
          if (!e) continue
          hours += e.hours || 0
          people += e.people || 0
        }
        const capacity = row.pools[p].capacity
        return { hours, people, pct: capacity ? (hours / capacity) * 100 : 0 }
      })
    }
    const totalHours = pools.value.reduce((sum, pool) => sum + series[pool.id].reduce((s, m) => s + m.hours, 0), 0)
    if (totalHours > 0) rows.push({ lane, series })
  }
  return rows
})

const chartData = computed(() => ({
  labels: MONTHS,
  datasets: projectMonths.value.flatMap(({ lane, series }) =>
    pools.value.map((pool, i) => ({
      label: lane.name,
      stack: pool.id,
      laneName: lane.name,
      poolName: pool.name,
      hours: series[pool.id].map((m) => m.hours),
      people: series[pool.id].map((m) => m.people),
      data: series[pool.id].map((m) => m.pct),
      backgroundColor: i === 0 ? lane.color : withAlpha(lane.color, Math.max(0.25, 0.6 - (i - 1) * 0.15)),
      maxBarThickness: 22,
    })),
  ),
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      onClick(e, legendItem, legend) {
        const chart = legend.chart
        const name = chart.data.datasets[legendItem.datasetIndex]?.label
        const show = !chart.isDatasetVisible(legendItem.datasetIndex)
        chart.data.datasets.forEach((ds, i) => {
          if (ds.label === name) chart.setDatasetVisibility(i, show)
        })
        chart.update()
      },
      labels: {
        color: '#a1a1aa',
        boxWidth: 10,
        filter: (item, data) => data.datasets[item.datasetIndex]?.stack === pools.value[0]?.id,
      },
    },
    tooltip: {
      filter: (item) => (item.dataset.hours?.[item.dataIndex] || 0) > 0,
      callbacks: {
        label: (c) => {
          const hours = c.dataset.hours[c.dataIndex]
          const people = c.dataset.people[c.dataIndex]
          return `${c.dataset.laneName} · ${c.dataset.poolName}: ${fmtNum(c.parsed.y, 0)}% · ${fmtHours(hours)} h · ${fmtNum(people, 1)} people`
        },
      },
    },
  },
  scales: {
    x: { stacked: true, ticks: { color: '#71717a' }, grid: { display: false } },
    y: {
      stacked: true,
      ticks: { color: '#71717a', callback: (v) => v + '%' },
      grid: { color: (c) => (c.tick.value === 100 ? '#f8717188' : '#27272a') },
      suggestedMax: 120,
      beginAtZero: true,
    },
  },
}))

const underResourced = computed(() =>
  planner.state.activities
    .map((a) => ({ a, r: planner.results[a.id], lane: planner.state.swimlanes.find((l) => l.id === a.laneId) }))
    .filter(({ r }) => !r.complete),
)

const yearTotals = computed(() => {
  const y = String(planner.year)
  const inYear = planner.state.activities.filter((a) => {
    const r = planner.results[a.id]
    return r.start.slice(0, 4) <= y && r.end.slice(0, 4) >= y
  })
  return { activities: inYear.length, lanes: planner.state.swimlanes.length }
})
</script>

<template>
  <section id="stats" class="scroll-mt-20">
    <div class="mb-4">
      <h2 class="flex items-center gap-2 text-lg font-semibold text-zinc-100">
        <img src="/icons/stats.png" alt="" class="size-8 rounded-lg" />
        Statistics · {{ planner.year }}
      </h2>
      <p class="text-sm text-zinc-500">
        {{ calendarDays }} working days in the calendar · {{ yearTotals.lanes }} projects · {{ yearTotals.activities }} activities
        this year
      </p>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <div v-for="s in poolStats" :key="s.p" class="card p-5">
        <div class="mb-4 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="size-2.5 rounded-full" :style="{ background: s.pool.color }" />
            <h3 class="font-semibold text-zinc-100">{{ s.pool.name }}</h3>
          </div>
          <span
            class="rounded-full px-2.5 py-0.5 text-sm font-semibold"
            :class="s.utilization > 1 ? 'bg-red-500/15 text-red-300' : s.utilization > 0.85 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-zinc-300'"
          >
            {{ fmtNum(s.utilization * 100, 0) }}% utilized
          </span>
        </div>

        <div class="mb-4 h-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            class="h-full rounded-full"
            :style="{ width: Math.min(100, s.utilization * 100) + '%', background: s.utilization > 1 ? '#f87171' : s.pool.color }"
          />
        </div>

        <dl class="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt class="text-xs text-zinc-500">People</dt>
            <dd class="text-zinc-100">{{ s.pool.members.length }} · {{ fmtNum(poolDayHours(s.pool), 1) }} h/day</dd>
          </div>
          <div>
            <dt class="text-xs text-zinc-500">Business days / person</dt>
            <dd class="text-zinc-100">
              {{ planner.state.businessDays }}
              <span class="text-xs text-zinc-500">of {{ calendarDays }} in calendar</span>
            </dd>
          </div>
          <div>
            <dt class="text-xs text-zinc-500">Available man-days</dt>
            <dd class="text-zinc-100">{{ fmtHours(s.manDays) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-zinc-500">Available man-hours</dt>
            <dd class="text-zinc-100">{{ fmtHours(s.capacity) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-zinc-500">Allocated man-hours</dt>
            <dd class="text-zinc-100">{{ fmtHours(s.allocated) }} <span class="text-xs text-zinc-500">({{ fmtHours(s.allocatedDays) }} md)</span></dd>
          </div>
          <div>
            <dt class="text-xs text-zinc-500">Free for allocation</dt>
            <dd :class="s.free < 0 ? 'text-red-300' : 'text-emerald-300'">
              {{ fmtHours(s.free) }} h <span class="text-xs text-zinc-500">({{ fmtHours(s.avgHours ? s.free / s.avgHours : 0) }} md)</span>
            </dd>
          </div>
        </dl>

        <div class="mt-4 space-y-1 border-t border-zinc-800 pt-3 text-xs">
          <p v-if="s.daysMismatch" class="text-amber-300">
            Business days ({{ planner.state.businessDays }}) exceed the calendar ({{ calendarDays }}); capacity is capped by the calendar.
          </p>
          <p v-if="s.overMonths.length" class="text-red-300">
            Over-allocated: {{ s.overMonths.map((r) => `${MONTHS[r.month]} (${fmtNum(r.pools[s.p].load, 1)}/${s.pool.members.length})`).join(', ') }}
          </p>
          <p v-if="s.idleMonths.length" class="text-zinc-500">
            Under 50% used: {{ s.idleMonths.map((r) => MONTHS[r.month]).join(', ') }}
          </p>
          <p v-if="!s.overMonths.length && !s.idleMonths.length" class="text-emerald-300">Balanced allocation across the year.</p>
        </div>
      </div>
    </div>

    <div class="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div class="card min-w-0 p-5">
        <h3 class="mb-1 text-sm font-medium text-zinc-300">Monthly utilization by project</h3>
        <p class="mb-3 text-xs text-zinc-500">Solid bars are {{ pools[0]?.name || 'the first pool' }}<template v-if="pools.length > 1">, faded bars are {{ pools.slice(1).map((p) => p.name).join(', ') }}</template>.</p>
        <div class="relative h-64 w-full">
          <Bar :data="chartData" :options="chartOptions" />
        </div>
      </div>
      <div class="card min-w-0 p-5">
        <h3 class="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-300">
          <AlertTriangle class="size-4 text-red-400" /> Activities missing resources
        </h3>
        <p v-if="!underResourced.length" class="text-sm text-zinc-500">All estimated activities are fully resourced.</p>
        <ul class="space-y-2">
          <li
            v-for="{ a, r, lane } in underResourced"
            :key="a.id"
            class="cursor-pointer rounded-lg border border-zinc-800 px-3 py-2 hover:border-zinc-700"
            @click="planner.editingId = a.id"
          >
            <div class="flex items-center gap-2 text-sm text-zinc-200">
              <span class="size-2 rounded-full" :style="{ background: lane?.color }" />
              {{ a.name }} <span class="text-xs text-zinc-500">· {{ lane?.name }}</span>
            </div>
            <div class="text-xs text-red-300">
              {{ describeByPool(pools, r.missing) }} after {{ formatDate(r.end) }}
            </div>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
