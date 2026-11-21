<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { usePlanner } from '../../stores/planner'
import { MONTH_W, addDays, dateEndToX, dateToX, formatDate } from '../../lib/calendar'
import { fmtHours } from '../../lib/planning'

const props = defineProps({
  activity: { type: Object, required: true },
  result: { type: Object, required: true },
  color: { type: String, required: true },
})
const planner = usePlanner()
const PX_PER_DAY = MONTH_W / 30.44

const drag = ref(null)

const dayDelta = computed(() => (drag.value ? Math.round(drag.value.dx / PX_PER_DAY) : 0))

const preview = computed(() => {
  const r = props.result
  let start = r.start
  let end = r.end
  let tailEnd = r.tailEnd
  const d = dayDelta.value
  if (drag.value && d) {
    if (drag.value.kind === 'move') {
      start = addDays(start, d)
      end = addDays(end, d)
      tailEnd = tailEnd && addDays(tailEnd, d)
    } else if (drag.value.kind === 'start') {
      start = addDays(start, d) > end ? end : addDays(start, d)
    } else {
      end = addDays(end, d) < start ? start : addDays(end, d)
    }
  }
  return { start, end, tailEnd }
})

const yearStart = computed(() => `${planner.year}-01-01`)
const yearEnd = computed(() => `${planner.year}-12-31`)

const geom = computed(() => {
  const { start, end, tailEnd } = preview.value
  const y = planner.year
  const barVisible = start <= yearEnd.value && end >= yearStart.value
  const left = dateToX(start, y)
  const right = dateEndToX(end, y)
  const tailVisible = tailEnd && end < yearEnd.value && tailEnd >= yearStart.value
  return {
    barVisible,
    left,
    width: Math.max(6, right - left),
    tailVisible,
    tailLeft: right,
    tailWidth: tailVisible ? Math.max(0, dateEndToX(tailEnd, y) - right) : 0,
    clippedLeft: start < yearStart.value,
    clippedRight: end > yearEnd.value,
  }
})

const label = computed(() => {
  const r = props.result
  if (r.mode === 'estimate') {
    const planned = r.planned.dev + r.planned.test
    const required = r.required.dev + r.required.test
    return `${fmtHours(planned)} / ${fmtHours(required)} h`
  }
  return `${fmtHours(r.planned.dev)} h dev · ${fmtHours(r.planned.test)} h test`
})

const tooltip = computed(() => {
  const r = props.result
  const lines = [props.activity.name, `${formatDate(r.start)} → ${formatDate(r.end)} (${r.workingDays} working of ${r.durationDays} days)`]
  lines.push(`Dev: ${fmtHours(r.planned.dev)} h${r.required ? ` of ${fmtHours(r.required.dev)} h` : ''}`)
  lines.push(`Test: ${fmtHours(r.planned.test)} h${r.required ? ` of ${fmtHours(r.required.test)} h` : ''}`)
  if (!r.complete) lines.push(`Missing: ${fmtHours(r.missing.dev)} h dev, ${fmtHours(r.missing.test)} h test`)
  lines.push('Drag to move · click to edit')
  return lines.join('\n')
})

function onPointerDown(e, kind) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  drag.value = { kind, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(e) {
  if (!drag.value) return
  drag.value.dx = e.clientX - drag.value.x0
  drag.value.dy = drag.value.kind === 'move' ? e.clientY - drag.value.y0 : 0
  if (Math.abs(drag.value.dx) > 3 || Math.abs(drag.value.dy) > 3) drag.value.moved = true
}

function onPointerUp(e) {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  const d = drag.value
  drag.value = null
  if (!d) return
  if (!d.moved) {
    planner.editingId = props.activity.id
    return
  }
  const delta = Math.round(d.dx / PX_PER_DAY)
  if (d.kind === 'move') {
    const laneEl = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.dataset?.laneId)
    const laneId = laneEl?.dataset.laneId
    if (delta || (laneId && laneId !== props.activity.laneId)) {
      planner.moveActivity(props.activity.id, addDays(props.activity.start, delta), laneId)
    }
  } else if (delta) {
    const base = d.kind === 'start' ? props.activity.start : props.activity.end
    planner.resizeActivity(props.activity.id, d.kind, addDays(base, delta))
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
})
</script>

<template>
  <div
    v-if="geom.barVisible"
    class="group/bar absolute top-2 flex h-8 cursor-grab items-center overflow-hidden rounded-md border text-xs select-none transition-shadow hover:shadow-lg active:cursor-grabbing"
    :class="[drag ? 'z-30 shadow-xl shadow-black/50 opacity-90' : 'z-10', activity.mode === 'fixed' && 'border-dashed']"
    :style="{
      left: geom.left + 'px',
      width: geom.width + 'px',
      transform: drag ? `translateY(${drag.dy}px)` : undefined,
      background: color + '33',
      borderColor: color,
      color: '#f4f4f5',
      pointerEvents: drag?.kind === 'move' ? 'none' : undefined,
    }"
    :title="tooltip"
    @pointerdown="onPointerDown($event, 'move')"
  >
    <div
      v-if="activity.mode === 'fixed' && !geom.clippedLeft"
      class="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-white/20"
      @pointerdown="onPointerDown($event, 'start')"
    />
    <ChevronLeft v-if="geom.clippedLeft" class="size-3.5 shrink-0 opacity-70" />
    <span class="truncate px-2 font-medium">{{ activity.name }}</span>
    <span class="truncate pr-2 text-[11px] text-zinc-300/80">{{ label }}</span>
    <ChevronRight v-if="geom.clippedRight" class="ml-auto size-3.5 shrink-0 opacity-70" />
    <div
      v-if="activity.mode === 'fixed' && !geom.clippedRight"
      class="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-white/20"
      @pointerdown="onPointerDown($event, 'end')"
    />
  </div>
  <div
    v-if="geom.tailVisible && geom.tailWidth > 0"
    class="hatched pointer-events-none absolute top-2 flex h-8 items-center overflow-hidden rounded-r-md border border-l-0 border-dashed border-red-400/60 text-[11px] text-red-200"
    :style="{ left: geom.tailLeft + 'px', width: geom.tailWidth + 'px', transform: drag ? `translateY(${drag.dy}px)` : undefined }"
  >
    <span class="truncate rounded bg-zinc-950/80 px-1.5 ml-1">
      missing
      <template v-if="result.missing.dev">{{ fmtHours(result.missing.dev) }} h dev</template>
      <template v-if="result.missing.dev && result.missing.test"> · </template>
      <template v-if="result.missing.test">{{ fmtHours(result.missing.test) }} h test</template>
    </span>
  </div>
</template>
