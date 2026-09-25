import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    /* db/pix-normaliza.js é CommonJS compartilhado com o server.js. O plugin
       commonjs do Rollup só olha node_modules por padrão; sem incluí-lo aqui o
       import nomeado no front quebra no build. */
    commonjsOptions: {
      include: [/node_modules/, /db[\\/]pix-normaliza\.js$/],
    },
    /* separa vendors grandes — evita bundle único > 500 kB */
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          motion: ["framer-motion"],
          icons: ["lucide-react"],
        },
      },
    },
  },
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/uploads": { target: "http://127.0.0.1:3000", changeOrigin: true },
    },
  },
  preview: {
    allowedHosts: true,
  },
});