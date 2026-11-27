import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The pages themselves are not under test here; only where the router lets people go.
vi.mock('../../views/HomeView.vue', () => ({ default: { template: '<div>home</div>' } }))
vi.mock('../../views/PlannerView.vue', () => ({ default: { template: '<div>planner</div>' } }))
vi.mock('../../services/api', () => ({
  authApi: { me: vi.fn(), providers: vi.fn(), testLogin: vi.fn(), logout: vi.fn() },
}))

import { authApi } from '../../services/api'
import router from '../index'

const noSession = () => Object.assign(new Error('no session'), { status: 401 })
const alice = { id: 'u1', name: 'Alice', email: 'alice@example.com' }

/** Navigates and returns the address the router ended up at. */
async function visit(path) {
  await router.push(path)
  return router.currentRoute.value.fullPath
}

describe('router', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(authApi.me).mockReset()
  })

  it('checks the session before showing any page', async () => {
    vi.mocked(authApi.me).mockResolvedValue(alice)

    await visit('/')

    expect(authApi.me).toHaveBeenCalledTimes(1)
  })

  it('sends a visitor who is not signed in away from a plan, and explains why', async () => {
    vi.mocked(authApi.me).mockRejectedValue(noSession())

    expect(await visit('/plan/p1')).toBe('/?signin=required')
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('opens a plan for a visitor who is signed in', async () => {
    vi.mocked(authApi.me).mockResolvedValue(alice)

    expect(await visit('/plan/p1')).toBe('/plan/p1')
    expect(router.currentRoute.value.name).toBe('plan')
  })

  it('keeps the landing page open to everyone', async () => {
    vi.mocked(authApi.me).mockRejectedValue(noSession())

    expect(await visit('/')).toBe('/')
  })

  it('sends unknown addresses to the landing page', async () => {
    vi.mocked(authApi.me).mockResolvedValue(alice)

    expect(await visit('/nowhere')).toBe('/')
  })
})
