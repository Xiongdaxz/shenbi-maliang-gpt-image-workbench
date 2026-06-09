import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const githubPagesBase = "/shenbi-maliang-gpt-image-workbench/";

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? githubPagesBase : "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/files": "http://127.0.0.1:8787"
    }
  },
  build: {
    outDir: "dist"
  }
});
