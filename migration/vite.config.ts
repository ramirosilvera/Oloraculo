import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          // Split engine into its own chunk (heavy computation, loaded lazily)
          'prediction-engine': [
            './src/engine/prediction-engine',
            './src/engine/models/goal-model',
            './src/engine/probability-helper',
          ],
        },
      },
    },
  },
  define: {
    // Make env vars available at build time
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY),
  },
});
