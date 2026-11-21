<script setup>
import { computed, reactive, watch } from 'vue'
import { AlertTriangle, CalendarRange, CheckCircle2, Hourglass, Trash2, TrendingDown, Wand2, X } from 'lucide-vue-next'
import { usePlanner } from '../../stores/planner'
import { MONTHS, addMonthsKey, formatDate, monthKey, parseISO, parseKey } from '../../lib/calendar'
import { POOLS, fmtHours, fmtNum, hasBurndown } from '../../lib/planning'

const planner = usePlanner()
const act = computed(() => planner.editing)
const result = computed(() => act.value && planner.results[act.value.id])
const fill = reactive({ dev: 2, test: 1 })

watch(
  () => act.value?.id,
  () => {
    fill.dev = 2
    fill.test = 1
  },
)

const META = {
  dev: { label: 'Development', short: 'Dev', color: '#818cf8' },
  test: { label: 'Testing', short: 'QA', color: '#34d399' },
}

/** Months shown in the allocation table: the activity span plus a few months of headroom. */
const monthRows = computed(() => {
  if (!act.value) return []
  const s = parseISO(act.value.start)
  const first = monthKey(s.y, s.m)
  const e = parseISO(result.value.mode === 'fixed' ? act.value.end : result.value.tailEnd || result.value.end)
  let last = monthKey(e.y, e.m)
  if (result.value.mode === 'estimate') last = addMonthsKey(last, 2)
  const rows = []
  for (let k = first; k <= last && rows.length < 120; k = addMonthsKey(k, 1)) {
    const { y, m } = parseKey(k)
    rows.push({ key: k, label: `${MONTHS[m]} ${y}`, alloc: act.value.alloc[k] || {}, used: result.value.months[k] })
  }
  return rows
})

function setNum(path, raw) {
  const v = Math.max(0, Number(raw) || 0)
  if (path === 'estimate.dev' || path === 'estimate.test') {
    planner.updateActivity(act.value.id, { estimate: { ...act.value.estimate, [path.split('.')[1]]: v } })
  }
}

function pct(p) {
  const r = result.value
  if (!r.required?.[p]) return 100
  return Math.min(100, (r.planned[p] / r.required[p]) * 100)
}

function remove() {
  if (confirm(`Delete "${act.value.name}"?`)) planner.removeActivity(act.value.id)
}
</script>

