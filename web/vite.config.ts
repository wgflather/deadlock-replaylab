import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Vite inlines every asset under 4 KB into the bundle by default, which for the
    // ~650 small ability icons means a megabyte of base64 in the main script that every
    // visitor downloads before anything shows. As files, each loads only when drawn.
    assetsInlineLimit: 0,
  },
})
