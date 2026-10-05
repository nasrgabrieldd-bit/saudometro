// Build separado pro host (Saudômetro) — não mexe no vite.config.ts original (esse aqui
// continua sendo o executável independente/dev, com o simulador). Gera nomes de arquivo
// fixos (sem hash) pra ficar simples de referenciar/cachear no service worker do app
// principal, e usa host.html (não index.html) como entrada, pra nunca montar o simulador
// por engano em produção.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-host',
    emptyOutDir: true,
    rollupOptions: {
      input: 'host.html',
      output: {
        entryFileNames: 'capmart.js',
        chunkFileNames: 'capmart-[name].js',
        assetFileNames: (info) => (info.name && info.name.endsWith('.css') ? 'capmart.css' : 'assets/[name][extname]'),
      },
    },
  },
});
