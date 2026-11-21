<script setup>
import { computed } from 'vue'
import draggable from 'vuedraggable'
import { CalendarDays, CalendarRange, Hourglass, Plus } from 'lucide-vue-next'
import { usePlanner } from '../../stores/planner'
import { MONTHS, MONTH_W, YEARS, dateToX, toISO } from '../../lib/calendar'
import { endDrag, startDrag } from '../../lib/dnd'
import SwimlaneRow from './SwimlaneRow.vue'
import LoadFooter from './LoadFooter.vue'
import { LABEL_W } from './layout'

const planner = usePlanner()

const lanes = computed({
  get: () => planner.state.swimlanes,
  set: (v) => planner.setSwimlaneOrder(v),
})

const monthCounts = computed(() => MONTHS.map((_, m) => planner.cal.monthCount(planner.year, m)))
const totalDays = computed(() => planner.cal.yearCount(planner.year))
const customizedMonths = computed(() => {
  const set = new Set()
  for (const iso of Object.keys(planner.state.dayOverrides)) {
    if (iso.startsWith(`${planner.year}-`)) set.add(Number(iso.slice(5, 7)) - 1)
  }
  return set
})

const today = new Date()
const todayX = computed(() =>
  today.getFullYear() === planner.year ? dateToX(toISO(today.getFullYear(), today.getMonth(), today.getDate()), planner.year) : null,
)

const width = LABEL_W + 12 * MONTH_W
</script>

<template>
  <section id="gantt" class="scroll-mt-20">
    <div class="mb-4 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 class="text-lg font-semibold text-zinc-100">Smart Gantt Chart</h2>
        <p class="text-sm text-zinc-500">
          Drag a new activity onto a swimlane, drag bars to reschedule, drag people from the pools onto allocation cells.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
          <button
            v-for="y in YEARS"
            :key="y"
            class="rounded-md px-3 py-1 text-sm transition"
            :class="y === planner.year ? 'bg-indigo-500 text-white' : 'text-zinc-400 hover:text-zinc-100'"
            @click="planner.year = y"
          >
            {{ y }}
          </button>
        </div>
        <div
          draggable="true"
          class="flex cursor-grab items-center gap-1.5 rounded-full border border-indigo-500/50 bg-indigo-500/10 px-3 py-1.5 text-sm text-indigo-200"
          title="Drag onto a swimlane at the start date"
          @dragstart="startDrag($event, { type: 'new-activity', mode: 'estimate' }, 'copy')"
          @dragend="endDrag"
        >
          <Hourglass class="size-4" /> Estimated activity
        </div>
        <div
          draggable="true"
          class="flex cursor-grab items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-200"
          title="Drag onto a swimlane at the start date"
          @dragstart="startDrag($event, { type: 'new-activity', mode: 'fixed' }, 'copy')"
          @dragend="endDrag"
        >
          <CalendarRange class="size-4" /> Fixed-dates activity
        </div>
        <button class="btn" @click="planner.openCalendar()"><CalendarDays class="size-4" /> Working calendar</button>
        <button class="btn" @click="planner.addSwimlane()"><Plus class="size-4" /> Swimlane</button>
      </div>
    </div>

    <div class="card overflow-x-auto">
      <div class="relative" :style="{ width: width + 'px' }">
        <!-- Month header -->
        <div class="sticky top-0 z-30 flex border-b border-zinc-800 bg-zinc-900">
          <div
            class="sticky left-0 z-10 flex shrink-0 items-end justify-between border-r border-zinc-800 bg-zinc-900 px-4 py-2"
            :style="{ width: LABEL_W + 'px' }"
          >
            <span class="text-xs font-medium uppercase tracking-wider text-zinc-500">Projects / activities</span>
            <span class="text-xs text-zinc-500" title="Sum of monthly working days">{{ totalDays }} wd</span>
          </div>
          <div
            v-for="(name, m) in MONTHS"
            :key="m"
            class="flex shrink-0 flex-col items-center gap-1 border-r border-zinc-800/70 py-2"
            :style="{ width: MONTH_W + 'px' }"
          >
            <span class="text-sm font-medium text-zinc-200">{{ name }} {{ String(planner.year).slice(2) }}</span>
            <button
              class="flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400 transition hover:border-indigo-500/60 hover:text-zinc-100"
              :title="`${monthCounts[m]} working days. Click to choose non-working days`"
              @click="planner.openCalendar(m)"
            >
              <CalendarDays class="size-3" />
              <span class="font-medium text-zinc-200">{{ monthCounts[m] }}</span> wd
              <span v-if="customizedMonths.has(m)" class="size-1.5 rounded-full bg-amber-400" title="Customized" />
            </button>
          </div>
        </div>

        <!-- Body -->
        <draggable v-model="lanes" item-key="id" handle=".lane-handle" :animation="180" ghost-class="opacity-40">
          <template #item="{ element }">
            <SwimlaneRow :lane="element" />
          </template>
        </draggable>

        <div v-if="!lanes.length" class="flex items-center gap-3 px-6 py-10 text-sm text-zinc-500">
          No swimlanes yet.
          <button class="btn" @click="planner.addSwimlane()"><Plus class="size-4" /> Add the first project</button>
        </div>

        <LoadFooter />

        <div
          v-if="todayX !== null"
          class="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-rose-500/60"
          :style="{ left: LABEL_W + todayX + 'px' }"
        >
          <span class="absolute -left-5 top-1 rounded bg-rose-500 px-1 text-[10px] text-white">today</span>
        </div>
      </div>
    </div>
  </section>
</template>
