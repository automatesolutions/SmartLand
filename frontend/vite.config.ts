import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backend = process.env.SMARTLAND_API ?? 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 3001 matches CORS_ORIGIN in backend/.env
    port: 3001,
    proxy: {
      '/api': backend,
      '/health': backend,
    },
  },
})
