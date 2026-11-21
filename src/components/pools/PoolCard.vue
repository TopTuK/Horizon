<script setup>
import { computed, ref } from 'vue'
import { Minus, Plus, Trash2, UserRound, UserRoundPlus } from 'lucide-vue-next'
import { usePlanner } from '../../stores/planner'
import { fmtHours, fmtNum } from '../../lib/planning'
import { dragPayload, endDrag, readDrop, startDrag } from '../../lib/dnd'
import { MONTHS } from '../../lib/calendar'

const props = defineProps({
  poolId: { type: String, required: true },
  title: { type: String, required: true },
  role: { type: String, required: true },
  accent: { type: String, required: true },
})

const planner = usePlanner()
const pool = computed(() => planner.state.pools[props.poolId])
const hot = ref(null)

const calendarDays = computed(() => planner.cal.yearCount(planner.year))
const powerPerDay = computed(() => pool.value.count * pool.value.hoursPerDay)
const yearHours = computed(
  () => pool.value.count * Math.min(pool.value.businessDays, calendarDays.value) * pool.value.hoursPerDay,
)
const peak = computed(() => {
  let best = { load: 0, month: null }
  for (const row of planner.load) if (row[props.poolId].load > best.load) best = { load: row[props.poolId].load, month: row.month }
  return best
})

function set(field, raw, min, max) {
  const v = Math.max(min, Math.min(max, Math.round(Number(raw) || 0)))
  planner.setPool(props.poolId, { [field]: v })
}

const canAccept = (types) => dragPayload.value && types.includes(dragPayload.value.type) && (dragPayload.value.pool ?? props.poolId) === props.poolId

function onDragOver(e, zone, types) {
  if (!canAccept(types)) return
  e.preventDefault()
  hot.value = zone
}

function onDrop(e, zone) {
  hot.value = null
  const p = readDrop(e)
  if (!p) return
  if (zone === 'grid' && p.type === 'hire' && p.pool === props.poolId) set('count', pool.value.count + 1, 0, 200)
  if (zone === 'trash' && p.type === 'employee' && p.pool === props.poolId) set('count', pool.value.count - 1, 0, 200)
  if (zone === 'grid' && p.type === 'alloc' && p.pool === props.poolId) planner.bumpAlloc(p.activityId, p.key, p.pool, -1)
}
</script>

<template>
  <div class="card flex min-w-[420px] flex-1 flex-col gap-4 p-5">
    <div class="flex items-start justify-between gap-4">
      <div>
        <div class="flex items-center gap-2">
          <span class="size-2.5 rounded-full" :style="{ background: accent }" />
          <h3 class="text-base font-semibold text-zinc-100">{{ title }}</h3>
        </div>
        <p class="mt-1 text-xs text-zinc-500">
          Power: {{ pool.count }} × {{ pool.hoursPerDay }} h = <span class="text-zinc-300">{{ powerPerDay }} h/day</span>
          · {{ fmtHours(yearHours) }} h/year
        </p>
      </div>
      <div class="flex items-center gap-1">
        <button class="btn !px-2" title="Remove one" @click="set('count', pool.count - 1, 0, 200)"><Minus class="size-4" /></button>
        <input
          class="field w-14 text-center text-base font-semibold"
          type="number"
          :value="pool.count"
          @change="set('count', $event.target.value, 0, 200)"
        />
        <button class="btn !px-2" title="Add one" @click="set('count', pool.count + 1, 0, 200)"><Plus class="size-4" /></button>
      </div>
    </div>

    <div
      class="flex min-h-24 flex-wrap content-start gap-2 rounded-lg border border-dashed border-zinc-800 p-3 transition"
      :class="hot === 'grid' && 'drop-hot'"
      @dragover="onDragOver($event, 'grid', ['hire', 'alloc'])"
      @dragleave="hot = null"
      @drop="onDrop($event, 'grid')"
    >
      <div
        v-for="n in pool.count"
        :key="n"
        draggable="true"
        class="group flex size-10 cursor-grab items-center justify-center rounded-full border transition hover:scale-110 active:cursor-grabbing"
        :style="{ borderColor: accent + '66', background: accent + '1a', color: accent }"
        :title="`${role} #${n} — drag onto an activity month to assign, or onto the bin to remove`"
        @dragstart="startDrag($event, { type: 'employee', pool: poolId }, 'copyMove')"
        @dragend="endDrag"
      >
        <UserRound class="size-5" />
      </div>
      <p v-if="!pool.count" class="self-center text-xs text-zinc-500">Pool is empty. Drag “Hire” here.</p>
    </div>

    <div class="flex items-center justify-between gap-3 text-xs">
      <div
        draggable="true"
        class="flex cursor-grab items-center gap-1.5 rounded-full border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:border-zinc-500"
        title="Drag into the pool to add an employee"
        @dragstart="startDrag($event, { type: 'hire', pool: poolId }, 'copy')"
        @dragend="endDrag"
      >
        <UserRoundPlus class="size-4" /> Hire {{ role.toLowerCase() }}
      </div>
      <div
        class="flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 transition"
        :class="hot === 'trash' ? 'border-red-400 bg-red-500/10 text-red-300' : 'border-zinc-700 text-zinc-500'"
        @dragover="onDragOver($event, 'trash', ['employee'])"
        @dragleave="hot = null"
        @drop="onDrop($event, 'trash')"
      >
        <Trash2 class="size-4" /> Drop to remove
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 border-t border-zinc-800 pt-4">
      <label class="flex flex-col gap-1 text-xs text-zinc-500">
        Business days / year
        <input
          class="field"
          type="number"
          :value="pool.businessDays"
          @change="set('businessDays', $event.target.value, 0, 366)"
        />
      </label>
      <label class="flex flex-col gap-1 text-xs text-zinc-500">
        Effective hours / day
        <input
          class="field"
          type="number"
          :value="pool.hoursPerDay"
          @change="set('hoursPerDay', $event.target.value, 0, 24)"
        />
      </label>
    </div>
    <p class="-mt-2 text-xs text-zinc-500">
      Peak load in {{ planner.year }}:
      <span :class="peak.load > pool.count ? 'text-red-400' : 'text-zinc-300'">{{ fmtNum(peak.load, 1) }} / {{ pool.count }}</span>
      people<span v-if="peak.month !== null"> in {{ MONTHS[peak.month] }}</span>
    </p>
  </div>
</template>
