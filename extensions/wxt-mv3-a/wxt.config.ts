import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'
// See https://wxt.dev/api/config.html
let name = "detect-linkedin";
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
    name: process.env.NODE_ENV === "development" ? "[DEV] " + name : name
  },
  vite: () => ({
    plugins: [tailwindcss()]
  })
})
