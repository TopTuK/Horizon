/** Calls to the Horizon API. Same-origin throughout: in development the Vite proxy forwards `/api` to the
 * backend, in production the backend serves this app. The session travels in an HttpOnly cookie. */

export class ApiError extends Error {
  constructor(status, body) {
    const detail = body?.detail
    super(typeof detail === 'string' ? detail : `Request failed (${status || 'network'})`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function request(method, path, { body, keepalive = false } = {}) {
  let response
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      // A keepalive request outlives the page, for the last save while a tab is closing.
      keepalive,
    })
  } catch {
    throw new ApiError(0, { detail: 'The server could not be reached.' })
  }
  if (response.status === 204) return null

  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!response.ok) throw new ApiError(response.status, data)
  return data
}

export const authApi = {
  providers: () => request('GET', '/auth/providers'),
  me: () => request('GET', '/auth/me'),
  logout: () => request('POST', '/auth/logout'),
  /** Signs in without a provider. Works only while the server has the test login enabled. */
  testLogin: () => request('POST', '/dev/test-login'),
}

export const plansApi = {
  list: () => request('GET', '/plans'),
  create: ({ name, data }) => request('POST', '/plans', { body: { name, data } }),
  get: (id) => request('GET', `/plans/${id}`),
  save: (id, data, revision, { keepalive = false } = {}) =>
    request('PUT', `/plans/${id}`, { body: { data, revision }, keepalive }),
  rename: (id, name) => request('PATCH', `/plans/${id}`, { body: { name } }),
  remove: (id) => request('DELETE', `/plans/${id}`),
}
