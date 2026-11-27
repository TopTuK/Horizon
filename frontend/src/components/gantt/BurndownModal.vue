<script setup>
import { computed, onBeforeUnmount } from 'vue'
import { Line } from 'vue-chartjs'
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import annotationPlugin from 'chartjs-plugin-annotation'
import { AlertTriangle, CalendarRange, Hourglass, TrendingDown, X } from 'lucide-vue-next'
import { usePlanner } from '../../stores/planner'
import { MONTHS, formatDate, parseISO, toISO } from '../../lib/calendar'
import { computeBurndown, describeByPool, fmtHours, fmtNum, hasBurndown, sumValues } from '../../lib/planning'

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend, Filler, annotationPlugin)

const planner = usePlanner()

const act = computed(() => (planner.burndownId ? planner.getActivity(planner.burndownId) : null))
const result = computed(() => act.value && planner.results[act.value.id])
const lane = computed(() => act.value && planner.state.swimlanes.find((l) => l.id === act.value.laneId))
const open = computed(() => !!act.value && hasBurndown(act.value, result.value))
const burndown = computed(() => (open.value ? computeBurndown(act.value, planner.ctx, result.value) : null))

const now = new Date()
const today = toISO(now.getFullYear(), now.getMonth(), now.getDate())

const shortLabel = (iso) => {
  const { y, m, d } = parseISO(iso)
  return `${d} ${MONTHS[m]} ${String(y).slice(2)}`
}

const shortfall = computed(() => {
  const l = burndown.value?.leftover
  return l && sumValues(l) > 0.5 ? l : null
})

const todayStatus = computed(() => {
  const pts = burndown.value?.points || []
  if (!pts.length) return null
  if (today < pts[0].date) return { label: 'Not started', value: null }
  const past = pts.filter((p) => p.date <= today)
  const last = past[past.length - 1]
  if (today >= pts[pts.length - 1].date) {
    return last.total > 0.5 ? { label: 'Left at end', value: last.total } : { label: 'Finished', value: null }
  }
  return { label: 'Left today', value: last.total }
})

const chartData = computed(() => {
  const pts = burndown.value?.points || []
  return {
    labels: pts.map((p) => shortLabel(p.date)),
    datasets: [
      {
        label: 'Total',
        data: pts.map((p) => p.total),
        borderColor: '#e4e4e7',
        backgroundColor: (lane.value?.color || '#a5b4fc') + '22',
        fill: true,
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0,
      },
      ...planner.state.pools
        .filter((pool) => (burndown.value?.initial.pools[pool.id] || 0) > 0)
        .map((pool) => ({
          label: pool.name,
          data: pts.map((p) => p.pools[pool.id] || 0),
          borderColor: pool.color,
          borderWidth: 1.5,
          pointRadius: 0,
        })),
      {
        label: 'Ideal',
        data: pts.map((p) => p.ideal),
        borderColor: '#71717a',
        borderDash: [6, 5],
        borderWidth: 1.5,
        pointRadius: 0,
      },
    ],
  }
})

const annotations = computed(() => {
  const pts = burndown.value?.points || []
  const out = {}
  if (!pts.length) return out
  const last = pts.length - 1
  const ti = pts.findIndex((p) => p.date >= today)
  if (today >= pts[0].date && today <= pts[last].date && ti >= 0) {
    out.today = {
      type: 'line',
      xMin: ti,
      xMax: ti,
      borderColor: '#f43f5e',
      borderWidth: 1.5,
      label: { display: true, content: 'today', position: 'start', backgroundColor: '#f43f5e', color: '#fff', font: { size: 10 } },
    }
  }
  out.end = {
    type: 'line',
    xMin: last,
    xMax: last,
    borderColor: shortfall.value ? '#f87171' : '#a1a1aa',
    borderWidth: 1,
    borderDash: [3, 3],
    label: {
      display: true,
      content: shortfall.value ? 'resources end' : 'end',
      position: 'end',
      backgroundColor: '#27272a',
      color: '#e4e4e7',
      font: { size: 10 },
    },
  }
  if (shortfall.value) {
    out.leftover = {
      type: 'point',
      xValue: last,
      yValue: pts[last].total,
      radius: 6,
      backgroundColor: '#f87171',
      borderColor: '#fecaca',
      borderWidth: 2,
    }
  }
  return out
})

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 250 },
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { labels: { color: '#a1a1aa', boxWidth: 12, usePointStyle: false } },
    tooltip: {
      callbacks: {
        title: (items) => formatDate(burndown.value.points[items[0].dataIndex].date),
        label: (c) => `${c.dataset.label}: ${fmtHours(c.parsed.y)} h remaining`,
      },
    },
    annotation: { annotations: annotations.value },
  },
  scales: {
    x: { ticks: { color: '#71717a', maxTicksLimit: 14, maxRotation: 0 }, grid: { color: '#27272a' } },
    y: {
      beginAtZero: true,
      ticks: { color: '#71717a', callback: (v) => `${v} h` },
      grid: { color: '#27272a' },
    },
  },
}))

