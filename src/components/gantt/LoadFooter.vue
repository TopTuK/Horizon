<script setup>
import { usePlanner } from '../../stores/planner'
import { MONTH_W } from '../../lib/calendar'
import { POOLS, fmtHours, fmtNum } from '../../lib/planning'
import { LABEL_W } from './layout'

const planner = usePlanner()
const META = {
  dev: { label: 'Development load', color: '#818cf8' },
  test: { label: 'Testing load', color: '#34d399' },
}
</script>

<template>
  <div class="border-t border-zinc-700 bg-zinc-900/80">
    <div v-for="p in POOLS" :key="p" class="flex border-b border-zinc-800/60 last:border-b-0">
      <div
        class="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-zinc-800 bg-zinc-900 px-4 py-2 text-xs"
        :style="{ width: LABEL_W + 'px' }"
      >
        <span class="size-2 rounded-full" :style="{ background: META[p].color }" />
        <span class="text-zinc-300">{{ META[p].label }}</span>
        <span class="ml-auto text-zinc-500">people / pool</span>
      </div>
      <div
        v-for="row in planner.load"
        :key="row.key"
        class="flex shrink-0 flex-col justify-center gap-1 border-r border-zinc-800/70 px-2 py-2"
        :style="{ width: MONTH_W + 'px' }"
        :title="`${fmtHours(row[p].hours)} of ${fmtHours(row[p].capacity)} h allocated (${fmtNum(row[p].utilization * 100, 0)}%)`"
      >
        <div class="flex items-baseline justify-between text-xs">
          <span :class="row[p].over ? 'font-semibold text-red-400' : 'text-zinc-200'">{{ fmtNum(row[p].load, 1) }}</span>
          <span class="text-zinc-500">/ {{ row[p].count }}</span>
        </div>
        <div class="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            class="h-full rounded-full transition-all"
            :style="{
              width: Math.min(100, row[p].utilization * 100) + '%',
              background: row[p].over ? '#f87171' : META[p].color,
            }"
          />
        </div>
      </div>
    </div>
  </div>
</template>
