<script setup>
import { computed, reactive, watch } from 'vue'
import { AlertTriangle, CalendarRange, CheckCircle2, Copy, Hourglass, Trash2, TrendingDown, Wand2, X } from 'lucide-vue-next'
import { usePlanner } from '../../stores/planner'
import { MONTHS, addMonthsKey, formatDate, monthKey, parseISO, parseKey } from '../../lib/calendar'
import { fmtHours, fmtNum, hasBurndown, isOverloaded } from '../../lib/planning'
import { isMonthEditable } from './editable'

const planner = usePlanner()
const act = computed(() => planner.editing)
const result = computed(() => act.value && planner.results[act.value.id])
const fill = reactive({ members: [], multiplier: 1 })

watch(
  () => act.value?.id,
  () => {
    fill.members = []
    fill.multiplier = 1
  },
)

const pools = computed(() => planner.state.pools)

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
    const alloc = act.value.alloc[k] || {}
    const used = result.value.months[k]
    const loads = planner.memberLoad[k] || {}
    const assigned = []
    const free = []
    for (const pool of pools.value) {
      for (const mem of pool.members) {
        if (alloc[mem.id] > 0) {
          assigned.push({
            ...mem,
            pool,
            mult: alloc[mem.id],
            hours: used?.members[mem.id]?.hours || 0,
            totalLoad: loads[mem.id] || 0,
          })
        } else free.push({ ...mem, pool })
      }
    }
    rows.push({ key: k, label: `${MONTHS[m]} ${y}`, used, assigned, free, editable: isMonthEditable(act.value, y, m), first: k === first })
  }
  return rows
})

function setEstimate(poolId, raw) {
  const v = Math.max(0, Number(raw) || 0)
  planner.updateActivity(act.value.id, { estimate: { ...act.value.estimate, [poolId]: v } })
}

function pct(p) {
  const r = result.value
  if (!r.required?.[p]) return 100
  return Math.min(100, (r.planned[p] / r.required[p]) * 100)
}

function toggleFillPool(pool) {
  const ids = pool.members.map((m) => m.id)
  const all = ids.every((id) => fill.members.includes(id))
  fill.members = all ? fill.members.filter((id) => !ids.includes(id)) : [...new Set([...fill.members, ...ids])]
}

