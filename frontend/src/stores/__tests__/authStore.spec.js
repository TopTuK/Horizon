import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/api', () => ({
  authApi: { me: vi.fn(), providers: vi.fn(), testLogin: vi.fn(), logout: vi.fn() },
}))

import { authApi } from '../../services/api'
import { useAuth } from '../authStore'

const anonymous = () => Object.assign(new Error('no session'), { status: 401 })
const alice = { id: 'u1', name: 'Alice', email: 'alice@example.com' }

describe('authStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(authApi.me).mockReset()
    vi.mocked(authApi.providers).mockReset()
    vi.mocked(authApi.testLogin).mockReset()
  })

  it('starts unchecked and anonymous', () => {
    const auth = useAuth()

    expect(auth.checked).toBe(false)
    expect(auth.isAuthenticated).toBe(false)
  })

  it('knows the signed-in user once the session was checked', async () => {
    vi.mocked(authApi.me).mockResolvedValue(alice)
    const auth = useAuth()

    await auth.fetchMe()

    expect(auth.checked).toBe(true)
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.displayName).toBe('Alice')
  })

  it('is anonymous without a session, and still checked', async () => {
    vi.mocked(authApi.me).mockRejectedValue(anonymous())
    const auth = useAuth()

    await auth.fetchMe()

    expect(auth.checked).toBe(true)
    expect(auth.user).toBeNull()
  })

  it('stays signed in when the check fails for any reason other than a missing session', async () => {
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(authApi.me).mockResolvedValueOnce(alice)
    const auth = useAuth()
    await auth.fetchMe()

    for (const status of [0, 500, 502, 503]) {
      vi.mocked(authApi.me).mockRejectedValueOnce(Object.assign(new Error('blip'), { status }))
      await auth.fetchMe()
      expect(auth.isAuthenticated).toBe(true)
      expect(auth.user).toEqual(alice)
    }
    quiet.mockRestore()
  })

  it('falls back to the email, then to a neutral label, for the display name', async () => {
    const auth = useAuth()
    vi.mocked(authApi.me).mockResolvedValue({ id: 'u1', name: null, email: 'bob@example.com' })
    await auth.fetchMe()
    expect(auth.displayName).toBe('bob@example.com')

    vi.mocked(authApi.me).mockResolvedValue({ id: 'u1', name: null, email: null })
    await auth.fetchMe()
    expect(auth.displayName).toBe('Your account')
  })

  it('shares one session check between callers that ask at the same time', async () => {
    vi.mocked(authApi.me).mockResolvedValue(alice)
    const auth = useAuth()

    await Promise.all([auth.ensureChecked(), auth.ensureChecked()])

    expect(authApi.me).toHaveBeenCalledTimes(1)
    expect(auth.isAuthenticated).toBe(true)
  })

  it('lists the providers the server offers', async () => {
    vi.mocked(authApi.providers).mockResolvedValue({ providers: ['yandex', 'test'] })
    const auth = useAuth()

    await auth.fetchProviders()

    expect(auth.providers).toEqual(['yandex', 'test'])
  })

  it('signs in the test user the same way as any other', async () => {
    vi.mocked(authApi.testLogin).mockResolvedValue({ id: 'u9', name: 'Test user', email: null })
    const auth = useAuth()

    await auth.testLogin()

    expect(auth.isAuthenticated).toBe(true)
    expect(auth.displayName).toBe('Test user')
  })
})
