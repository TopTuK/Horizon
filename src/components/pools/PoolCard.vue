<script setup>
import { computed, ref } from 'vue'
import { Trash2, UserRoundPlus, X } from 'lucide-vue-next'
import { usePlanner } from '../../stores/planner'
import { fmtHours, fmtNum, initials, isOverloaded, poolDayHours, poolYearHours } from '../../lib/planning'
import { dragPayload, endDrag, readDrop, startDrag } from '../../lib/dnd'
import { MONTHS } from '../../lib/calendar'

const props = defineProps({ pool: { type: Object, required: true } })

const planner = usePlanner()
const hot = ref(false)

const powerPerDay = computed(() => poolDayHours(props.pool))
const yearHours = computed(() => poolYearHours(planner.ctx, props.pool, planner.year))

const peak = computed(() => {
  let best = { load: 0, month: null }
  for (const row of planner.load) {
    const l = row.pools[props.pool.id]?.load || 0
    if (l > best.load) best = { load: l, month: row.month }
  }
  return best
})

/** Highest monthly share of each member's time in the selected year. */
const memberPeak = computed(() => {
  const out = {}
  for (const m of props.pool.members) {
    let best = { load: 0, month: null }
    for (const row of planner.load) {
      const l = row.members[m.id] || 0
      if (l > best.load) best = { load: l, month: row.month }
    }
    out[m.id] = best
  }
  return out
})

function setHours(member, raw) {
  const v = Math.max(0, Math.min(24, Math.round((Number(raw) || 0) * 2) / 2))
  planner.updateMember(member.id, { hoursPerDay: v })
}

function removeMember(member) {
  if (!planner.isAssigned(member.id) || confirm(`${member.name} is assigned to activities. Remove and drop the assignments?`)) {
    planner.removeMember(member.id)
  }
}

function removePool() {
  if (confirm(`Delete "${props.pool.name}" with ${props.pool.members.length} people, their assignments and estimates?`)) {
    planner.removePool(props.pool.id)
  }
}

const canAccept = () => dragPayload.value?.type === 'alloc' && dragPayload.value.poolId === props.pool.id

function onDragOver(e) {
  if (!canAccept()) return
  e.preventDefault()
  hot.value = true
}

function onDrop(e) {
  hot.value = false
  const p = readDrop(e)
  if (p?.type === 'alloc' && p.poolId === props.pool.id) planner.setAlloc(p.activityId, p.key, p.memberId, 0)
}

function peakTitle(member) {
  const p = memberPeak.value[member.id]
  if (p.month === null) return `${member.name} is not assigned in ${planner.year}`
  return `Peak ${fmtNum(p.load * 100, 0)}% of the month in ${MONTHS[p.month]} ${planner.year}`
}
</script>

<template>
  <div
    class="card flex min-w-[420px] flex-1 flex-col gap-4 p-5 transition"
    :class="hot && 'drop-hot'"
    @dragover="onDragOver"
    @dragleave="hot = false"
    @drop="onDrop"
  >
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <input
            type="color"
            class="size-3.5 shrink-0 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
            :value="pool.color"
            title="Pool color"
            @input="planner.updatePool(pool.id, { color: $event.target.value })"
          />
          <input
            class="min-w-0 flex-1 bg-transparent text-base font-semibold text-zinc-100 outline-none focus:text-white"
            :value="pool.name"
            @change="planner.updatePool(pool.id, { name: $event.target.value.trim() || 'Untitled pool' })"
          />
        </div>
        <p class="mt-1 text-xs text-zinc-500">
          {{ pool.members.length }} people · power <span class="text-zinc-300">{{ fmtNum(powerPerDay, 1) }} h/day</span>
          · {{ fmtHours(yearHours) }} h/year
        </p>
      </div>
      <button class="text-zinc-600 hover:text-red-400" title="Delete pool" @click="removePool"><Trash2 class="size-4" /></button>
    </div>

    <div class="overflow-hidden rounded-lg border border-zinc-800">
      <div class="grid grid-cols-[36px_1fr_96px_56px_24px] items-center gap-2 bg-zinc-900 px-3 py-1.5 text-[11px] text-zinc-500">
        <span />
        <span>Name</span>
        <span>Efficient h / day</span>
        <span class="text-right">Peak</span>
        <span />
      </div>
      <div
        v-for="m in pool.members"
        :key="m.id"
        class="grid grid-cols-[36px_1fr_96px_56px_24px] items-center gap-2 border-t border-zinc-900 px-3 py-1"
      >
        <div
          draggable="true"
          class="flex size-8 cursor-grab items-center justify-center rounded-full border text-[11px] font-semibold transition hover:scale-110 active:cursor-grabbing"
          :style="{ borderColor: pool.color + '66', background: pool.color + '1a', color: pool.color }"
          :title="`${m.name} — drag onto an activity month to assign`"
          @dragstart="startDrag($event, { type: 'member', memberId: m.id, poolId: pool.id }, 'copy')"
          @dragend="endDrag"
        >
          {{ initials(m.name) }}
        </div>
        <input
          class="field !py-0.5 text-sm"
          :value="m.name"
          @change="planner.updateMember(m.id, { name: $event.target.value.trim() || 'Unnamed' })"
        />
        <input
          class="field !py-0.5 text-sm"
          type="number"
          min="0"
          max="24"
          step="0.5"
          :value="m.hoursPerDay"
          @change="setHours(m, $event.target.value)"
        />
        <span
          class="text-right text-xs"
          :class="isOverloaded(memberPeak[m.id].load) ? 'font-semibold text-red-400' : 'text-zinc-400'"
          :title="peakTitle(m)"
          >{{ memberPeak[m.id].month === null ? '—' : fmtNum(memberPeak[m.id].load * 100, 0) + '%' }}</span
        >
        <button class="text-zinc-600 hover:text-red-400" title="Remove" @click="removeMember(m)"><X class="size-4" /></button>
      </div>
      <p v-if="!pool.members.length" class="border-t border-zinc-900 px-3 py-3 text-xs text-zinc-500">Pool is empty.</p>
    </div>

    <div class="flex items-center justify-between gap-3 text-xs">
      <button class="btn" @click="planner.addMember(pool.id)">
        <UserRoundPlus class="size-4" /> Add {{ (pool.role || 'member').toLowerCase() }}
      </button>
      <p class="text-zinc-500">
        Peak load in {{ planner.year }}:
        <span :class="peak.load > pool.members.length + 1e-6 ? 'text-red-400' : 'text-zinc-300'"
          >{{ fmtNum(peak.load, 1) }} / {{ pool.members.length }}</span
        >
        people<span v-if="peak.month !== null"> in {{ MONTHS[peak.month] }}</span>
      </p>
    </div>
  </div>
</template>
