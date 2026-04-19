import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // amazon-cognito-identity-js uses bare `global`; browsers only have globalThis.
  define: {
    global: 'globalThis',
  },
  build: {
    rollupOptions: {
      output: {
        // define() misses some dependency patterns; guarantee binding in every emitted chunk
        banner: 'var global = globalThis;',
      },
    },
  },
})
