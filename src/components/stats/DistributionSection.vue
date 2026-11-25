<script setup>
import { usePlanner } from '../../stores/planner'
import PoolDistribution from './PoolDistribution.vue'

const planner = usePlanner()
</script>

<template>
  <section id="distribution" class="scroll-mt-20">
    <div class="mb-4">
      <h2 class="flex items-center gap-2 text-lg font-semibold text-zinc-100">
        <img src="/icons/distribution.png" alt="" class="size-8 rounded-lg" />
        Allocation Distribution · {{ planner.year }}
      </h2>
      <p class="text-sm text-zinc-500">
        How each pool and each person's time is split by month and by activity. Bars are the share of a full workload
        (1 FTE) booked in the month; anything above the red line is over-allocated.
      </p>
    </div>

    <div class="space-y-4">
      <PoolDistribution v-for="pool in planner.state.pools" :key="pool.id" :pool="pool" />
      <p v-if="!planner.state.pools.length" class="text-sm text-zinc-500">No pools yet. Add one to see its allocation.</p>
    </div>
  </section>
</template>
