<script setup>
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import { usePlanner } from '../stores/planner'
import { usePlans } from '../stores/plans'
import AppHeader from '../components/AppHeader.vue'
import SyncBanner from '../components/SyncBanner.vue'
import ResourcePool from '../components/pools/ResourcePool.vue'
import GanttChart from '../components/gantt/GanttChart.vue'
import ActivityEditor from '../components/gantt/ActivityEditor.vue'
import StatisticsSection from '../components/stats/StatisticsSection.vue'
import DistributionSection from '../components/stats/DistributionSection.vue'
import WorkingCalendarModal from '../components/calendar/WorkingCalendarModal.vue'
import BurndownModal from '../components/gantt/BurndownModal.vue'

const planner = usePlanner()
const plans = usePlans()
const route = useRoute()

// Saving follows each edit after a short pause. When the tab is hidden or closed sooner, save at once.
function onBeforeUnload(e) {
  if (!planner.hasUnsavedChanges()) return
  e.preventDefault()
  e.returnValue = ''
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') planner.flushSave()
}

function onPageHide() {
  planner.flushSave({ keepalive: true })
}

onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', onPageHide)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('pagehide', onPageHide)
  planner.close()
})

// The list feeds the plan switcher in the header.
plans.load().catch(() => {})

watch(
  () => route.params.id,
  (id) => planner.openPlan(id),
  { immediate: true },
)

watch(
  () => planner.plan?.name,
  (name) => (document.title = name ? `${name} · Horizon` : 'Horizon · Roadmap Planner'),
  { immediate: true },
)

// Leaving with changes that could not be saved has to be a deliberate choice.
onBeforeRouteLeave(async () => {
  await planner.flushSave()
  if (!planner.hasUnsavedChanges()) return true
  return window.confirm(`The latest changes to "${planner.plan?.name}" are not saved. Leave anyway?`)
})

const loadMessages = {
  missing: 'It may have been deleted, or it belongs to another account.',
  unsupported: 'The planner on this server cannot open it. You can still download a copy of the plan.',
  error: '',
}
</script>

<template>
  <div>
    <AppHeader />
    <SyncBanner v-if="planner.plan" />
    <main class="space-y-12 px-6 py-8">
      <template v-if="planner.loadStatus === 'ready'">
        <ResourcePool />
        <GanttChart />
        <StatisticsSection />
        <DistributionSection />
      </template>

      <section v-else-if="planner.loadStatus === 'loading'" class="card mx-auto flex max-w-md items-center gap-3 px-6 py-8 text-sm text-zinc-400">
        <span class="size-2 animate-pulse rounded-full bg-indigo-400" /> Opening the plan…
      </section>

      <section v-else class="card mx-auto max-w-md p-8 text-center">
        <h2 class="text-lg font-semibold text-zinc-100">
          {{ planner.loadStatus === 'missing' ? 'This plan does not exist' : planner.loadStatus === 'unsupported' ? 'This plan cannot be opened here' : 'The plan could not be loaded' }}
        </h2>
        <p class="mt-2 text-sm text-zinc-500">
          {{ loadMessages[planner.loadStatus] || planner.loadError?.message || 'The server could not be reached.' }}
        </p>
        <div class="mt-6 flex justify-center gap-2">
          <button v-if="planner.loadStatus === 'unsupported'" class="btn" @click="planner.exportUnreadable()">Download JSON</button>
          <button v-else-if="planner.loadStatus === 'error'" class="btn" @click="planner.openPlan(route.params.id)">Try again</button>
          <router-link to="/" class="btn-primary">Back to my plans</router-link>
        </div>
      </section>
    </main>

    <template v-if="planner.loadStatus === 'ready'">
      <ActivityEditor />
      <WorkingCalendarModal />
      <BurndownModal />
    </template>
  </div>
</template>
