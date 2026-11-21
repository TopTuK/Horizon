<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { RotateCcw, X } from 'lucide-vue-next'
import { usePlanner } from '../../stores/planner'
import { MONTHS, YEARS, daysInMonth, monthKey } from '../../lib/calendar'
import { isDefaultWorking } from '../../lib/workdays'

const planner = usePlanner()
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const open = computed(() => planner.calendarModal.open)
const year = ref(planner.year)
const focusMonth = ref(null)
const monthEls = ref([])
const paint = ref(null)

watch(open, async (isOpen) => {
  if (!isOpen) return
  year.value = planner.year
  focusMonth.value = planner.calendarModal.month
  await nextTick()
  if (focusMonth.value !== null) monthEls.value[focusMonth.value]?.scrollIntoView({ block: 'center' })
})

const months = computed(() =>
  MONTHS.map((name, m) => {
    const y = year.value
    const offset = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7
    const days = Array.from({ length: daysInMonth(y, m) }, (_, i) => {
      const d = i + 1
      const working = planner.cal.isWorking(y, m, d)
      const def = isDefaultWorking(y, m, d)
      return { d, working, overridden: working !== def, weekday: (offset + i) % 7 }
    })
    const prefix = monthKey(y, m) + '-'
    const customized = Object.keys(planner.state.dayOverrides).some((k) => k.startsWith(prefix))
    return { m, name, offset, days, count: planner.cal.monthCount(y, m), customized }
  }),
)

const yearTotal = computed(() => planner.cal.yearCount(year.value))
const yearOverrides = computed(
  () => Object.keys(planner.state.dayOverrides).filter((k) => k.startsWith(`${year.value}-`)).length,
)

function dayClass(day) {
  if (day.working && day.overridden) return 'bg-indigo-500/25 text-indigo-100 ring-1 ring-indigo-400/60'
  if (day.working) return 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
  if (day.overridden) return 'bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/50 line-through decoration-rose-300/60'
  return 'text-zinc-600 hover:bg-zinc-800/60'
}

function startPaint(m, day) {
  paint.value = !day.working
  planner.setDayWorking(year.value, m, day.d, paint.value)
  window.addEventListener('pointerup', stopPaint, { once: true })
}

function continuePaint(m, day) {
  if (paint.value === null || day.working === paint.value) return
  planner.setDayWorking(year.value, m, day.d, paint.value)
}

function stopPaint() {
  paint.value = null
}

function toggleWeekday(month, weekday) {
  const days = month.days.filter((d) => d.weekday === weekday)
  const target = !days.every((d) => d.working)
  for (const d of days) planner.setDayWorking(year.value, month.m, d.d, target)
}

function resetYear() {
  if (confirm(`Restore the default calendar for ${year.value} (weekends off, all weekdays working)?`)) {
    planner.resetCalendar(year.value)
  }
}

function close() {
  planner.calendarModal.open = false
}

function onKey(e) {
  if (e.key === 'Escape' && open.value) close()
}
window.addEventListener('keydown', onKey)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointerup', stopPaint)
})
</script>

<template>
  <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition duration-150" leave-active-class="transition duration-150">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" @pointerdown.self="close">
      <div class="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black">
        <header class="flex flex-wrap items-center gap-4 border-b border-zinc-800 px-6 py-4">
          <div>
            <h2 class="text-base font-semibold text-zinc-100">Working calendar</h2>
            <p class="text-xs text-zinc-500">Click a day to toggle it, drag across days to paint, or click a weekday header to toggle that weekday for the month.</p>
          </div>
          <div class="ml-auto flex items-center gap-3">
            <div class="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
              <button
                v-for="y in YEARS"
                :key="y"
                class="rounded-md px-3 py-1 text-sm transition"
                :class="y === year ? 'bg-indigo-500 text-white' : 'text-zinc-400 hover:text-zinc-100'"
                @click="year = y"
              >
                {{ y }}
              </button>
            </div>
            <div class="text-sm text-zinc-400">
              <span class="font-semibold text-zinc-100">{{ yearTotal }}</span> working days
            </div>
            <button class="btn" :disabled="!yearOverrides" :class="!yearOverrides && 'opacity-40'" @click="resetYear">
              <RotateCcw class="size-4" /> Reset {{ year }}
            </button>
            <button class="text-zinc-500 hover:text-zinc-100" title="Close (Esc)" @click="close"><X class="size-5" /></button>
          </div>
        </header>

        <div class="grid select-none grid-cols-1 gap-4 overflow-y-auto p-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <div
            v-for="month in months"
            :key="month.m"
            :ref="(el) => (monthEls[month.m] = el)"
            class="rounded-xl border p-3 transition"
            :class="focusMonth === month.m ? 'border-indigo-500/70 bg-indigo-500/5' : 'border-zinc-800 bg-zinc-900/40'"
          >
            <div class="mb-2 flex items-center justify-between">
              <span class="text-sm font-medium text-zinc-100">{{ month.name }} {{ year }}</span>
              <div class="flex items-center gap-2 text-xs">
                <button
                  v-if="month.customized"
                  class="text-zinc-500 hover:text-zinc-200"
                  title="Restore weekends-off default for this month"
                  @click="planner.resetCalendar(year, month.m)"
                >
                  reset
                </button>
                <span class="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200">{{ month.count }} wd</span>
              </div>
            </div>
            <div class="grid grid-cols-7 gap-1 text-center">
              <button
                v-for="(w, i) in WEEKDAYS"
                :key="w"
                class="rounded py-0.5 text-[10px] font-medium uppercase transition hover:bg-zinc-800 hover:text-zinc-200"
                :class="i >= 5 ? 'text-zinc-600' : 'text-zinc-500'"
                :title="`Toggle all ${w} in ${month.name}`"
                @click="toggleWeekday(month, i)"
              >
                {{ w }}
              </button>
              <div v-for="n in month.offset" :key="'pad' + n" />
              <button
                v-for="day in month.days"
                :key="day.d"
                class="aspect-square rounded-md text-xs transition"
                :class="dayClass(day)"
                :title="`${day.d} ${month.name}: ${day.working ? 'working' : 'non-working'}${day.overridden ? ' (custom)' : ''}`"
                @pointerdown.prevent="startPaint(month.m, day)"
                @pointerenter="continuePaint(month.m, day)"
              >
                {{ day.d }}
              </button>
            </div>
          </div>
        </div>

        <footer class="flex flex-wrap items-center gap-4 border-t border-zinc-800 px-6 py-3 text-xs text-zinc-500">
          <span class="flex items-center gap-1.5"><span class="size-3 rounded bg-zinc-800" /> Working day</span>
          <span class="flex items-center gap-1.5"><span class="size-3 rounded border border-zinc-800" /> Weekend</span>
          <span class="flex items-center gap-1.5"><span class="size-3 rounded bg-rose-500/30 ring-1 ring-rose-400/50" /> Holiday / day off</span>
          <span class="flex items-center gap-1.5"><span class="size-3 rounded bg-indigo-500/30 ring-1 ring-indigo-400/60" /> Working weekend</span>
          <button class="btn ml-auto" @click="close">Done</button>
        </footer>
      </div>
    </div>
  </Transition>
</template>
