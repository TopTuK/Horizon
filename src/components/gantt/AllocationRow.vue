<script setup>
import { computed, ref } from 'vue'
import { usePlanner } from '../../stores/planner'
import { MONTH_W, monthKey } from '../../lib/calendar'
import { dragPayload, endDrag, readDrop, startDrag } from '../../lib/dnd'
import { fmtHours, fmtNum, initials, isOverloaded } from '../../lib/planning'
import { LABEL_W } from './layout'
import { isMonthEditable } from './editable'

const props = defineProps({
  activity: { type: Object, required: true },
  result: { type: Object, required: true },
  color: { type: String, required: true },
})
const planner = usePlanner()
const hotCell = ref(null)

const cells = computed(() =>
  Array.from({ length: 12 }, (_, m) => {
    const key = monthKey(planner.year, m)
    const alloc = props.activity.alloc[key] || {}
    const used = props.result.months[key]
    const loads = planner.memberLoad[key] || {}
    const groups = planner.state.pools
      .map((pool) => ({
        pool,
        people: used?.pools[pool.id]?.people || 0,
        hours: used?.pools[pool.id]?.hours || 0,
        members: pool.members
          .filter((mem) => alloc[mem.id] > 0)
          .map((mem) => ({ ...mem, mult: alloc[mem.id], over: isOverloaded(loads[mem.id] || 0) })),
      }))
      .filter((g) => g.members.length)
    return { m, key, editable: isMonthEditable(props.activity, planner.year, m), groups }
  }),
)

const totals = computed(() =>
  planner.state.pools.map((pool) => ({
    pool,
    hours: cells.value.reduce((s, c) => s + (props.result.months[c.key]?.pools[pool.id]?.hours || 0), 0),
  })),
)

function onDragOver(e, cell) {
  const p = dragPayload.value
  if (!cell.editable || !p || !['member', 'alloc'].includes(p.type)) return
  e.preventDefault()
  hotCell.value = cell.m
}

function onDrop(e, cell) {
  hotCell.value = null
  const p = readDrop(e)
  if (!p || !cell.editable) return
  if (p.type === 'member' && !planner.getAlloc(props.activity.id, cell.key, p.memberId)) {
    planner.setAlloc(props.activity.id, cell.key, p.memberId, 1)
  }
  if (p.type === 'alloc') planner.moveAlloc(p.activityId, p.key, props.activity.id, cell.key, p.memberId)
}

function dragChip(e, cell, member, pool) {
  e.stopPropagation()
  startDrag(e, { type: 'alloc', activityId: props.activity.id, key: cell.key, memberId: member.id, poolId: pool.id }, 'move')
}
</script>

<template>
  <div class="flex border-t border-zinc-900 bg-zinc-900/30">
    <div
      class="sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1 border-r border-zinc-800 bg-zinc-950 py-2 pl-12 pr-3 text-[11px] text-zinc-500"
      :style="{ width: LABEL_W + 'px' }"
    >
      <div>Assigned people · hours in {{ planner.year }}</div>
      <div class="flex flex-wrap gap-x-3">
        <span v-for="t in totals" :key="t.pool.id" :style="{ color: t.pool.color }">
          {{ t.pool.name }} {{ fmtHours(t.hours) }} h
        </span>
      </div>
    </div>
    <div
      v-for="cell in cells"
      :key="cell.m"
      class="flex shrink-0 cursor-pointer flex-col justify-center gap-1 border-r border-zinc-800/70 px-1.5 py-1.5 transition hover:bg-zinc-800/30"
      :class="[!cell.editable && 'opacity-30', hotCell === cell.m && 'drop-hot']"
      :style="{ width: MONTH_W + 'px' }"
      :title="cell.editable ? 'Click to edit assignments · drop a person here to assign' : ''"
      @click="cell.editable && (planner.editingId = activity.id)"
      @dragover="onDragOver($event, cell)"
      @dragleave="hotCell = null"
      @drop="onDrop($event, cell)"
    >
      <div v-for="g in cell.groups" :key="g.pool.id" class="space-y-0.5">
        <div class="flex items-center justify-between text-[10px]" :style="{ color: g.pool.color }">
          <span class="font-semibold">×{{ fmtNum(g.people, 2) }}</span>
          <span class="text-zinc-500">{{ g.hours ? fmtHours(g.hours) + 'h' : '' }}</span>
        </div>
        <div class="flex flex-wrap gap-0.5">
          <span
            v-for="mem in g.members"
            :key="mem.id"
            draggable="true"
            class="cursor-grab rounded px-1 text-[10px] font-semibold leading-4"
            :class="mem.over && 'ring-1 ring-red-400'"
            :style="{ background: g.pool.color + '33', color: g.pool.color }"
            :title="`${mem.name} ×${fmtNum(mem.mult, 2)} (${fmtNum(mem.mult * mem.hoursPerDay, 1)} h/day)${mem.over ? ' — over-allocated this month' : ''}\nDrag to another month or back to the pool`"
            @dragstart="dragChip($event, cell, mem, g.pool)"
            @dragend="endDrag"
            >{{ initials(mem.name) }}<template v-if="mem.mult !== 1">·{{ fmtNum(mem.mult, 2) }}</template></span
          >
        </div>
      </div>
      <span v-if="!cell.groups.length && cell.editable" class="text-center text-[10px] text-zinc-600">—</span>
    </div>
  </div>
</template>
