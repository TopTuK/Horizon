<script setup>
import PoolCard from './PoolCard.vue'
</script>

<template>
  <section id="pools" class="scroll-mt-20">
    <div class="mb-4 flex items-end justify-between">
      <div>
        <h2 class="text-lg font-semibold text-zinc-100">Resource Pool</h2>
        <p class="text-sm text-zinc-500">Drag people onto activity months in the chart below. Drop an assignment back here to release it.</p>
      </div>
    </div>
    <div class="flex flex-wrap gap-4">
      <PoolCard pool-id="dev" title="Development Pool" role="Developer" accent="#818cf8" />
      <PoolCard pool-id="test" title="Testing Pool" role="Tester" accent="#34d399" />
    </div>
  </section>
</template>
