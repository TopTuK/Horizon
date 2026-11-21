<script setup>
import { computed, ref } from 'vue'
import { usePlanner } from '../../stores/planner'
import { MONTH_W, monthKey } from '../../lib/calendar'
import { dragPayload, endDrag, readDrop, startDrag } from '../../lib/dnd'
import { POOLS, fmtHours, fmtNum } from '../../lib/planning'
import { LABEL_W } from './layout'
import { isMonthEditable } from './editable'

const props = defineProps({
  activity: { type: Object, required: true },
  result: { type: Object, required: true },
  color: { type: String, required: true },
})
const planner = usePlanner()
const hotCell = ref(null)

const POOL_META = {
  dev: { label: 'Dev', color: '#818cf8' },
  test: { label: 'QA', color: '#34d399' },
}

const cells = computed(() =>
  Array.from({ length: 12 }, (_, m) => {
    const key = monthKey(planner.year, m)
    return {
      m,
      key,
      editable: isMonthEditable(props.activity, planner.year, m),
      alloc: props.activity.alloc[key] || { dev: 0, test: 0 },
      used: props.result.months[key],
    }
  }),
)

const totals = computed(() => {
  const t = { dev: 0, test: 0 }
  for (const c of cells.value) for (const p of POOLS) t[p] += c.used?.[p].hours || 0
  return t
})

function onDragOver(e, cell) {
  const p = dragPayload.value
  if (!cell.editable || !p || !['employee', 'alloc'].includes(p.type)) return
  e.preventDefault()
  hotCell.value = cell.m
}

function onDrop(e, cell) {
  hotCell.value = null
  const p = readDrop(e)
  if (!p || !cell.editable) return
  if (p.type === 'employee') planner.bumpAlloc(props.activity.id, cell.key, p.pool, 1)
  if (p.type === 'alloc') {
    if (p.activityId === props.activity.id && p.key === cell.key) return
    const moved = Math.min(1, p.value)
    planner.bumpAlloc(p.activityId, p.key, p.pool, -moved)
    planner.bumpAlloc(props.activity.id, cell.key, p.pool, moved)
  }
}

function dragChip(e, cell, pool) {
  startDrag(e, { type: 'alloc', activityId: props.activity.id, key: cell.key, pool, value: cell.alloc[pool] }, 'move')
}
</script>

<template>
  <div class="flex border-t border-zinc-900 bg-zinc-900/30">
    <div
      class="sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1 border-r border-zinc-800 bg-zinc-950 py-2 pl-12 pr-3 text-[11px] text-zinc-500"
      :style="{ width: LABEL_W + 'px' }"
    >
      <div>People per month · hours in {{ planner.year }}</div>
      <div class="flex gap-3">
        <span class="text-indigo-300">Dev {{ fmtHours(totals.dev) }} h</span>
        <span class="text-emerald-300">QA {{ fmtHours(totals.test) }} h</span>
      </div>
    </div>
    <div
      v-for="cell in cells"
      :key="cell.m"
      class="flex shrink-0 flex-col justify-center gap-1 border-r border-zinc-800/70 px-1.5 py-1.5 transition"
      :class="[!cell.editable && 'opacity-30', hotCell === cell.m && 'drop-hot']"
      :style="{ width: MONTH_W + 'px' }"
      @dragover="onDragOver($event, cell)"
      @dragleave="hotCell = null"
      @drop="onDrop($event, cell)"
    >
      <div v-for="p in POOLS" :key="p" class="flex items-center gap-1">
        <span
          :draggable="cell.alloc[p] > 0"
          class="w-7 shrink-0 rounded px-1 text-center text-[10px] font-semibold"
          :class="cell.alloc[p] > 0 ? 'cursor-grab' : ''"
          :style="{
            background: cell.alloc[p] > 0 ? POOL_META[p].color + '33' : 'transparent',
            color: POOL_META[p].color,
          }"
          :title="cell.alloc[p] > 0 ? 'Drag to another month or back to the pool' : ''"
          @dragstart="dragChip($event, cell, p)"
          @dragend="endDrag"
          >{{ POOL_META[p].label }}</span
        >
        <input
          class="field w-11 !px-1 !py-0 text-center text-xs"
          type="number"
          step="0.5"
          min="0"
          :disabled="!cell.editable"
          :value="cell.alloc[p] || ''"
          placeholder="0"
          @change="planner.setAlloc(activity.id, cell.key, p, $event.target.value)"
        />
        <span
          class="truncate text-[10px] text-zinc-500"
          :title="cell.used ? `${fmtNum(cell.used[p].load, 2)} person-months effective` : ''"
          >{{ cell.used?.[p].hours ? fmtHours(cell.used[p].hours) + 'h' : '' }}</span
        >
      </div>
    </div>
  </div>
</template>
