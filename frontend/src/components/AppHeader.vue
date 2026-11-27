<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Download, LogOut, Pencil, RotateCcw, Upload } from 'lucide-vue-next'
import { usePlanner } from '../stores/planner'
import { usePlans } from '../stores/plans'
import { useAuth } from '../stores/authStore'
import { YEARS } from '../lib/calendar'
import { clockTime } from '../lib/format'
import { initials } from '../lib/planning'
import PlanNameDialog from './PlanNameDialog.vue'

const planner = usePlanner()
const plans = usePlans()
const auth = useAuth()
const router = useRouter()
const fileInput = ref(null)
const renaming = ref(false)

const sections = [
  { id: 'pools', label: 'Resource Pool', icon: '/icons/pool.png' },
  { id: 'gantt', label: 'Smart Gantt', icon: '/icons/gantt.png' },
  { id: 'stats', label: 'Statistics', icon: '/icons/stats.png' },
  { id: 'distribution', label: 'Distribution', icon: '/icons/distribution.png' },
]

// Plain anchors are unreliable under the router, so the links scroll by hand.
function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}

async function onImport(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  const hasContent = planner.state.activities.length > 0 || planner.state.swimlanes.length > 0
  if (hasContent && !confirm('Replace the content of this plan with the file? Its current content will be overwritten.')) return
  try {
    await planner.importJson(file)
  } catch (err) {
    alert(err.message || 'Import failed')
  }
}

function onReset() {
  if (confirm('Reset all pools, calendars, swimlanes and activities to defaults?')) planner.reset()
}

const openPlan = computed(() => planner.plan)

/** The switcher lists plans by name, so their order does not shift while someone works in one of them. */
const switcherPlans = computed(() => [...plans.items].sort((a, b) => a.name.localeCompare(b.name)))

const status = computed(() => {
  switch (planner.saveStatus) {
    case 'saving':
      return { text: 'Saving…', class: 'text-zinc-400' }
    case 'error':
      return { text: 'Not saved', class: 'font-medium text-rose-400' }
    case 'conflict':
      return { text: 'Not saved', class: 'font-medium text-amber-400' }
    default:
      return { text: clockTime(planner.savedAt) ? `Saved ${clockTime(planner.savedAt)}` : '', class: 'text-zinc-500' }
  }
})

async function switchPlan(e) {
  const select = e.target
  const id = select.value
  // Stay on the open plan in the list unless the navigation goes through.
  select.value = openPlan.value.id
  if (id === openPlan.value.id) return
  await planner.flushSave()
  if (planner.hasUnsavedChanges() && !confirm(`The latest changes to "${openPlan.value.name}" are not saved. Switch plan anyway?`)) {
    return
  }
  router.push(`/plan/${id}`)
}

async function rename(name) {
  renaming.value = false
  try {
    await planner.rename(name)
  } catch (err) {
    alert(err.message || 'Could not rename the plan')
  }
}

async function signOut() {
  await planner.flushSave()
  if (planner.hasUnsavedChanges() && !confirm('Your latest changes are not saved. Sign out anyway?')) return
  await auth.logout()
}
</script>

<template>
  <header class="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
      <router-link to="/" class="flex shrink-0 items-center gap-2" title="My plans">
        <img src="/icons/horizon-logo.png" alt="Horizon" class="h-9 w-auto" />
      </router-link>
      <nav class="flex gap-1">
        <button
          v-for="s in sections"
          :key="s.id"
          type="button"
          class="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
          @click="scrollTo(s.id)"
        >
          <img :src="s.icon" alt="" class="size-5 rounded" />
          {{ s.label }}
        </button>
      </nav>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <template v-if="openPlan">
          <select class="field max-w-52" :value="openPlan.id" title="Switch plan" @change="switchPlan">
            <option v-for="p in switcherPlans" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <button
            class="flex max-w-56 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium text-zinc-100 hover:bg-zinc-900"
            title="Rename plan"
            @click="renaming = true"
          >
            <span class="truncate">{{ openPlan.name }}</span>
            <Pencil class="size-3.5 shrink-0 text-zinc-500" />
          </button>
          <span class="text-xs" :class="status.class">{{ status.text }}</span>
        </template>
        <select v-model.number="planner.year" class="field" title="Planning year">
          <option v-for="y in YEARS" :key="y" :value="y">{{ y }}</option>
        </select>
        <button class="btn" title="Export JSON" @click="planner.exportJson()"><Download class="size-4" /> Export</button>
        <button class="btn" title="Import JSON" @click="fileInput.click()"><Upload class="size-4" /> Import</button>
        <button class="btn" title="Reset to defaults" @click="onReset"><RotateCcw class="size-4" /></button>
        <div class="ml-1 flex items-center gap-2 border-l border-zinc-800 pl-3">
          <span
            class="flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-semibold text-indigo-200"
            :title="auth.user?.email || ''"
          >
            {{ initials(auth.displayName) }}
          </span>
          <span class="hidden max-w-40 truncate text-sm text-zinc-400 xl:inline">{{ auth.displayName }}</span>
          <button class="btn" title="Sign out" @click="signOut"><LogOut class="size-4" /><span class="hidden sm:inline">Sign out</span></button>
        </div>
        <input ref="fileInput" type="file" accept="application/json,.json" class="hidden" @change="onImport" />
      </div>
    </div>
  </header>
  <PlanNameDialog v-if="renaming" :initial="openPlan?.name" @confirm="rename" @cancel="renaming = false" />
</template>
