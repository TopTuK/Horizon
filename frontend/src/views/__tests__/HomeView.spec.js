import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/api', () => ({
  authApi: { me: vi.fn(), providers: vi.fn(), testLogin: vi.fn(), logout: vi.fn() },
  plansApi: { get: vi.fn(), save: vi.fn(), rename: vi.fn(), list: vi.fn(), create: vi.fn(), remove: vi.fn() },
}))

import { authApi, plansApi } from '../../services/api'
import { BROWSER_PLAN_KEY, defaultState } from '../../lib/planDocument'
import { useAuth } from '../../stores/authStore'
import { usePlans } from '../../stores/plans'
import HomeView from '../HomeView.vue'

const alice = { id: 'u1', name: 'Alice', email: 'alice@example.com' }
const summary = (overrides = {}) => ({
  id: 'p1',
  name: 'Roadmap 2027',
  revision: 1,
  activity_count: 12,
  member_count: 12,
  selected_year: 2027,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
  ...overrides,
})

/** Mounts the landing page at `path`, with its stores and router. Signs in first when given a user. */
async function openLanding(path = '/', user = null) {
  const pinia = createPinia()
  useAuth(pinia).user = user
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: HomeView },
      { path: '/plan/:id', component: { render: () => h('div', 'plan') } },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(HomeView, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return { wrapper, router, auth: useAuth(pinia), plans: usePlans(pinia) }
}

const button = (wrapper, text) => wrapper.findAll('button').find((b) => b.text().includes(text))

