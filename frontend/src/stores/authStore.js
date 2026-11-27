import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { authApi } from '../services/api'

export const useAuth = defineStore('auth', () => {
  const user = ref(null)
  /** Whether the session has been checked at least once. */
  const checked = ref(false)
  /** Sign-in buttons to show: any of "oidc", "yandex", "google" and, in test setups only, "test". */
  const providers = ref([])
  let checking = null

  const isAuthenticated = computed(() => !!user.value)
  const displayName = computed(() => user.value?.name || user.value?.email || 'Your account')

  async function fetchMe() {
    try {
      user.value = await authApi.me()
    } catch (err) {
      // Only the server saying there is no session signs the visitor out. A request that failed for
      // any other reason leaves things as they are, so a connection blip never throws anybody out.
      if (err.status === 401) user.value = null
      else console.warn('Could not check the session; staying as is', err)
    } finally {
      checked.value = true
    }
  }

  /** Checks the session; calls made together share one request. Every navigation asks again, so a
   * sign-out in another tab is noticed too. */
  function ensureChecked() {
    checking ||= fetchMe().finally(() => (checking = null))
    return checking
  }

  async function fetchProviders() {
    try {
      providers.value = (await authApi.providers()).providers
    } catch (err) {
      console.error('Could not load the sign-in providers', err)
      providers.value = []
    }
  }

  async function testLogin() {
    user.value = await authApi.testLogin()
  }

  async function logout() {
    try {
      await authApi.logout()
    } finally {
      // A full page load also drops every plan that is open in memory.
      window.location.assign('/')
    }
  }

  return { user, checked, providers, isAuthenticated, displayName, ensureChecked, fetchMe, fetchProviders, testLogin, logout }
})
