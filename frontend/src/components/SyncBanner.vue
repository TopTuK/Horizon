<script setup>
import { computed } from 'vue'
import { AlertTriangle, CloudOff, Download, RefreshCw } from 'lucide-vue-next'
import { usePlanner } from '../stores/planner'

const planner = usePlanner()

/** Which problem the banner explains: 'conflict', 'signed-out', 'deleted' or 'retrying'. */
const kind = computed(() => {
  if (planner.saveStatus === 'conflict') return 'conflict'
  if (planner.saveStatus !== 'error') return null
  const status = planner.saveError?.status
  if (status === 401) return 'signed-out'
  if (status === 404) return 'deleted'
  return 'retrying'
})

const messages = {
  conflict: 'This plan was changed in another tab or on another device. Your edits on this page are not saved yet.',
  'signed-out': 'You are signed out, so changes cannot be saved. Download a copy before you sign in again.',
  deleted: 'This plan no longer exists on the server. Download a copy if you want to keep your edits.',
  retrying: 'Changes could not be saved. Trying again…',
}

const message = computed(() => {
  if (kind.value !== 'retrying') return messages[kind.value]
  const reason = planner.saveError?.message
  return reason ? `${messages.retrying} ${reason}` : messages.retrying
})

async function keep() {
  try {
    await planner.keepMyChanges()
  } catch (err) {
    alert(err.message || 'The plan could not be saved')
  }
}
</script>

<template>
  <div
    v-if="kind"
    class="mx-6 mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm"
    :class="kind === 'conflict' ? 'border-amber-500/40 bg-amber-500/10 text-amber-100' : 'border-rose-500/40 bg-rose-500/10 text-rose-100'"
    role="alert"
  >
    <component :is="kind === 'conflict' ? AlertTriangle : CloudOff" class="size-4 shrink-0" />
    <p class="min-w-0 flex-1">{{ message }}</p>
    <div class="flex flex-wrap gap-2">
      <button v-if="kind === 'conflict'" class="btn-primary" @click="keep">Keep my changes</button>
      <button v-if="kind === 'conflict'" class="btn" @click="planner.reloadFromServer()">Reload from server</button>
      <button v-if="kind === 'retrying'" class="btn" @click="planner.retrySave()"><RefreshCw class="size-4" /> Retry now</button>
      <button v-if="kind !== 'conflict'" class="btn" @click="planner.exportJson()"><Download class="size-4" /> Download JSON</button>
      <router-link v-if="kind === 'signed-out'" to="/" class="btn">Go to sign-in</router-link>
      <router-link v-if="kind === 'deleted'" to="/" class="btn">Back to my plans</router-link>
    </div>
  </div>
</template>
