import { defineStore } from 'pinia'
import { ref } from 'vue'
import { defaultState } from '../lib/planDocument'
import { plansApi } from '../services/api'

/** The signed-in user's plans. Items are summaries in the server's order, most recently changed first. */
export const usePlans = defineStore('plans', () => {
  const items = ref([])
  const loaded = ref(false)
  const loading = ref(false)
  /** Why the last attempt to load the list failed, if it did. */
  const error = ref(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      items.value = await plansApi.list()
      loaded.value = true
    } catch (err) {
      error.value = err
      throw err
    } finally {
      loading.value = false
    }
  }

  /** `base`, made unique among the user's plans. */
  function nextName(base = `Roadmap ${defaultState().selectedYear}`) {
    const taken = new Set(items.value.map((p) => p.name))
    if (!taken.has(base)) return base
    for (let n = 2; ; n++) {
      if (!taken.has(`${base} (${n})`)) return `${base} (${n})`
    }
  }

  async function create({ name, data }) {
    const plan = await plansApi.create({ name, data })
    const { data: _document, ...summary } = plan
    items.value.unshift(summary)
    return plan
  }

  /** Updates a plan's metadata after a rename or a save, so lists show it as it is now. */
  function touch(summary) {
    const index = items.value.findIndex((p) => p.id === summary.id)
    if (index !== -1) items.value[index] = { ...items.value[index], ...summary }
  }

  async function rename(id, name) {
    const summary = await plansApi.rename(id, name)
    touch(summary)
    return summary
  }

  async function remove(id) {
    await plansApi.remove(id)
    items.value = items.value.filter((p) => p.id !== id)
  }

  /** Copies a plan under a name of its own and returns the copy. */
  async function duplicate(id) {
    const source = await plansApi.get(id)
    return create({ name: nextName(`${source.name} copy`), data: source.data })
  }

  return { items, loaded, loading, error, load, nextName, create, touch, rename, remove, duplicate }
})
