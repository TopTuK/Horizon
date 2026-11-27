<script setup>
import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip } from 'chart.js'
import { usePlanner } from '../../stores/planner'
import { MONTHS } from '../../lib/calendar'
import { fmtNum, initials } from '../../lib/planning'
import { histogramData, histogramOptions, shareLine, sumItems } from './distributionChart'

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip)

const props = defineProps({
  member: { type: Object, required: true },
  pool: { type: Object, required: true },
  /** Ids of activities hidden by their legend chip, in every chart of the pool. */
  hidden: { type: Object, default: () => new Set() },
})
const planner = usePlanner()

const series = computed(() => planner.allocByActivity.members[props.member.id])
const allocated = computed(() => series.value?.load.some((v) => v > 1e-9) || false)

/** Share of the member's yearly capacity (efficient hours × working days) booked in the selected year. */
const utilization = computed(() => {
  const days = Math.min(planner.state.businessDays, planner.cal.yearCount(planner.year))
  const capacity = (props.member.hoursPerDay || 0) * days
  return capacity ? (series.value?.hours.reduce((s, h) => s + h, 0) || 0) / capacity : 0
})

/** Months with a working day booked over 1 FTE. */
const overMonths = computed(() =>
  planner.load
    .filter((row) => row.pools[props.pool.id]?.overMembers.some((m) => m.id === props.member.id))
    .map((row) => MONTHS[row.month]),
)

const chartData = computed(() =>
  histogramData(planner.allocByActivity, series.value, { hidden: props.hidden, barThickness: 18 }),
)
const chartOptions = histogramOptions({
  year: () => planner.year,
  label: (c) => `${c.dataset.label} · ${c.dataset.laneName}: ${shareLine(c.parsed.y, c.dataset.hours[c.dataIndex])}`,
  footer: (items) => {
    const [pct, hours] = sumItems(items)
    return `Total ${shareLine(pct, hours)} of 1 FTE${pct > 100.5 ? ' · over 1 FTE' : ''}`
  },
})
</script>

<template>
  <div class="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
    <div class="mb-2 flex items-center gap-2">
      <span
        class="flex size-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold"
        :style="{ borderColor: pool.color + '66', background: pool.color + '1a', color: pool.color }"
        >{{ initials(member.name) }}</span
      >
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium text-zinc-100" :title="member.name">{{ member.name }}</div>
        <div class="truncate text-[11px] text-zinc-500">
          {{ member.hoursPerDay }} h/day = 1 FTE
          <span v-if="overMonths.length" class="text-red-300">· over 1 FTE in {{ overMonths.join(', ') }}</span>
        </div>
      </div>
      <span
        class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
        :class="utilization > 1 ? 'bg-red-500/15 text-red-300' : utilization > 0.85 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-zinc-300'"
        title="Booked hours / yearly capacity"
        >{{ fmtNum(utilization * 100, 0) }}%</span
      >
    </div>
    <div class="relative h-36 w-full">
      <Bar
        v-if="allocated"
        :data="chartData"
        :options="chartOptions"
        dataset-id-key="activityId"
        :aria-label="`Monthly allocation of ${member.name} by activity`"
      />
      <p v-else class="flex h-full items-center justify-center text-sm text-zinc-600">Not allocated in {{ planner.year }}</p>
    </div>
  </div>
</template>
