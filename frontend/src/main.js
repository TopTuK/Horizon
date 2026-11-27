import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import './style.css'
import App from './App.vue'

// Pinia is installed first: the router's first navigation already reads the session store.
createApp(App).use(createPinia()).use(router).mount('#app')
