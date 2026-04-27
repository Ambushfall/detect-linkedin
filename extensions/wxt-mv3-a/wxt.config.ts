import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    permissions: [
      'tabs',
      'webRequest',
      'webNavigation',
      'storage',
      'unlimitedStorage',
      'contextMenus',
      'cookies',
      'declarativeNetRequest',
      'declarativeNetRequestFeedback',
      'scripting',
      'userScripts'
    ],
    host_permissions: ['https://*/*', 'http://*/*'],
  },
  vite: () => ({
    plugins: [tailwindcss()]
  })
})
