<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { usePlanner } from '../../stores/planner'
import { absentWorkingDays, fmtHours } from '../../lib/planning'

const planner = usePlanner()
const KINDS = [
  { id: 'vacation', label: 'Vacation' },
  { id: 'absence', label: 'Absence' },
]

const open = computed(() => planner.absenceModal.open)
const member = computed(() => planner.members[planner.absenceModal.memberId] || null)
const draft = ref({ kind: 'vacation', from: '', to: '' })
const draftError = ref('')

const ranges = computed(() =>
  [...(member.value?.absences || [])].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1)),
)

const offDays = computed(() => {
  if (!member.value) return 0
  const y = planner.year
  return absentWorkingDays(planner.cal, member.value.absences, `${y}-01-01`, `${y}-12-31`).size
})
const hoursOff = computed(() => offDays.value * (member.value?.hoursPerDay || 0))

watch(open, (isOpen) => {
  if (!isOpen) return
  draft.value = { kind: 'vacation', from: '', to: '' }
  draftError.value = ''
})

watch(member, (person) => {
  if (open.value && !person) planner.closeAbsences()
})

function add() {
  const { kind, from, to } = draft.value
  if (!from || !to || to < from) {
    draftError.value = 'The end date has to be on or after the start.'
    return
  }
  if (!planner.addAbsence(member.value.id, { kind, from, to })) return
  draft.value = { kind, from: '', to: '' }
  draftError.value = ''
}

function setBound(absence, field, event) {
  const value = event.target.value
  const from = field === 'from' ? value : absence.from
  const to = field === 'to' ? value : absence.to
  if (!value || to < from || !planner.updateAbsence(member.value.id, absence.id, { [field]: value })) {
    event.target.value = absence[field]
  }
}

function close() {
  planner.closeAbsences()
}

function onKey(e) {
  if (e.key === 'Escape' && open.value) close()
}
window.addEventListener('keydown', onKey)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition duration-150" leave-active-class="transition duration-150">
    <div v-if="open && member" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" @pointerdown.self="close">
      <div class="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black">
        <header class="flex items-start gap-4 border-b border-zinc-800 px-6 py-4">
          <div>
            <h2 class="text-base font-semibold text-zinc-100">{{ member.name }}</h2>
            <p class="text-xs text-zinc-500">Vacations and absences. These working days are not booked and do not count toward capacity.</p>
          </div>
          <button class="ml-auto text-zinc-500 hover:text-zinc-100" title="Close (Esc)" @click="close"><X class="size-5" /></button>
        </header>

        <div class="space-y-4 overflow-y-auto px-6 py-4">
          <form class="flex flex-wrap items-end gap-2" @submit.prevent="add">
            <label class="flex flex-col gap-1 text-xs text-zinc-500">
              Type
              <select v-model="draft.kind" class="field">
                <option v-for="k in KINDS" :key="k.id" :value="k.id">{{ k.label }}</option>
              </select>
            </label>
            <label class="flex flex-col gap-1 text-xs text-zinc-500">
              From
              <input v-model="draft.from" class="field" type="date" required />
            </label>
            <label class="flex flex-col gap-1 text-xs text-zinc-500">
              To
              <input v-model="draft.to" class="field" type="date" :min="draft.from || undefined" required />
            </label>
            <button class="btn" type="submit">Add</button>
            <p v-if="draftError" class="basis-full text-xs text-amber-300">{{ draftError }}</p>
          </form>

          <div v-if="ranges.length" class="overflow-hidden rounded-lg border border-zinc-800">
            <div class="grid grid-cols-[140px_1fr_1fr_28px] items-center gap-2 bg-zinc-900 px-3 py-1.5 text-[11px] text-zinc-500">
              <span>Type</span>
              <span>From</span>
              <span>To</span>
              <span />
            </div>
            <div
              v-for="a in ranges"
              :key="a.id"
              class="grid grid-cols-[140px_1fr_1fr_28px] items-center gap-2 border-t border-zinc-900 px-3 py-1.5"
            >
              <select
                class="field"
                :value="a.kind"
                @change="planner.updateAbsence(member.id, a.id, { kind: $event.target.value })"
              >
                <option v-for="k in KINDS" :key="k.id" :value="k.id">{{ k.label }}</option>
              </select>
              <input class="field" type="date" :value="a.from" @change="setBound(a, 'from', $event)" />
              <input class="field" type="date" :value="a.to" :min="a.from" @change="setBound(a, 'to', $event)" />
              <button class="text-zinc-600 hover:text-red-400" title="Remove" @click="planner.removeAbsence(member.id, a.id)">
                <X class="size-4" />
              </button>
            </div>
          </div>
          <p v-else class="text-sm text-zinc-500">No vacations or absences yet.</p>
        </div>

        <footer class="border-t border-zinc-800 px-6 py-3 text-xs text-zinc-400">
          <template v-if="offDays">
            <span class="font-semibold text-zinc-100">{{ offDays }}</span>
            working {{ offDays === 1 ? 'day' : 'days' }} off in {{ planner.year }} ·
            <span class="font-semibold text-zinc-100">{{ fmtHours(hoursOff) }} h</span>
            removed from capacity
          </template>
          <template v-else>No working days off in {{ planner.year }}</template>
        </footer>
      </div>
    </div>
  </Transition>
</template>
