<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, Copy, LogOut, Pencil, Plus, Trash2, Upload } from 'lucide-vue-next'
import { useAuth } from '../stores/authStore'
import { usePlans } from '../stores/plans'
import {
  VERSION,
  defaultState,
  discardBrowserPlan,
  isValidState,
  normalizeDocument,
  readBrowserPlan,
} from '../lib/planDocument'
import { timeAgo } from '../lib/format'
import { initials } from '../lib/planning'
import PlanNameDialog from '../components/PlanNameDialog.vue'
import poolShot from '../../../docs/screenshots/resource-pool.png'
import ganttShot from '../../../docs/screenshots/gantt.png'
import statsShot from '../../../docs/screenshots/statistics.png'
import calendarShot from '../../../docs/screenshots/calendar.png'

const auth = useAuth()
const plans = usePlans()
const route = useRoute()
const router = useRouter()

const features = [
  {
    title: 'Resource pools',
    text: "Name your pools, set each person's efficient hours, and drag people onto the work.",
    shot: poolShot,
  },
  {
    title: 'Smart Gantt',
    text: 'Estimated activities run until their hours are covered; fixed-date ones keep the span you set.',
    shot: ganttShot,
  },
  {
    title: 'Statistics',
    text: 'Year totals, monthly utilization, and the activities that still need people.',
    shot: statsShot,
  },
  {
    title: 'Working calendar',
    text: "Mark holidays and working weekends; every pool's capacity follows.",
    shot: calendarShot,
  },
]

// One button per provider the server offers.
const signIn = {
  oidc: { label: 'Sign in with your organization account', href: '/auth/login/oidc' },
  yandex: {
    label: 'Sign in with Yandex',
    href: '/auth/login/yandex',
    badge: 'Я',
    badgeClass: 'bg-[#FC3F1D] text-white',
  },
  google: {
    label: 'Sign in with Google',
    href: '/auth/login/google',
    badge: 'G',
    badgeClass: 'bg-white text-[#4285F4]',
  },
}

const buttons = computed(() => auth.providers.filter((provider) => signIn[provider]))

/** A plan this browser kept before accounts existed, offered once for import. */
const browserPlan = ref(readBrowserPlan())
const busy = ref(false)
const notice = ref('')
const fileInput = ref(null)
const renaming = ref(null)
let noticeTimer = null

function show(message) {
  notice.value = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = ''), 6000)
}

/** Runs an account action once at a time and reports what went wrong. */
async function run(work, fallback) {
  if (busy.value) return
  busy.value = true
  try {
    await work()
  } catch (err) {
    show(err.message || fallback)
  } finally {
    busy.value = false
  }
}

const open = (plan) => router.push(`/plan/${plan.id}`)

const newPlan = () =>
  run(async () => {
    const plan = await plans.create({ name: plans.nextName(), data: defaultState() })
    await router.push(`/plan/${plan.id}`)
  }, 'The plan could not be created.')

async function onImport(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  await run(async () => {
    let data
    try {
      data = JSON.parse(await file.text())
    } catch {
      throw new Error('This file is not a valid JSON file.')
    }
    if (!isValidState(data)) throw new Error('This file is not a Horizon roadmap export.')
    if (data.version !== VERSION) throw new Error('This file was exported by another version of Horizon.')
    const name = file.name.replace(/\.json$/i, '').trim() || 'Imported plan'
    const plan = await plans.create({ name, data: normalizeDocument(data) })
    await router.push(`/plan/${plan.id}`)
  }, 'The file could not be imported.')
}

async function rename(name) {
  const plan = renaming.value
  renaming.value = null
  await run(() => plans.rename(plan.id, name), 'The plan could not be renamed.')
}

const duplicate = (plan) =>
  run(async () => {
    await plans.duplicate(plan.id)
    show(`Copied "${plan.name}".`)
  }, 'The plan could not be copied.')

function remove(plan) {
  if (!confirm(`Delete "${plan.name}"? This cannot be undone.`)) return
  return run(() => plans.remove(plan.id), 'The plan could not be deleted.')
}

