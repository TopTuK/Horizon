<script setup>
import AppHeader from './components/AppHeader.vue'
import ResourcePool from './components/pools/ResourcePool.vue'
import GanttChart from './components/gantt/GanttChart.vue'
import ActivityEditor from './components/gantt/ActivityEditor.vue'
import StatisticsSection from './components/stats/StatisticsSection.vue'
import WorkingCalendarModal from './components/calendar/WorkingCalendarModal.vue'
import BurndownModal from './components/gantt/BurndownModal.vue'
</script>

<template>
  <div class="min-h-screen bg-[radial-gradient(ellipse_at_top,_rgb(49_46_129_/_0.18),_transparent_60%)]">
    <AppHeader />
    <main class="space-y-12 px-6 py-8">
      <ResourcePool />
      <GanttChart />
      <StatisticsSection />
    </main>
    <ActivityEditor />
    <WorkingCalendarModal />
    <BurndownModal />
  </div>
</template>
