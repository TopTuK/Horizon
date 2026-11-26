<script setup>
import { computed, ref } from 'vue'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-vue-next'
import { usePlanner } from '../../stores/planner'
import { formatDate } from '../../lib/calendar'
import { fmtNum } from '../../lib/planning'

const planner = usePlanner()
const open = ref(false)

/** Over-1-FTE periods touching the selected year, grouped by person. */
const people = computed(() => {
  const from = `${planner.year}-01-01`
  const to = `${planner.year}-12-31`
  const map = new Map()
  for (const o of planner.overloads) {
    if (o.to < from || o.from > to) continue
    const member = planner.members[o.memberId]
    if (!member) continue
    if (!map.has(o.memberId)) {
      const pool = planner.state.pools.find((p) => p.id === member.poolId)
      map.set(o.memberId, { member, pool, periods: [] })
    }
    map.get(o.memberId).periods.push(o)
  }
  return [...map.values()].sort((a, b) => a.member.name.localeCompare(b.member.name))
})

const periodLabel = (o) => (o.from === o.to ? formatDate(o.from) : `${formatDate(o.from)} – ${formatDate(o.to)}`)
</script>

<template>
  <div v-if="people.length" class="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 text-sm">
    <button class="flex w-full items-center gap-2 px-4 py-2 text-left text-red-200" @click="open = !open">
      <AlertTriangle class="size-4 shrink-0 text-red-400" />
      <span class="font-medium">
        {{ people.length }} {{ people.length === 1 ? 'employee is' : 'employees are' }} allocated over 1 FTE in {{ planner.year }}
      </span>
      <span class="truncate text-xs text-red-300/80">{{ people.map((p) => p.member.name).join(', ') }}</span>
      <component :is="open ? ChevronDown : ChevronRight" class="ml-auto size-4 shrink-0" />
    </button>
    <div v-if="open" class="space-y-2 border-t border-red-500/30 px-4 py-3">
      <div v-for="p in people" :key="p.member.id" class="space-y-0.5">
        <div class="text-xs font-medium" :style="{ color: p.pool?.color }">
          {{ p.member.name }} <span class="font-normal text-zinc-500">· 1 FTE = {{ p.member.hoursPerDay }} h/day</span>
        </div>
        <div v-for="o in p.periods" :key="o.from" class="flex flex-wrap items-baseline gap-x-2 pl-3 text-xs text-zinc-300">
          <span class="text-red-300">{{ periodLabel(o) }}</span>
          <span class="text-zinc-500">{{ o.days }} working {{ o.days === 1 ? 'day' : 'days' }}, peak {{ fmtNum(o.peakShare * 100, 0) }}%</span>
          <span class="flex flex-wrap gap-x-2">
            <button
              v-for="id in o.activityIds"
              :key="id"
              class="text-indigo-300 hover:underline"
              title="Open the activity"
              @click="planner.editingId = id"
            >
              {{ planner.getActivity(id)?.name }}
            </button>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