const saveBrowserPlan = () =>
  run(async () => {
    const data = browserPlan.value
    await plans.create({ name: plans.nextName(`Roadmap ${data.selectedYear}`), data: normalizeDocument(data) })
    discardBrowserPlan()
    browserPlan.value = null
  }, 'The plan from this browser could not be saved.')

const testSignIn = () =>
  run(async () => {
    await auth.testLogin()
    await plans.load()
  }, 'The test sign-in failed.')

const signOut = () => run(() => auth.logout(), 'Sign-out failed. Try again.')

const describe = (plan) =>
  `${plan.activity_count} ${plan.activity_count === 1 ? 'activity' : 'activities'} · ${plan.member_count} ${
    plan.member_count === 1 ? 'person' : 'people'
  } · changed ${timeAgo(plan.updated_at)}`

onMounted(() => {
  document.title = 'Horizon · Roadmap Planner'
  if (auth.isAuthenticated) plans.load().catch(() => {})   // the list itself says when that failed
  else auth.fetchProviders()
  // The router and the sign-in callbacks explain themselves through the address; show it once, then drop it.
  if (route.query.login === 'failed') show('Sign-in failed. Please try again.')
  if (route.query.signin === 'required') show('Sign in to open that plan.')
  if (route.query.login || route.query.signin) router.replace('/')
})

