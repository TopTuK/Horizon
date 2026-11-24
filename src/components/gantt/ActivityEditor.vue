<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { AlertTriangle, CalendarRange, CheckCircle2, Hourglass, Scissors, Trash2, TrendingDown, Wand2, X } from 'lucide-vue-next'
import { usePlanner } from '../../stores/planner'
import { formatDate } from '../../lib/calendar'
import { assignmentSpan, fmtHours, fmtNum, hasBurndown } from '../../lib/planning'

const planner = usePlanner()
const act = computed(() => planner.editing)
const result = computed(() => act.value && planner.results[act.value.id])
const fill = reactive({ members: [], percent: 100 })
const dateNote = ref('')

watch(
  () => act.value?.id,
  () => {
    fill.members = []
    fill.percent = 100
    dateNote.value = ''
  },
)

const pools = computed(() => planner.state.pools)
const poolOf = (memberId) => pools.value.find((p) => p.id === planner.members[memberId]?.poolId)

const pctLabel = (share) => `${fmtNum(share * 100, 0)}%`
const periodLabel = (o) => (o.from === o.to ? formatDate(o.from) : `${formatDate(o.from)} – ${formatDate(o.to)}`)

/** Assignment rows with their effective dates, booked hours and over-1-FTE periods. */
const rows = computed(() => {
  if (!act.value) return []
  const r = result.value
  return act.value.assignments
    .filter((x) => planner.members[x.memberId])
    .map((x) => {
      const member = planner.members[x.memberId]
      const span = assignmentSpan(act.value, x)
      const until = span.to || r.end
      const days = until >= span.from ? [...planner.cal.workingDaysBetween(span.from, until)] : []
      return {
        ...x,
        member,
        pool: poolOf(x.memberId),
        span,
        openEnd: !x.to && act.value.mode === 'estimate',
        hours: r.byAssignment[x.id] || 0,
        perDay: x.share * (member.hoursPerDay || 0),
        splitAt: days.length >= 2 ? days[Math.floor(days.length / 2)] : null,
        over: planner.overloadsFor(x.memberId, { activityId: act.value.id, from: span.from, to: until }),
      }
    })
    .sort((a, b) => a.member.name.localeCompare(b.member.name) || (a.span.from < b.span.from ? -1 : 1))
})

const overCount = computed(() => new Set(rows.value.filter((r) => r.over.length).map((r) => r.memberId)).size)

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

function setDate(edge, value) {
  if (!value) return
  if (edge === 'start') planner.moveActivity(act.value.id, value)
  else planner.resizeActivity(act.value.id, 'end', value)
  const actual = edge === 'start' ? act.value.start : act.value.end
  dateNote.value = actual !== value ? `${formatDate(value)} is not a working day — moved to ${formatDate(actual)}.` : ''
}

function setAsgDate(row, edge, value) {
  planner.updateAssignment(act.value.id, row.id, { [edge]: value || null })
}

function toggleOpenEnd(row, open) {
  planner.updateAssignment(act.value.id, row.id, { to: open ? null : result.value.end })
}

function assign(memberId) {
  if (memberId) planner.addAssignment(act.value.id, { memberId, share: 1 })
}

