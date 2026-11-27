<script setup>
import { computed, ref } from 'vue'
import { Bar } from 'vue-chartjs'
import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip } from 'chart.js'
import { usePlanner } from '../../stores/planner'
import { fmtHours, fmtNum, poolDayHours, poolYearHours } from '../../lib/planning'
import { withAlpha } from '../../lib/color'
import MemberDistribution from './MemberDistribution.vue'
import { histogramData, histogramOptions, shareLine, sumItems } from './distributionChart'

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip)

const props = defineProps({ pool: { type: Object, required: true } })
const planner = usePlanner()

const series = computed(() => planner.allocByActivity.pools[props.pool.id])
const acts = computed(() => planner.allocByActivity.acts.filter((a) => series.value?.acts[a.id]))
const allocated = computed(() => series.value?.load.some((v) => v > 1e-9) || false)

/** Share of the pool's yearly capacity booked in the selected year. */
const utilization = computed(() => {
  const capacity = poolYearHours(planner.ctx, props.pool, planner.year)
  return capacity ? (series.value?.hours.reduce((s, h) => s + h, 0) || 0) / capacity : 0
})

/** Activities hidden by a click on their legend chip, in every chart of the pool. */
const hidden = ref(new Set())
const toggle = (id) => (hidden.value.has(id) ? hidden.value.delete(id) : hidden.value.add(id))
const people = (n) => `${fmtNum(n, 1)} ${n === 1 ? 'person' : 'people'}`

const chartData = computed(() =>
  histogramData(planner.allocByActivity, series.value, {
    hidden: hidden.value,
    scale: 1 / (props.pool.members.length || 1),
    barThickness: 36,
  }),
)
const chartOptions = histogramOptions({
  year: () => planner.year,
  label: (c) => {
    const n = props.pool.members.length
    return `${c.dataset.label} · ${c.dataset.laneName}: ${people((c.parsed.y / 100) * n)} · ${shareLine(c.parsed.y, c.dataset.hours[c.dataIndex])}`
  },
  footer: (items) => {
    const n = props.pool.members.length
    const [pct, hours] = sumItems(items)
    return `Total ${fmtNum(pct, 0)}% · ${fmtNum((pct / 100) * n, 1)} of ${n} ${n === 1 ? 'person' : 'people'} · ${fmtHours(hours)} h`
  },
})
</script>

<template>
  <div class="card p-5">
    <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <div class="flex items-center gap-2">
        <span class="size-2.5 rounded-full" :style="{ background: pool.color }" />
        <h3 class="font-semibold text-zinc-100">{{ pool.name }}</h3>
      </div>
      <p class="text-xs text-zinc-500">
        {{ pool.members.length }} {{ pool.members.length === 1 ? 'person' : 'people' }} · {{ fmtNum(poolDayHours(pool), 1) }} h/day · 100% = everyone fully loaded
      </p>
      <span
        class="ml-auto rounded-full px-2.5 py-0.5 text-sm font-semibold"
        :class="utilization > 1 ? 'bg-red-500/15 text-red-300' : utilization > 0.85 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-zinc-300'"
        title="Booked hours / yearly capacity"
        >{{ fmtNum(utilization * 100, 0) }}% utilized</span
      >
    </div>

    <template v-if="allocated">
      <div class="relative h-56 w-full">
        <Bar :data="chartData" :options="chartOptions" dataset-id-key="activityId" :aria-label="`Monthly allocation of ${pool.name} by activity`" />
      </div>

      <div v-if="acts.length" class="mt-3 flex flex-wrap items-center gap-1.5">
        <span class="mr-1 text-[11px] text-zinc-600">Click an activity to hide it in every chart:</span>
        <button
          v-for="a in acts"
          :key="a.id"
          class="flex max-w-80 items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition"
          :class="hidden.has(a.id) ? 'border-zinc-800 opacity-50' : 'hover:brightness-125'"
          :style="hidden.has(a.id) ? undefined : { borderColor: withAlpha(a.laneColor, 0.45), background: withAlpha(a.laneColor, 0.08) }"
          :title="`${a.name} · ${a.laneName} — click to ${hidden.has(a.id) ? 'show' : 'hide'} it in every chart`"
          @click="toggle(a.id)"
        >
          <span class="size-2.5 shrink-0 rounded-sm border" :style="{ background: withAlpha(a.laneColor, a.shade), borderColor: a.laneColor }" />
          <span class="min-w-0 truncate text-zinc-200" :class="hidden.has(a.id) && 'line-through'">{{ a.name }}</span>
          <span class="shrink-0 text-zinc-500">· {{ a.laneName }}</span>
        </button>
      </div>

      <div class="mt-4 grid gap-3 grid-cols-[repeat(auto-fill,minmax(400px,1fr))]">
        <MemberDistribution v-for="m in pool.members" :key="m.id" :member="m" :pool="pool" :hidden="hidden" />
      </div>
      <p v-if="!pool.members.length" class="mt-4 text-sm text-zinc-500">Pool is empty.</p>
    </template>
    <p v-else class="text-sm text-zinc-500">
      No allocations in {{ planner.year }}. Assign people to activities in the Smart Gantt chart to see them here.
    </p>
  </div>
</template>