onBeforeUnmount(() => clearTimeout(noticeTimer))
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
      <div class="flex items-center gap-4 px-6 py-3">
        <img src="/icons/horizon-logo.png" alt="Horizon" class="h-9 w-auto" />
        <span class="hidden text-sm text-zinc-500 sm:inline">roadmap planner</span>
        <div v-if="auth.isAuthenticated" class="ml-auto flex items-center gap-2">
          <span
            class="flex size-7 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-semibold text-indigo-200"
            :title="auth.user?.email || ''"
          >
            {{ initials(auth.displayName) }}
          </span>
          <span class="max-w-48 truncate text-sm text-zinc-300">{{ auth.displayName }}</span>
          <button class="btn" :disabled="busy" @click="signOut"><LogOut class="size-4" /> Sign out</button>
        </div>
      </div>
    </header>

    <main class="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
      <section class="text-center">
        <h1 class="text-5xl font-bold tracking-tight text-zinc-100">Horizon</h1>
        <p class="mx-auto mt-4 max-w-2xl text-lg text-zinc-400">
          A smart Gantt chart for roadmap planning. Staff your resource pools, lay the year's work on the chart, and
          see whether the plan fits the people you have.
        </p>
      </section>

      <section class="mx-auto mt-10 max-w-2xl">
        <div v-if="!auth.isAuthenticated" class="card p-8">
          <h2 class="text-xl font-semibold text-zinc-100">Sign in to open your plans</h2>
          <p class="mt-2 text-sm text-zinc-500">Your roadmaps are saved to your account and open on any device.</p>
          <div class="mt-6 space-y-3">
            <a
              v-for="(provider, index) in buttons"
              :key="provider"
              :href="signIn[provider].href"
              class="w-full justify-center py-2.5 text-base"
              :class="index === 0 ? 'btn-primary' : 'btn'"
            >
              <span
                v-if="signIn[provider].badge"
                class="flex size-5 items-center justify-center rounded-full text-xs font-bold"
                :class="signIn[provider].badgeClass"
              >
                {{ signIn[provider].badge }}
              </span>
              {{ signIn[provider].label }}
            </a>
            <button v-if="auth.providers.includes('test')" class="btn w-full justify-center py-2.5" :disabled="busy" @click="testSignIn">
              Sign in as test user (test mode)
            </button>
            <p v-if="!auth.providers.length" class="text-center text-sm text-zinc-500">
              Sign-in is not configured on this server yet.
            </p>
          </div>
        </div>

        <template v-else>
          <div class="card p-6">
            <h2 class="text-xl font-semibold text-zinc-100">My plans</h2>
            <div class="mt-5 grid gap-2 sm:grid-cols-2">
              <button class="btn-primary justify-center py-2.5" :disabled="busy" @click="newPlan"><Plus class="size-4" /> New plan</button>
              <button class="btn justify-center py-2.5" :disabled="busy" @click="fileInput.click()"><Upload class="size-4" /> Import JSON</button>
            </div>
          </div>

          <div v-if="browserPlan" class="card mt-4 flex flex-wrap items-center gap-4 p-5">
            <div class="min-w-0 flex-1">
              <h3 class="font-semibold text-zinc-100">A plan from this browser is not in your account</h3>
              <p class="mt-1 text-sm text-zinc-500">
                Before accounts existed, Horizon kept plans in the browser. Save this one to your plans to go on working
                on it anywhere.
              </p>
            </div>
            <button class="btn shrink-0" :disabled="busy" @click="saveBrowserPlan"><Upload class="size-4" /> Save to my plans</button>
          </div>

          <div class="mt-8 space-y-3">
            <div v-for="p in plans.items" :key="p.id" class="card flex flex-wrap items-center gap-3 p-4">
              <button class="min-w-0 flex-1 text-left" @click="open(p)">
                <span class="block truncate font-semibold text-zinc-100 transition hover:text-indigo-300">{{ p.name }}</span>
                <span class="block text-sm text-zinc-500">{{ describe(p) }}</span>
              </button>
              <div class="flex shrink-0 gap-1">
                <button class="btn-icon" title="Rename" @click="renaming = p"><Pencil class="size-4" /></button>
                <button class="btn-icon" title="Duplicate" :disabled="busy" @click="duplicate(p)"><Copy class="size-4" /></button>
                <button class="btn-icon hover:text-red-400" title="Delete" :disabled="busy" @click="remove(p)"><Trash2 class="size-4" /></button>
              </div>
            </div>
            <div v-if="plans.error" class="card p-8 text-center text-sm text-zinc-500">
              <p>The plans could not be loaded.{{ plans.error.message ? ` ${plans.error.message}` : '' }}</p>
              <button class="btn mt-4" :disabled="plans.loading" @click="plans.load().catch(() => {})">Try again</button>
            </div>
            <p v-else-if="plans.loaded && !plans.items.length" class="card p-8 text-center text-sm text-zinc-500">
              No plans yet. Create one, or import a JSON export.
            </p>
            <p v-else-if="!plans.loaded" class="card p-8 text-center text-sm text-zinc-500">Loading plans…</p>
          </div>
        </template>
      </section>

      <section class="mt-16 grid gap-6 sm:grid-cols-2">
        <div v-for="f in features" :key="f.title" class="card overflow-hidden">
          <img
            :src="f.shot"
            :alt="f.title"
            class="aspect-video w-full border-b border-zinc-800 object-cover object-left-top"
            loading="lazy"
            decoding="async"
          />
          <div class="p-5">
            <h3 class="font-semibold text-zinc-100">{{ f.title }}</h3>
            <p class="mt-1 text-sm text-zinc-500">{{ f.text }}</p>
          </div>
        </div>
      </section>
    </main>

    <footer class="border-t border-zinc-800/80 py-6 text-center text-sm text-zinc-600">
      Horizon ·
      <a class="transition hover:text-zinc-300" href="https://github.com/TopTuK/Horizon" target="_blank" rel="noopener noreferrer">
        Source on GitHub
      </a>
    </footer>

    <div
      v-if="notice"
      class="fixed bottom-6 left-1/2 z-50 flex max-w-xl -translate-x-1/2 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 shadow-xl shadow-black"
      role="status"
    >
      <AlertTriangle class="size-4 shrink-0 text-amber-400" /> {{ notice }}
    </div>

    <PlanNameDialog v-if="renaming" :initial="renaming.name" @confirm="rename" @cancel="renaming = null" />
    <input ref="fileInput" type="file" accept="application/json,.json" class="hidden" @change="onImport" />
  </div>
</template>
