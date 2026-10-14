import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import compression from 'compression'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'preview-gzip-cache',
      configurePreviewServer(server) {
        server.middlewares.use(compression() as never)
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          next()
        })
      },
    },
  ],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor';
          }
          if (id.includes('node_modules/lucide-react/')) {
            return 'icons';
          }
          if (id.includes('@monaco-editor')) {
            return 'monaco';
          }
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
      '/healthz': 'http://127.0.0.1:8001',
      '/readyz': 'http://127.0.0.1:8001',
      '/metrics': 'http://127.0.0.1:8001',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
      '/healthz': 'http://127.0.0.1:8001',
      '/readyz': 'http://127.0.0.1:8001',
      '/metrics': 'http://127.0.0.1:8001',
    },
  },
})
