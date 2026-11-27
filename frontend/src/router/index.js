import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '../stores/authStore'

// Pages load when first visited, so a visitor does not download the planner.
const routes = [
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
  {
    path: '/plan/:id',
    name: 'plan',
    component: () => import('../views/PlannerView.vue'),
    meta: { requiresAuth: true },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({ history: createWebHistory(), routes })

// The session is checked before the first navigation, so every page knows whether the visitor is signed in.
router.beforeEach(async (to) => {
  const auth = useAuth()
  await auth.ensureChecked()
  if (to.meta.requiresAuth && !auth.isAuthenticated) return { path: '/', query: { signin: 'required' } }
  return true
})

export default router