function close() {
  planner.burndownId = null
}

function onKey(e) {
  if (e.key === 'Escape' && open.value) close()
}
window.addEventListener('keydown', onKey)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition duration-150" leave-active-class="transition duration-150">
    <div v-if="open" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" @pointerdown.self="close">
      <div class="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black">
        <header class="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-6 py-4">
          <TrendingDown class="size-5 text-indigo-300" />
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="size-2.5 rounded-full" :style="{ background: lane?.color }" />
              <h2 class="truncate text-base font-semibold text-zinc-100">{{ act.name }}</h2>
              <span
                class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                :class="act.mode === 'fixed' ? 'bg-amber-500/10 text-amber-200' : 'bg-indigo-500/10 text-indigo-200'"
              >
                <component :is="act.mode === 'fixed' ? CalendarRange : Hourglass" class="size-3" />
                {{ act.mode === 'fixed' ? 'Fixed dates' : 'Estimated' }}
              </span>
            </div>
            <p class="text-xs text-zinc-500">
              {{ lane?.name }} · {{ formatDate(result.start) }} → {{ formatDate(result.end) }} ·
              {{ burndown.workingDays }} working days
            </p>
          </div>
          <button class="ml-auto text-zinc-500 hover:text-zinc-100" title="Close (Esc)" @click="close"><X class="size-5" /></button>
        </header>

        <div class="space-y-4 overflow-y-auto px-6 py-5">
          <div
            v-if="shortfall"
            class="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
          >
            <AlertTriangle class="size-4 shrink-0" />
            Missing {{ describeByPool(planner.state.pools, shortfall) }}
            after {{ formatDate(result.end) }}. Assign more people to finish the activity.
          </div>

          <div class="relative h-80 w-full">
            <Line :data="chartData" :options="chartOptions" />
          </div>
          <p v-if="burndown.sampled" class="text-[11px] text-zinc-600">Long activity: one point per week is shown.</p>

          <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div class="card px-4 py-3">
              <dt class="text-xs text-zinc-500">{{ act.mode === 'fixed' ? 'Planned hours' : 'Estimate' }}</dt>
              <dd class="text-lg font-semibold text-zinc-100">{{ fmtHours(burndown.initial.total) }} h</dd>
              <dd class="text-[11px] text-zinc-500">
                {{ describeByPool(planner.state.pools, burndown.initial.pools) }}
              </dd>
            </div>
            <div class="card px-4 py-3">
              <dt class="text-xs text-zinc-500">Average burn</dt>
              <dd class="text-lg font-semibold text-zinc-100">{{ fmtNum(burndown.avgPerDay, 1) }} h/day</dd>
              <dd class="text-[11px] text-zinc-500">per working day</dd>
            </div>
            <div class="card px-4 py-3">
              <dt class="text-xs text-zinc-500">{{ result.complete ? 'End date' : 'Resources end' }}</dt>
              <dd class="text-lg font-semibold" :class="result.complete ? 'text-zinc-100' : 'text-red-300'">
                {{ formatDate(result.end) }}
              </dd>
              <dd class="text-[11px] text-zinc-500">{{ result.workingDays }} working days</dd>
            </div>
            <div class="card px-4 py-3">
              <dt class="text-xs text-zinc-500">{{ todayStatus.label }}</dt>
              <dd class="text-lg font-semibold text-zinc-100">
                {{ todayStatus.value === null ? '—' : fmtHours(todayStatus.value) + ' h' }}
              </dd>
              <dd class="text-[11px] text-zinc-500">as of {{ formatDate(today) }}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  </Transition>
</template>