<template>
  <Transition
    enter-from-class="translate-x-full opacity-0"
    leave-to-class="translate-x-full opacity-0"
    enter-active-class="transition duration-200"
    leave-active-class="transition duration-150"
  >
    <aside
      v-if="act"
      class="fixed inset-y-0 right-0 z-50 flex w-[440px] flex-col border-l border-zinc-800 bg-zinc-950/95 shadow-2xl shadow-black backdrop-blur"
    >
      <header class="flex items-center gap-3 border-b border-zinc-800 px-5 py-4">
        <component :is="act.mode === 'fixed' ? CalendarRange : Hourglass" class="size-5 text-indigo-300" />
        <input
          class="min-w-0 flex-1 bg-transparent text-base font-semibold text-zinc-100 outline-none"
          :value="act.name"
          @change="planner.updateActivity(act.id, { name: $event.target.value || 'Untitled' })"
        />
        <button class="text-zinc-500 hover:text-zinc-100" @click="planner.editingId = null"><X class="size-5" /></button>
      </header>

      <div class="flex-1 space-y-6 overflow-y-auto px-5 py-5 text-sm">
        <div class="grid grid-cols-2 gap-3">
          <label class="col-span-2 flex flex-col gap-1 text-xs text-zinc-500">
            Swimlane
            <select
              class="field"
              :value="act.laneId"
              @change="planner.updateActivity(act.id, { laneId: $event.target.value })"
            >
              <option v-for="l in planner.state.swimlanes" :key="l.id" :value="l.id">{{ l.name }}</option>
            </select>
          </label>

          <div class="col-span-2 flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
            <button
              v-for="mode in ['estimate', 'fixed']"
              :key="mode"
              class="flex-1 rounded-md px-3 py-1.5 text-xs transition"
              :class="act.mode === mode ? 'bg-indigo-500 text-white' : 'text-zinc-400 hover:text-zinc-100'"
              @click="planner.updateActivity(act.id, { mode })"
            >
              {{ mode === 'estimate' ? 'Man-hour estimate' : 'Fixed dates' }}
            </button>
          </div>

          <label class="flex flex-col gap-1 text-xs text-zinc-500">
            Start date
            <input
              class="field"
              type="date"
              :value="act.start"
              @change="$event.target.value && planner.moveActivity(act.id, $event.target.value)"
            />
          </label>
          <label v-if="act.mode === 'fixed'" class="flex flex-col gap-1 text-xs text-zinc-500">
            End date
            <input
              class="field"
              type="date"
              :value="act.end"
              :min="act.start"
              @change="$event.target.value && planner.resizeActivity(act.id, 'end', $event.target.value)"
            />
          </label>
          <div v-else class="flex flex-col gap-1 text-xs text-zinc-500">
            Completion (calculated)
            <div class="py-1 text-sm" :class="result.complete ? 'text-emerald-300' : 'text-red-300'">
              {{ result.complete ? formatDate(result.end) : 'Not enough resources' }}
            </div>
          </div>

          <template v-if="act.mode === 'estimate'">
            <label v-for="p in POOLS" :key="p" class="flex flex-col gap-1 text-xs text-zinc-500">
              {{ META[p].label }} estimate, man-hours
              <input class="field" type="number" min="0" :value="act.estimate[p]" @change="setNum('estimate.' + p, $event.target.value)" />
            </label>
          </template>
        </div>

        <!-- Summary -->
        <div class="card space-y-3 p-4">
          <div class="flex items-center gap-2">
            <template v-if="act.mode === 'estimate'">
              <CheckCircle2 v-if="result.complete" class="size-4 text-emerald-400" />
              <AlertTriangle v-else class="size-4 text-red-400" />
              <span class="font-medium" :class="result.complete ? 'text-emerald-300' : 'text-red-300'">
                {{ result.complete ? `Completes on ${formatDate(result.end)}` : 'Resources are missing' }}
              </span>
            </template>
            <span v-else class="font-medium text-zinc-200">
              {{ formatDate(result.start) }} → {{ formatDate(result.end) }}
            </span>
            <span class="ml-auto text-xs text-zinc-500">{{ result.workingDays }} working of {{ result.durationDays }} days</span>
          </div>
          <div v-for="p in POOLS" :key="p" class="space-y-1">
            <div class="flex justify-between text-xs">
              <span :style="{ color: META[p].color }">{{ META[p].label }}</span>
              <span class="text-zinc-400">
                {{ fmtHours(result.planned[p]) }} h
                <template v-if="result.required"> / {{ fmtHours(result.required[p]) }} h</template>
                planned
              </span>
            </div>
            <div v-if="result.required" class="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div class="h-full rounded-full" :style="{ width: pct(p) + '%', background: pct(p) >= 100 ? META[p].color : '#f87171' }" />
            </div>
            <div v-if="result.missing[p] > 0" class="text-xs text-red-300">
              Missing {{ fmtHours(result.missing[p]) }} h ≈ {{ fmtNum(result.hint[p], 1) }} {{ META[p].short }} person-months after
              {{ formatDate(result.end) }}
            </div>
          </div>
          <button
            v-if="hasBurndown(act, result)"
            class="btn w-full justify-center"
            @click="planner.burndownId = act.id"
          >
            <TrendingDown class="size-4" /> Burndown chart
          </button>
        </div>

        <!-- Fill helper -->
        <div class="space-y-2">
          <div class="text-xs font-medium uppercase tracking-wider text-zinc-500">Quick allocation</div>
          <div class="flex items-end gap-2">
            <label v-for="p in POOLS" :key="p" class="flex flex-col gap-1 text-xs text-zinc-500">
              {{ META[p].short }} / month
              <input v-model.number="fill[p]" class="field w-20" type="number" step="0.5" min="0" />
            </label>
            <button class="btn" @click="planner.fillEvenly(act.id, { ...fill })">
              <Wand2 class="size-4" /> {{ act.mode === 'estimate' ? 'Fill until done' : 'Fill range' }}
            </button>
            <button class="btn" @click="planner.clearAlloc(act.id)">Clear</button>
          </div>
        </div>

        <!-- Monthly table -->
        <div class="space-y-2">
          <div class="text-xs font-medium uppercase tracking-wider text-zinc-500">Monthly allocation (people)</div>
          <div class="overflow-hidden rounded-lg border border-zinc-800">
            <div class="grid grid-cols-[1fr_70px_70px_90px] gap-2 bg-zinc-900 px-3 py-1.5 text-[11px] text-zinc-500">
              <span>Month</span><span>Dev</span><span>QA</span><span class="text-right">Hours</span>
            </div>
            <div
              v-for="row in monthRows"
              :key="row.key"
              class="grid grid-cols-[1fr_70px_70px_90px] items-center gap-2 border-t border-zinc-900 px-3 py-1"
              :class="!row.used && 'opacity-50'"
            >
              <span class="text-xs text-zinc-300">{{ row.label }}</span>
              <input
                v-for="p in POOLS"
                :key="p"
                class="field !py-0.5 text-xs"
                type="number"
                step="0.5"
                min="0"
                :value="row.alloc[p] || ''"
                placeholder="0"
                @change="planner.setAlloc(act.id, row.key, p, $event.target.value)"
              />
              <span class="text-right text-[11px] text-zinc-500">
                {{ row.used ? `${fmtHours(row.used.dev.hours)} / ${fmtHours(row.used.test.hours)}` : '—' }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <footer class="flex justify-between border-t border-zinc-800 px-5 py-3">
        <button class="btn !text-red-300 hover:!border-red-500/50" @click="remove"><Trash2 class="size-4" /> Delete</button>
        <button class="btn" @click="planner.editingId = null">Done</button>
      </footer>
    </aside>
  </Transition>
</template>
