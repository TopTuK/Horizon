<script setup>
import { computed, ref } from 'vue'
import { AlertTriangle, CalendarRange, CheckCircle2, ChevronDown, ChevronRight, Hourglass, Pencil, TrendingDown } from 'lucide-vue-next'
import { usePlanner } from '../../stores/planner'
import { MONTH_W, formatDate, monthKey, xToDate } from '../../lib/calendar'
import { dragPayload, readDrop } from '../../lib/dnd'
import { fmtHours, hasBurndown } from '../../lib/planning'
import ActivityBar from './ActivityBar.vue'
import AllocationRow from './AllocationRow.vue'
import { LABEL_W, gridStyle } from './layout'
import { isMonthEditable } from './editable'

const props = defineProps({
  activity: { type: Object, required: true },
  lane: { type: Object, required: true },
})
const planner = usePlanner()
const result = computed(() => planner.results[props.activity.id])
const expanded = computed(() => !!planner.expanded[props.activity.id])
const burndownAvailable = computed(() => hasBurndown(props.activity, result.value))
const hot = ref(false)

function accepts() {
  return dragPayload.value && ['employee', 'new-activity'].includes(dragPayload.value.type)
}

function onDragOver(e) {
  if (!accepts()) return
  e.preventDefault()
  hot.value = true
}

function onDrop(e) {
  hot.value = false
  const x = e.clientX - e.currentTarget.getBoundingClientRect().left
  const p = readDrop(e)
  if (!p) return
  if (p.type === 'new-activity') {
    planner.editingId = planner.addActivity(props.lane.id, xToDate(x, planner.year), p.mode).id
    return
  }
  if (p.type === 'employee') {
    const m = Math.min(11, Math.max(0, Math.floor(x / MONTH_W)))
    if (!isMonthEditable(props.activity, planner.year, m)) return
    planner.bumpAlloc(props.activity.id, monthKey(planner.year, m), p.pool, 1)
    planner.expanded[props.activity.id] = true
  }
}
</script>

<template>
  <div>
    <div class="group flex" :data-lane-id="lane.id">
      <div
        class="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-zinc-800 bg-zinc-950 py-1.5 pl-6 pr-3"
        :style="{ width: LABEL_W + 'px' }"
      >
        <button class="text-zinc-500 hover:text-zinc-200" title="Show monthly allocation" @click="planner.toggleExpanded(activity.id)">
          <component :is="expanded ? ChevronDown : ChevronRight" class="size-4" />
        </button>
        <component
          :is="activity.mode === 'fixed' ? CalendarRange : Hourglass"
          class="size-3.5 shrink-0"
          :class="activity.mode === 'fixed' ? 'text-amber-300' : 'text-indigo-300'"
        />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm text-zinc-200" :title="activity.name">{{ activity.name }}</div>
          <div class="truncate text-[11px] text-zinc-500">
            {{ formatDate(result.start) }} → {{ formatDate(result.end) }}
          </div>
        </div>
        <span v-if="activity.mode === 'estimate' && result.complete" title="Fully resourced">
          <CheckCircle2 class="size-4 text-emerald-400" />
        </span>
        <span
          v-else-if="!result.complete"
          :title="`Missing ${fmtHours(result.missing.dev)} h dev, ${fmtHours(result.missing.test)} h test`"
        >
          <AlertTriangle class="size-4 text-red-400" />
        </span>
        <button
          v-if="burndownAvailable"
          class="text-zinc-500 transition hover:text-indigo-300"
          title="Burndown chart"
          @click="planner.burndownId = activity.id"
        >
          <TrendingDown class="size-4" />
        </button>
        <button class="text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:text-zinc-200" title="Edit" @click="planner.editingId = activity.id">
          <Pencil class="size-3.5" />
        </button>
      </div>
      <div
        class="relative h-12 flex-1 transition"
        :class="hot && 'drop-hot'"
        :style="gridStyle"
        @dragover="onDragOver"
        @dragleave="hot = false"
        @drop="onDrop"
      >
        <ActivityBar :activity="activity" :result="result" :color="lane.color" />
      </div>
    </div>
    <AllocationRow v-if="expanded" :activity="activity" :result="result" :color="lane.color" />
  </div>
</template>
