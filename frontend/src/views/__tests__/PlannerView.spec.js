import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/api', () => ({
  plansApi: { get: vi.fn(), save: vi.fn(), rename: vi.fn(), list: vi.fn(), create: vi.fn(), remove: vi.fn() },
}))

import { plansApi } from '../../services/api'
import { defaultState } from '../../lib/planDocument'
import { usePlanner } from '../../stores/planner'
import PlannerView from '../PlannerView.vue'

// The sections hold the chart and drag-and-drop code and are not what is under test here.
const stubs = {
  AppHeader: true,
  SyncBanner: true,
  ResourcePool: true,
  GanttChart: true,
  StatisticsSection: true,
  DistributionSection: true,
  ActivityEditor: true,
  WorkingCalendarModal: true,
  AbsenceModal: true,
  BurndownModal: true,
}

const Shell = { render: () => h(RouterView) }
const Home = { render: () => h('div', 'home') }
const serverPlan = (overrides = {}) => ({
  id: 'p1',
  name: 'Roadmap',
  revision: 1,
  updated_at: '2026-11-01T10:00:00Z',
  data: defaultState(),
  ...overrides,
})
/** Saves take a moment: the debounce plus a request. */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let planner

/** Opens the app at `path`. The page is rendered by a router view, as in the application itself. */
async function open(path = '/plan/p1') {
  const pinia = createPinia()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Home },
      { path: '/plan/:id', component: PlannerView },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(Shell, { global: { plugins: [pinia, router], stubs } })
  await flushPromises()
  planner = usePlanner(pinia)
  return { wrapper, router, planner }
}

beforeEach(() => {
  vi.mocked(plansApi.get).mockReset().mockResolvedValue(serverPlan())
  vi.mocked(plansApi.list).mockReset().mockResolvedValue([])
  vi.mocked(plansApi.save).mockReset().mockResolvedValue(serverPlan({ revision: 2 }))
})

afterEach(() => {
  planner?.close()
  document.title = 'Horizon · Roadmap Planner'
})

describe('PlannerView', () => {
  it('waits for the plan, then shows the planner', async () => {
    let arrive
    vi.mocked(plansApi.get).mockImplementation(() => new Promise((resolve) => (arrive = resolve)))
    const { wrapper, planner } = await open()
    expect(wrapper.text()).toContain('Opening the plan')
    expect(wrapper.find('resource-pool-stub').exists()).toBe(false)

    arrive(serverPlan({ name: 'Roadmap 2027' }))
    await flushPromises()

    expect(wrapper.find('resource-pool-stub').exists()).toBe(true)
    expect(wrapper.find('gantt-chart-stub').exists()).toBe(true)
    expect(planner.plan.name).toBe('Roadmap 2027')
    expect(document.title).toBe('Roadmap 2027 · Horizon')
  })

  it('saves an edit made through the planner', async () => {
    const { planner } = await open()

    planner.addSwimlane('KNIS')
    await wait(1000)

    expect(plansApi.save).toHaveBeenCalledTimes(1)
    expect(plansApi.save.mock.calls[0][2]).toBe(1)
    expect(planner.plan.revision).toBe(2)
  })

  it('offers the way back for a plan that does not exist', async () => {
    vi.mocked(plansApi.get).mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }))
    const { wrapper, router } = await open('/plan/gone')

    expect(wrapper.text()).toContain('This plan does not exist')
    await wrapper.find('a.btn-primary').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('lets a plan download when the editor cannot open it, and never saves over it', async () => {
    vi.mocked(plansApi.get).mockResolvedValue(serverPlan({ data: { ...defaultState(), version: 999 } }))
    const { wrapper, planner } = await open()

    expect(wrapper.text()).toContain('This plan cannot be opened here')
    expect(wrapper.find('button.btn').text()).toBe('Download JSON')
    expect(planner.plan).toBeNull()
    expect(plansApi.save).not.toHaveBeenCalled()
  })

  it('follows the address to another plan without leaving the page', async () => {
    vi.mocked(plansApi.get).mockImplementation((id) => Promise.resolve(serverPlan({ id, name: `Plan ${id}` })))
    const { router, planner } = await open('/plan/a')
    expect(planner.plan.id).toBe('a')

    await router.push('/plan/b')
    await flushPromises()

    expect(planner.plan.id).toBe('b')
    expect(planner.loadStatus).toBe('ready')
  })

  it('leaves without asking when everything is saved', async () => {
    const { router } = await open()
    const confirm = vi.spyOn(window, 'confirm').mockImplementation(() => {
      throw new Error('should not be asked')
    })

    await router.push('/')

    expect(router.currentRoute.value.path).toBe('/')
    confirm.mockRestore()
  })

  it('asks before leaving with changes that could not be saved', async () => {
    vi.mocked(plansApi.save).mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }))
    const { router, planner } = await open()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    planner.addSwimlane('KNIS')
    await wait(1000)
    expect(planner.saveStatus).toBe('error')

    await router.push('/')
    expect(confirm).toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/plan/p1')

    confirm.mockReturnValue(true)
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/')
    confirm.mockRestore()
  })
})
