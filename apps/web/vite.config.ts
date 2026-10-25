import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  envDir: fileURLToPath(new URL("../../", import.meta.url)),
  server: {
    proxy: {
      "/api":
        process.env.TERRAREADY_BROWSER_TEST === "1"
          ? "http://127.0.0.1:8001"
          : "http://127.0.0.1:8000",
    },
  },
  build: { sourcemap: false },
});
