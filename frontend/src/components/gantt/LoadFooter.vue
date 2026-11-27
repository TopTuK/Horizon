<script setup>
import { usePlanner } from '../../stores/planner'
import { MONTH_W } from '../../lib/calendar'
import { fmtHours, fmtNum } from '../../lib/planning'
import { LABEL_W } from './layout'

const planner = usePlanner()

function title(cell) {
  const base = `${fmtHours(cell.hours)} of ${fmtHours(cell.capacity)} h allocated (${fmtNum(cell.utilization * 100, 0)}%)`
  return cell.overMembers.length ? `${base}\nOver-allocated: ${cell.overMembers.map((m) => m.name).join(', ')}` : base
}
</script>

<template>
  <div class="border-t border-zinc-700 bg-zinc-900/80">
    <div v-for="pool in planner.state.pools" :key="pool.id" class="flex border-b border-zinc-800/60 last:border-b-0">
      <div
        class="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-zinc-800 bg-zinc-900 px-4 py-2 text-xs"
        :style="{ width: LABEL_W + 'px' }"
      >
        <span class="size-2 shrink-0 rounded-full" :style="{ background: pool.color }" />
        <span class="truncate text-zinc-300">{{ pool.name }} load</span>
        <span class="ml-auto shrink-0 text-zinc-500">people / pool</span>
      </div>
      <div
        v-for="row in planner.load"
        :key="row.key"
        class="flex shrink-0 flex-col justify-center gap-1 border-r border-zinc-800/70 px-2 py-2"
        :style="{ width: MONTH_W + 'px' }"
        :title="title(row.pools[pool.id])"
      >
        <div class="flex items-baseline justify-between text-xs">
          <span :class="row.pools[pool.id].over ? 'font-semibold text-red-400' : 'text-zinc-200'">
            {{ fmtNum(row.pools[pool.id].load, 1) }}
          </span>
          <span class="text-zinc-500">/ {{ row.pools[pool.id].count }}</span>
        </div>
        <div class="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            class="h-full rounded-full transition-all"
            :style="{
              width: Math.min(100, row.pools[pool.id].utilization * 100) + '%',
              background: row.pools[pool.id].over ? '#f87171' : pool.color,
            }"
          />
        </div>
      </div>
    </div>
  </div>
</template>