function assign(row, memberId) {
  if (memberId) planner.setAlloc(act.value.id, row.key, memberId, 1)
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
      class="fixed inset-y-0 right-0 z-50 flex w-[480px] flex-col border-l border-zinc-800 bg-zinc-950/95 shadow-2xl shadow-black backdrop-blur"
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
              {{ mode === 'estimate' ? 'Estimated activity' : 'Fixed date activity' }}
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
            <label v-for="pool in pools" :key="pool.id" class="flex flex-col gap-1 text-xs text-zinc-500">
              <span><span :style="{ color: pool.color }">{{ pool.name }}</span> estimate, man-hours</span>
              <input
                class="field"
                type="number"
                min="0"
                :value="act.estimate?.[pool.id] || 0"
                @change="setEstimate(pool.id, $event.target.value)"
              />
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
          <div v-for="pool in pools" :key="pool.id" class="space-y-1">
            <div class="flex justify-between text-xs">
              <span :style="{ color: pool.color }">{{ pool.name }}</span>
              <span class="text-zinc-400">
                {{ fmtHours(result.planned[pool.id] || 0) }} h
                <template v-if="result.required"> / {{ fmtHours(result.required[pool.id] || 0) }} h</template>
                planned
              </span>
            </div>
            <div v-if="result.required" class="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                class="h-full rounded-full"
                :style="{ width: pct(pool.id) + '%', background: pct(pool.id) >= 100 ? pool.color : '#f87171' }"
              />
            </div>
            <div v-if="result.missing[pool.id] > 0" class="text-xs text-red-300">
              Missing {{ fmtHours(result.missing[pool.id]) }} h ≈ {{ fmtNum(result.hint[pool.id], 1) }} person-months after
              {{ formatDate(result.end) }}
            </div>
          </div>
          <button v-if="hasBurndown(act, result)" class="btn w-full justify-center" @click="planner.burndownId = act.id">
            <TrendingDown class="size-4" /> Burndown chart
          </button>
        </div>

        <!-- Fill helper -->
        <div class="space-y-2">
          <div class="text-xs font-medium uppercase tracking-wider text-zinc-500">Quick allocation</div>
          <div v-for="pool in pools" :key="pool.id" class="flex flex-wrap items-center gap-1">
            <button
              class="mr-1 text-[11px] font-medium hover:underline"
              :style="{ color: pool.color }"
              title="Select / clear the whole pool"
              @click="toggleFillPool(pool)"
            >
              {{ pool.name }}
            </button>
            <label
              v-for="m in pool.members"
              :key="m.id"
              class="flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]"
              :style="
                fill.members.includes(m.id)
                  ? { borderColor: pool.color, background: pool.color + '22', color: pool.color }
                  : { borderColor: '#3f3f46', color: '#a1a1aa' }
              "
            >
              <input v-model="fill.members" type="checkbox" class="hidden" :value="m.id" />
              {{ m.name }}
            </label>
          </div>
          <div class="flex items-end gap-2">
            <label class="flex flex-col gap-1 text-xs text-zinc-500">
              Multiplier
              <input v-model.number="fill.multiplier" class="field w-20" type="number" step="0.1" min="0" />
            </label>
            <button
              class="btn"
              :disabled="!fill.members.length"
              :class="!fill.members.length && 'opacity-50'"
              @click="planner.fillEvenly(act.id, { memberIds: [...fill.members], multiplier: fill.multiplier })"
            >
              <Wand2 class="size-4" /> {{ act.mode === 'estimate' ? 'Fill until done' : 'Fill range' }}
            </button>
            <button class="btn" @click="planner.clearAlloc(act.id)">Clear all</button>
          </div>
          <p class="text-[11px] text-zinc-600">
            Multiplier is the share of a person's efficient hours per day: 1 = full time, 0.5 = half of the day.
          </p>
        </div>

        <!-- Monthly assignments -->
        <div class="space-y-2">
          <div class="text-xs font-medium uppercase tracking-wider text-zinc-500">Monthly assignments</div>
          <div class="overflow-hidden rounded-lg border border-zinc-800">
            <div
              v-for="row in monthRows"
              :key="row.key"
              class="space-y-1 border-t border-zinc-900 px-3 py-2 first:border-t-0"
              :class="!row.used && !row.assigned.length && 'opacity-60'"
            >
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium text-zinc-300">{{ row.label }}</span>
                <span class="flex flex-wrap gap-x-2 text-[11px]">
                  <template v-for="pool in pools" :key="pool.id">
                    <span v-if="row.used?.pools[pool.id]?.hours" :style="{ color: pool.color }">
                      {{ fmtHours(row.used.pools[pool.id].hours) }} h
                    </span>
                  </template>
                </span>
                <button
                  v-if="row.editable && !row.first"
                  class="ml-auto text-zinc-600 hover:text-zinc-200"
                  title="Copy assignments from the previous month"
                  @click="planner.copyMonth(act.id, addMonthsKey(row.key, -1), row.key)"
                >
                  <Copy class="size-3.5" />
                </button>
              </div>
              <div v-for="a in row.assigned" :key="a.id" class="flex items-center gap-2 text-xs">
                <span class="size-2 shrink-0 rounded-full" :style="{ background: a.pool.color }" />
                <span class="min-w-0 flex-1 truncate text-zinc-300" :title="a.pool.name">{{ a.name }}</span>
                <span
                  v-if="isOverloaded(a.totalLoad)"
                  class="text-[10px] text-red-400"
                  :title="`${fmtNum(a.totalLoad * 100, 0)}% of the month across all activities`"
                  >over {{ fmtNum(a.totalLoad * 100, 0) }}%</span
                >
                <span class="text-zinc-500">×</span>
                <input
                  class="field w-16 !px-1 !py-0 text-center text-xs"
                  type="number"
                  step="0.1"
                  min="0"
                  :disabled="!row.editable"
                  :value="a.mult"
                  @change="planner.setAlloc(act.id, row.key, a.id, $event.target.value)"
                />
                <span class="w-14 text-right text-[11px] text-zinc-500">{{ fmtHours(a.hours) }} h</span>
                <button class="text-zinc-600 hover:text-red-400" title="Unassign" @click="planner.setAlloc(act.id, row.key, a.id, 0)">
                  <X class="size-3.5" />
                </button>
              </div>
              <select
                v-if="row.editable && row.free.length"
                class="field w-full !py-0.5 text-xs text-zinc-400"
                :value="''"
                @change="assign(row, $event.target.value); $event.target.value = ''"
              >
                <option value="">+ Assign person…</option>
                <optgroup v-for="pool in pools" :key="pool.id" :label="pool.name">
                  <option v-for="m in row.free.filter((f) => f.pool.id === pool.id)" :key="m.id" :value="m.id">
                    {{ m.name }} ({{ m.hoursPerDay }} h/day)
                  </option>
                </optgroup>
              </select>
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
