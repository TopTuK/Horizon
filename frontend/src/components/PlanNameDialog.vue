<script setup>
import { onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'

const props = defineProps({
  title: { type: String, default: 'Rename plan' },
  initial: { type: String, default: '' },
  confirmLabel: { type: String, default: 'Save' },
})
const emit = defineEmits(['confirm', 'cancel'])

const name = ref(props.initial)
const input = ref(null)

onMounted(() => {
  input.value?.focus()
  input.value?.select()
})

function submit() {
  const clean = name.value.trim()
  if (clean) emit('confirm', clean)
}
</script>

<template>
  <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" @pointerdown.self="$emit('cancel')">
    <form class="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl shadow-black" @submit.prevent="submit">
      <div class="flex items-center justify-between gap-4">
        <h2 class="text-base font-semibold text-zinc-100">{{ title }}</h2>
        <button type="button" class="text-zinc-500 hover:text-zinc-100" title="Close (Esc)" @click="$emit('cancel')">
          <X class="size-5" />
        </button>
      </div>
      <label class="mt-4 block text-xs text-zinc-500">
        Plan name
        <input
          ref="input"
          v-model="name"
          class="field mt-1 w-full"
          maxlength="255"
          placeholder="e.g. Roadmap 2027"
          required
          @keydown.esc="$emit('cancel')"
        />
      </label>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="btn" @click="$emit('cancel')">Cancel</button>
        <button type="submit" class="btn-primary" :disabled="!name.trim()">{{ confirmLabel }}</button>
      </div>
    </form>
  </div>
</template>
