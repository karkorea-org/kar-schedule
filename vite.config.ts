import { defineConfig } from "vite";
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/.tools/**"] },
  },
  build: { target: ["es2022", "safari15"], chunkSizeWarningLimit: 1200 },
});
