import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    // the API runs on 127.0.0.1:3000; the browser talks to one origin
    proxy: { '/api': process.env.API_PROXY ?? 'http://127.0.0.1:3000' },
  },
  test: { environment: 'node' },
});