function fillEvenly() {
  planner.assignEvenly(act.value.id, { memberIds: [...fill.members], share: (Number(fill.percent) || 0) / 100 })
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
      class="fixed inset-y-0 right-0 z-50 flex w-[560px] max-w-full flex-col border-l border-zinc-800 bg-zinc-950/95 shadow-2xl shadow-black backdrop-blur"
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
            <input class="field" type="date" :value="act.start" @change="setDate('start', $event.target.value)" />
          </label>
          <label v-if="act.mode === 'fixed'" class="flex flex-col gap-1 text-xs text-zinc-500">
            End date (working day)
            <input
              class="field"
              type="date"
              :value="act.end"
              :min="act.start"
              @change="setDate('end', $event.target.value)"
            />
          </label>
          <div v-else class="flex flex-col gap-1 text-xs text-zinc-500">
            Completion (calculated)
            <div class="py-1 text-sm" :class="result.complete ? 'text-emerald-300' : 'text-red-300'">
              {{ result.complete ? formatDate(result.end) : 'Not enough resources' }}
            </div>
          </div>
          <p v-if="dateNote" class="col-span-2 text-[11px] text-amber-300">{{ dateNote }}</p>

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
              Quota, % FTE
              <input v-model.number="fill.percent" class="field w-24" type="number" step="5" min="5" />
            </label>
            <button
              class="btn"
              :disabled="!fill.members.length"
              :class="!fill.members.length && 'opacity-50'"
              @click="fillEvenly"
            >
              <Wand2 class="size-4" /> {{ act.mode === 'estimate' ? 'Assign until done' : 'Assign whole range' }}
            </button>
            <button class="btn" @click="planner.clearAssignments(act.id)">Clear all</button>
          </div>
          <p class="text-[11px] text-zinc-600">
            Quota is the share of a person's efficient hours per day (1 FTE) spent on this activity: 100% = full time,
            50% = half of the day. A person can work on several activities in parallel; the quotas on any day should not
            add up to more than 100%.
          </p>
        </div>

        <!-- Assignments -->
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium uppercase tracking-wider text-zinc-500">Assignments</span>
            <span v-if="overCount" class="flex items-center gap-1 text-[11px] text-red-400">
              <AlertTriangle class="size-3.5" /> {{ overCount }} {{ overCount === 1 ? 'person is' : 'people are' }} over 1 FTE
            </span>
          </div>
          <div class="overflow-hidden rounded-lg border border-zinc-800">
            <div
              class="grid grid-cols-[1fr_64px_112px_112px_44px_36px] items-center gap-1.5 bg-zinc-900 px-3 py-1.5 text-[10px] text-zinc-500"
            >
              <span>Person</span>
              <span>% FTE</span>
              <span>From</span>
              <span>To</span>
              <span class="text-right">Hours</span>
              <span />
            </div>
            <div v-for="row in rows" :key="row.id" class="space-y-1 border-t border-zinc-900 px-3 py-1.5">
              <div class="grid grid-cols-[1fr_64px_112px_112px_44px_36px] items-center gap-1.5 text-xs">
                <span class="flex min-w-0 items-center gap-1.5">
                  <span class="size-2 shrink-0 rounded-full" :style="{ background: row.pool?.color }" />
                  <span class="truncate text-zinc-300" :title="`${row.member.name} · ${row.pool?.name} · ${row.member.hoursPerDay} h/day = 1 FTE`">
                    {{ row.member.name }}
                  </span>
                </span>
                <input
                  class="field !px-1 !py-0 text-center text-xs"
                  type="number"
                  step="5"
                  min="5"
                  :value="Math.round(row.share * 100)"
                  :title="`${fmtNum(row.perDay, 1)} h/day`"
                  @change="planner.updateAssignment(act.id, row.id, { share: ($event.target.value || 0) / 100 })"
                />
                <input
                  class="field !px-1 !py-0 text-xs"
                  type="date"
                  :min="act.start"
                  :value="row.span.from"
                  @change="setAsgDate(row, 'from', $event.target.value)"
                />
                <div class="flex min-w-0 items-center gap-1">
                  <template v-if="row.openEnd">
                    <span class="flex-1 truncate text-[11px] text-indigo-300" :title="`Until the estimate is covered (${formatDate(result.end)})`">
                      until done
                    </span>
                  </template>
                  <input
                    v-else
                    class="field min-w-0 flex-1 !px-1 !py-0 text-xs"
                    type="date"
                    :min="row.span.from"
                    :max="act.mode === 'fixed' ? act.end : undefined"
                    :value="row.span.to"
                    @change="setAsgDate(row, 'to', $event.target.value)"
                  />
                  <input
                    v-if="act.mode === 'estimate'"
                    type="checkbox"
                    class="accent-indigo-500"
                    title="Until the estimate is covered"
                    :checked="row.openEnd"
                    @change="toggleOpenEnd(row, $event.target.checked)"
                  />
                </div>
                <span class="text-right text-[11px] text-zinc-500" :title="`${fmtNum(row.perDay, 1)} h/day`">{{ fmtHours(row.hours) }} h</span>
                <span class="flex justify-end gap-1">
                  <button
                    v-if="row.splitAt"
                    class="text-zinc-600 hover:text-zinc-200"
                    :title="`Split the range at ${formatDate(row.splitAt)} to change the quota for the second part`"
                    @click="planner.splitAssignment(act.id, row.id, row.splitAt)"
                  >
                    <Scissors class="size-3.5" />
                  </button>
                  <button class="text-zinc-600 hover:text-red-400" title="Unassign" @click="planner.removeAssignment(act.id, row.id)">
                    <X class="size-3.5" />
                  </button>
                </span>
              </div>
              <div v-for="o in row.over" :key="o.from" class="flex items-start gap-1 pl-3.5 text-[11px] text-red-400">
                <AlertTriangle class="mt-0.5 size-3 shrink-0" />
                <span>
                  Over 1 FTE {{ periodLabel(o) }} ({{ pctLabel(o.peakShare) }}) with
                  {{ o.activityIds.filter((id) => id !== act.id).map((id) => planner.getActivity(id)?.name).join(', ') || 'this activity' }}
                </span>
              </div>
            </div>
            <p v-if="!rows.length" class="border-t border-zinc-900 px-3 py-3 text-xs text-zinc-500">Nobody is assigned yet.</p>
            <div class="border-t border-zinc-900 px-3 py-2">
              <select
                class="field w-full !py-0.5 text-xs text-zinc-400"
                :value="''"
                @change="assign($event.target.value); $event.target.value = ''"
              >
                <option value="">+ Assign person…</option>
                <optgroup v-for="pool in pools" :key="pool.id" :label="pool.name">
                  <option v-for="m in pool.members" :key="m.id" :value="m.id">{{ m.name }} ({{ m.hoursPerDay }} h/day)</option>
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