describe('HomeView for a visitor', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(authApi.providers).mockReset().mockResolvedValue({ providers: [] })
    vi.mocked(authApi.testLogin).mockReset()
    vi.mocked(plansApi.create).mockReset()
    vi.mocked(plansApi.list).mockReset().mockResolvedValue([])
  })

  it('shows one sign-in button per provider the server offers', async () => {
    const { wrapper, auth } = await openLanding()

    auth.providers = ['oidc', 'yandex', 'google']
    await flushPromises()

    const buttons = wrapper.findAll('a[href^="/auth/login/"]')
    expect(buttons.map((a) => a.attributes('href'))).toEqual([
      '/auth/login/oidc',
      '/auth/login/yandex',
      '/auth/login/google',
    ])
    // The first provider on offer is the primary button, the others are secondary.
    expect(buttons.map((a) => a.classes('btn-primary'))).toEqual([true, false, false])
    expect(buttons[0].text()).toContain('Sign in with your organization account')
    expect(buttons[1].text()).toContain('Я')
    expect(buttons[1].text()).toContain('Sign in with Yandex')
    expect(buttons[2].text()).toContain('Sign in with Google')
    expect(wrapper.text()).not.toContain('My plans')
  })

  it('says so when no provider is configured', async () => {
    const { wrapper } = await openLanding()

    expect(wrapper.findAll('a[href^="/auth/login/"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('Sign-in is not configured on this server yet.')
  })

  it('offers the test user only while the server has it, and lands on the plans after signing in', async () => {
    const { wrapper, auth, plans } = await openLanding()
    vi.mocked(authApi.testLogin).mockResolvedValue({ id: 'u9', name: 'Test user', email: null })
    vi.mocked(plansApi.list).mockResolvedValue([summary()])

    auth.providers = ['yandex', 'test']
    await flushPromises()
    expect(button(wrapper, 'test user')).toBeDefined()

    await button(wrapper, 'test user').trigger('click')
    await flushPromises()

    expect(authApi.testLogin).toHaveBeenCalledTimes(1)
    expect(plansApi.list).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('My plans')
    expect(wrapper.text()).toContain('Roadmap 2027')
    expect(wrapper.text()).not.toContain('test user')
  })

  it('explains a failed sign-in once, then cleans the address', async () => {
    const { wrapper, router } = await openLanding('/?login=failed')

    expect(wrapper.text()).toContain('Sign-in failed. Please try again.')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('explains why a visitor who wanted a plan is here', async () => {
    const { wrapper } = await openLanding('/?signin=required')

    expect(wrapper.text()).toContain('Sign in to open that plan.')
  })
})

describe('HomeView for a signed-in user', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(authApi.providers).mockReset().mockResolvedValue({ providers: [] })
    vi.mocked(plansApi.create).mockReset()
    vi.mocked(plansApi.list).mockReset().mockResolvedValue([summary(), summary({ id: 'p2', name: 'KNIS' })])
    vi.mocked(plansApi.create).mockResolvedValue({ ...summary({ id: 'p9' }), data: defaultState() })
  })

  const openSignedIn = () => openLanding('/', alice)

  it('lists the plans with what they hold', async () => {
    vi.mocked(plansApi.list).mockResolvedValue([
      summary({ updated_at: new Date().toISOString() }),
      summary({ id: 'p2', name: 'KNIS', activity_count: 1, member_count: 1, updated_at: new Date().toISOString() }),
    ])
    const { wrapper } = await openSignedIn()

    expect(wrapper.text()).toContain('Alice')
    expect(wrapper.text()).toContain('12 activities · 12 people · changed just now')
    expect(wrapper.text()).toContain('1 activity · 1 person · changed just now')
    expect(wrapper.text()).toContain('Roadmap 2027')
    expect(wrapper.text()).toContain('KNIS')
    expect(wrapper.text()).not.toContain('Sign in to open your plans')
  })

  it('opens a plan when its row is chosen', async () => {
    const { wrapper, router } = await openSignedIn()

    const row = wrapper.findAll('button.min-w-0').find((b) => b.text().includes('KNIS'))
    await row.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/plan/p2')
  })

  it('creates a plan and opens it', async () => {
    const { wrapper, router } = await openSignedIn()

    await button(wrapper, 'New plan').trigger('click')
    await flushPromises()

    expect(plansApi.create).toHaveBeenCalledTimes(1)
    const [payload] = vi.mocked(plansApi.create).mock.calls[0]
    expect(payload.name).toBe('Roadmap 2026')
    expect(payload.data.version).toBe(defaultState().version)
    expect(router.currentRoute.value.path).toBe('/plan/p9')
  })

  it('saves the plan the browser kept before accounts existed, once', async () => {
    const work = defaultState()
    work.activities.push({ id: 'a1', name: 'Integration' })
    localStorage.setItem(BROWSER_PLAN_KEY, JSON.stringify(work))
    const { wrapper } = await openSignedIn()
    expect(wrapper.text()).toContain('A plan from this browser is not in your account')

    await button(wrapper, 'Save to my plans').trigger('click')
    await flushPromises()

    expect(plansApi.create).toHaveBeenCalledWith({ name: 'Roadmap 2026', data: expect.objectContaining({ activities: [expect.objectContaining({ id: 'a1' })] }) })
    expect(localStorage.getItem(BROWSER_PLAN_KEY)).toBeNull()
    expect(wrapper.text()).not.toContain('A plan from this browser')
  })

  it('offers nothing from the browser when it only holds an untouched plan', async () => {
    localStorage.setItem(BROWSER_PLAN_KEY, JSON.stringify(defaultState()))
    const { wrapper } = await openSignedIn()

    expect(wrapper.text()).not.toContain('A plan from this browser')
  })

  it('says when the plans could not be loaded, and tries again on request', async () => {
    vi.mocked(plansApi.list).mockRejectedValueOnce(new Error('The server could not be reached.'))
    const { wrapper, plans } = await openSignedIn()
    expect(wrapper.text()).toContain('The plans could not be loaded. The server could not be reached.')
    expect(wrapper.text()).not.toContain('Loading plans…')

    await button(wrapper, 'Try again').trigger('click')
    await flushPromises()

    expect(plansApi.list).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Roadmap 2027')
    expect(wrapper.text()).not.toContain('could not be loaded')
  })
})
