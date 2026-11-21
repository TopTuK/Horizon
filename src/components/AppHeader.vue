<script setup>
import { ref } from 'vue'
import { Download, RotateCcw, Upload } from 'lucide-vue-next'
import { usePlanner } from '../stores/planner'
import { YEARS } from '../lib/calendar'

const planner = usePlanner()
const fileInput = ref(null)

const sections = [
  { id: 'pools', label: 'Resource Pool', icon: '/icons/pool.png' },
  { id: 'gantt', label: 'Smart Gantt', icon: '/icons/gantt.png' },
  { id: 'stats', label: 'Statistics', icon: '/icons/stats.png' },
]

async function onImport(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  try {
    await planner.importJson(file)
  } catch (err) {
    alert(err.message || 'Import failed')
  }
}

function onReset() {
  if (confirm('Reset all pools, calendars, swimlanes and activities to defaults?')) planner.reset()
}
</script>

<template>
  <header class="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
    <div class="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
      <div class="flex items-center gap-2">
        <img src="/icons/horizon-logo.png" alt="Horizon" class="h-9 w-auto" />
        <span class="hidden text-sm text-zinc-500 sm:inline">roadmap planner</span>
      </div>
      <nav class="flex gap-1">
        <a
          v-for="s in sections"
          :key="s.id"
          :href="'#' + s.id"
          class="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
        >
          <img :src="s.icon" alt="" class="size-5 rounded" />
          {{ s.label }}
        </a>
      </nav>
      <div class="ml-auto flex items-center gap-2">
        <select v-model.number="planner.year" class="field" title="Planning year">
          <option v-for="y in YEARS" :key="y" :value="y">{{ y }}</option>
        </select>
        <button class="btn" title="Export JSON" @click="planner.exportJson()"><Download class="size-4" /> Export</button>
        <button class="btn" title="Import JSON" @click="fileInput.click()"><Upload class="size-4" /> Import</button>
        <button class="btn" title="Reset to defaults" @click="onReset"><RotateCcw class="size-4" /></button>
        <input ref="fileInput" type="file" accept="application/json,.json" class="hidden" @change="onImport" />
      </div>
    </div>
  </header>
</template>
