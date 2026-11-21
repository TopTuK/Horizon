<script setup>
import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-vue-next'
import { usePlanner } from '../../stores/planner'
import { MONTH_W, dateEndToX, dateToX, toISO, xToDate } from '../../lib/calendar'
import { dragPayload, readDrop } from '../../lib/dnd'
import { fmtHours } from '../../lib/planning'
import ActivityRow from './ActivityRow.vue'
import { LABEL_W, gridStyle } from './layout'

const props = defineProps({ lane: { type: Object, required: true } })
const planner = usePlanner()

const activities = computed(() => planner.activitiesByLane[props.lane.id] || [])
const hot = ref(false)
const hoverX = ref(null)

const totals = computed(() => {
  let dev = 0
  let test = 0
  let missing = 0
  for (const a of activities.value) {
    const r = planner.results[a.id]
    dev += r.planned.dev
    test += r.planned.test
    if (!r.complete) missing++
  }
  return { dev, test, missing }
})

const visibleMini = computed(() =>
  activities.value
    .map((a) => ({ a, r: planner.results[a.id] }))
    .filter(({ r }) => r.start.slice(0, 4) <= String(planner.year) && r.end.slice(0, 4) >= String(planner.year)),
)

const localX = (e) => e.clientX - e.currentTarget.getBoundingClientRect().left

function onDragOver(e) {
  if (dragPayload.value?.type !== 'new-activity') return
  e.preventDefault()
  hot.value = true
  hoverX.value = localX(e)
}

function onDrop(e) {
  const x = localX(e)
  hot.value = false
  hoverX.value = null
  const p = readDrop(e)
  if (p?.type !== 'new-activity') return
  const act = planner.addActivity(props.lane.id, xToDate(x, planner.year), p.mode)
  planner.editingId = act.id
}

function addAtYearStart() {
  const now = new Date()
  const start = now.getFullYear() === planner.year ? toISO(planner.year, now.getMonth(), 1) : toISO(planner.year, 0, 1)
  planner.editingId = planner.addActivity(props.lane.id, start, 'estimate').id
}

function confirmRemove() {
  if (!activities.value.length || confirm(`Delete "${props.lane.name}" and its ${activities.value.length} activities?`)) {
    planner.removeSwimlane(props.lane.id)
  }
}
</script>

<template>
  <div class="border-b border-zinc-800" :data-lane-id="lane.id">
    <!-- Lane header -->
    <div class="flex bg-zinc-900/40">
      <div
        class="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-zinc-800 bg-zinc-900 py-2 pl-2 pr-3"
        :style="{ width: LABEL_W + 'px', boxShadow: `inset 3px 0 0 ${lane.color}` }"
      >
        <GripVertical class="lane-handle size-4 shrink-0 cursor-grab text-zinc-600 hover:text-zinc-300" />
        <button class="text-zinc-500 hover:text-zinc-200" @click="planner.updateSwimlane(lane.id, { collapsed: !lane.collapsed })">
          <component :is="lane.collapsed ? ChevronRight : ChevronDown" class="size-4" />
        </button>
        <input
          type="color"
          class="size-4 shrink-0 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
          :value="lane.color"
          @input="planner.updateSwimlane(lane.id, { color: $event.target.value })"
        />
        <input
          class="min-w-0 flex-1 bg-transparent text-sm font-semibold text-zinc-100 outline-none focus:text-white"
          :value="lane.name"
          @change="planner.updateSwimlane(lane.id, { name: $event.target.value || 'Untitled' })"
        />
        <span
          v-if="totals.missing"
          class="rounded bg-red-500/15 px-1.5 text-[10px] text-red-300"
          :title="`${totals.missing} activities lack resources`"
          >{{ totals.missing }}!</span
        >
        <button class="text-zinc-500 hover:text-indigo-300" title="Add activity" @click="addAtYearStart"><Plus class="size-4" /></button>
        <button class="text-zinc-600 hover:text-red-400" title="Delete swimlane" @click="confirmRemove"><Trash2 class="size-4" /></button>
      </div>
      <div
        class="relative flex-1 transition"
        :class="hot && 'drop-hot'"
        :style="gridStyle"
        @dragover="onDragOver"
        @dragleave="hot = false"
        @drop="onDrop"
      >
        <!-- Mini overview of the lane -->
        <div
          v-for="{ a, r } in lane.collapsed ? visibleMini : []"
          :key="a.id"
          class="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full opacity-60"
          :class="!r.complete && 'ring-1 ring-red-400'"
          :style="{
            left: dateToX(r.start, planner.year) + 'px',
            width: Math.max(4, dateEndToX(r.end, planner.year) - dateToX(r.start, planner.year)) + 'px',
            background: lane.color,
          }"
        />
        <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] text-zinc-500">
          {{ activities.length }} activities · {{ fmtHours(totals.dev) }} h dev · {{ fmtHours(totals.test) }} h test
        </div>
        <div
          v-if="hot && hoverX !== null"
          class="pointer-events-none absolute inset-y-0 w-0.5 bg-indigo-400"
          :style="{ left: hoverX + 'px' }"
        />
      </div>
    </div>

    <template v-if="!lane.collapsed">
      <ActivityRow v-for="a in activities" :key="a.id" :activity="a" :lane="lane" />
      <div class="flex">
        <div
          class="sticky left-0 z-10 shrink-0 border-r border-zinc-800 bg-zinc-950 px-4 py-2 text-[11px] text-zinc-600"
          :style="{ width: LABEL_W + 'px' }"
        >
          Drop a new activity on the lane header or here
        </div>
        <div
          class="relative h-9 flex-1 transition"
          :class="hot && 'drop-hot'"
          :style="gridStyle"
          @dragover="onDragOver"
          @dragleave="hot = false"
          @drop="onDrop"
        />
      </div>
    </template>
  </div>
</template>
