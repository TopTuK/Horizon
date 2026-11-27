<script setup>
import { ref } from 'vue'
import { Plus } from 'lucide-vue-next'
import { usePlanner } from '../../stores/planner'
import PoolCard from './PoolCard.vue'

const planner = usePlanner()
const newName = ref('')

function addPool() {
  planner.addPool(newName.value)
  newName.value = ''
}
</script>

<template>
  <section id="pools" class="scroll-mt-20">
    <div class="mb-4 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 class="flex items-center gap-2 text-lg font-semibold text-zinc-100">
          <img src="/icons/pool.png" alt="" class="size-8 rounded-lg" />
          Resource Pools
        </h2>
        <p class="text-sm text-zinc-500">
          Drag a person onto an activity month in the chart below. Drop an assignment back onto its pool to release it.
        </p>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1 text-xs text-zinc-500">
          Business days / year (all pools)
          <input
            class="field w-40"
            type="number"
            min="0"
            max="366"
            :value="planner.state.businessDays"
            @change="planner.setBusinessDays($event.target.value)"
          />
        </label>
        <form class="flex items-end gap-2" @submit.prevent="addPool">
          <label class="flex flex-col gap-1 text-xs text-zinc-500">
            New pool
            <input v-model="newName" class="field w-44" placeholder="e.g. Design Pool" />
          </label>
          <button class="btn" type="submit"><Plus class="size-4" /> Add pool</button>
        </form>
      </div>
    </div>
    <div class="flex flex-wrap gap-4">
      <PoolCard v-for="pool in planner.state.pools" :key="pool.id" :pool="pool" />
      <p v-if="!planner.state.pools.length" class="text-sm text-zinc-500">No pools yet. Add one to start assigning people.</p>
    </div>
  </section>
</template>
