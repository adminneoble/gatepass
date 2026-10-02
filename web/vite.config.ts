import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': { target: `http://localhost:${process.env.API_PORT ?? 4000}`, changeOrigin: false } },
  },
});
